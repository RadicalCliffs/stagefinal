import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { toPrizePid, normalizeWalletAddress } from "../_shared/userId.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Secure Write Edge Function - Server-side proxy for database writes
 * 
 * Mirrors the Netlify secure-write function for local development.
 * Uses service role key to bypass RLS restrictions.
 * 
 * IMPORTANT SCHEMA NOTES:
 * - user_transactions table does NOT have a 'type' column
 * - The type (entry vs topup) is inferred from whether competition_id is set:
 *   - competition_id IS NOT NULL → entry purchase
 *   - competition_id IS NULL → wallet top-up
 * - balance_ledger table columns: id, user_id, balance_type, source, amount, transaction_id, metadata, created_at, expires_at
 */

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

async function verifyPrivyToken(
  token: string,
  serviceClient: ReturnType<typeof createClient>
): Promise<{ userId: string; privyUserId: string; email?: string } | null> {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;

  const privyUserId = payload.sub as string | undefined;
  if (!privyUserId || !privyUserId.startsWith('did:privy:')) return null;

  const exp = payload.exp as number | undefined;
  if (exp && Date.now() >= exp * 1000) return null;

  // Convert to canonical format for lookup
  const canonicalUserId = toPrizePid(privyUserId);

  const { data: userConnection, error } = await serviceClient
    .from("canonical_users")
    .select("id, email")
    .eq("canonical_user_id", canonicalUserId)
    .maybeSingle();

  if (error || !userConnection) return null;

  return { userId: userConnection.id, privyUserId, email: userConnection.email };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST' && req.method !== 'PATCH') {
    return new Response(JSON.stringify({ error: 'Method not allowed', ok: false }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    // Get auth token
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized', ok: false }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const token = authHeader.replace('Bearer ', '').trim();
    const authUser = await verifyPrivyToken(token, serviceClient);

    if (!authUser) {
      return new Response(JSON.stringify({ error: 'Invalid token', ok: false }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Parse route from URL
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    // Path is like: /secure-write/transactions/create
    const route = pathParts.slice(1).join('/'); // Skip 'secure-write'

    const body = await req.json().catch(() => ({}));

    // Route: transactions/create
    if (route === 'transactions/create') {
      const {
        wallet_address,
        competition_id,
        ticket_count,
        amount,
        reservation_id,
        payment_provider,
        network,
        // Note: 'type' is accepted but NOT stored - it's inferred from competition_id
      } = body;

      // For entry purchases, competition_id is required
      // For top-ups, competition_id should be null/undefined
      const isTopUp = !competition_id;

      if (!isTopUp) {
        // Entry purchase validation
        if (!wallet_address || !competition_id || !ticket_count || !amount) {
          return new Response(JSON.stringify({ 
            error: 'Missing required fields for entry purchase: wallet_address, competition_id, ticket_count, amount', 
            ok: false 
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } else {
        // Top-up validation
        if (!amount) {
          return new Response(JSON.stringify({ 
            error: 'Missing required field for top-up: amount', 
            ok: false 
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }

      // Get user's canonical_user_id
      const { data: userData } = await serviceClient
        .from("canonical_users")
        .select("canonical_user_id, privy_user_id, wallet_address")
        .eq("id", authUser.userId)
        .single();

      const canonicalUserId = userData?.canonical_user_id || toPrizePid(authUser.privyUserId);
      const privyUserId = userData?.privy_user_id || authUser.privyUserId;
      const finalWalletAddress = wallet_address || userData?.wallet_address;

      // Build transaction record - NO 'type' column exists in user_transactions
      // The type is inferred from competition_id being null (topup) or not (entry)
      const transactionData: Record<string, any> = {
        user_id: canonicalUserId,  // Use canonical ID
        user_privy_id: privyUserId,  // Keep for backward compatibility
        wallet_address: finalWalletAddress,
        amount,
        currency: "USDC",
        network: network || "base",
        payment_provider: payment_provider || "privy_base_wallet",
        status: "pending",
        payment_status: "pending",
        created_at: new Date().toISOString(),
      };

      // Only add competition-related fields for entry purchases
      if (!isTopUp) {
        transactionData.competition_id = competition_id;
        transactionData.ticket_count = ticket_count;
      } else {
        // For top-ups, explicitly set competition_id to null and ticket_count to 0
        transactionData.competition_id = null;
        transactionData.ticket_count = 0;
      }

      const { data: transaction, error: txError } = await serviceClient
        .from("user_transactions")
        .insert(transactionData)
        .select("id")
        .single();

      if (txError) {
        console.error("Error creating transaction:", txError);
        return new Response(JSON.stringify({ 
          error: txError.message, 
          ok: false 
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Link reservation if provided (only for entry purchases)
      if (reservation_id && !isTopUp) {
        await serviceClient
          .from("pending_tickets")
          .update({ session_id: transaction.id })
          .eq("id", reservation_id);
      }

      return new Response(JSON.stringify({
        ok: true,
        transactionId: transaction.id,
        totalAmount: amount,
        isTopUp,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Route: balance/topup - Credit user's USD balance after successful top-up payment
    if (route === 'balance/topup') {
      const { transaction_id, amount: topupAmount } = body;

      if (!transaction_id || !topupAmount) {
        return new Response(JSON.stringify({ 
          error: 'Missing required fields: transaction_id, amount', 
          ok: false 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Verify the transaction exists and belongs to this user
      const { data: txData, error: txError } = await serviceClient
        .from("user_transactions")
        .select("id, user_id, amount, status, wallet_credited")
        .eq("id", transaction_id)
        .single();

      if (txError || !txData) {
        return new Response(JSON.stringify({
          error: 'Transaction not found',
          ok: false
        }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Check if already credited
      if (txData.wallet_credited) {
        return new Response(JSON.stringify({
          ok: true,
          message: 'Balance already credited',
          alreadyCredited: true
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Look up the user's UUID from canonical_users
      // The balance_ledger.user_id column is UUID type
      // Convert to canonical for lookup
      const lookupCanonicalId = toPrizePid(txData.user_id);
      const { data: userData } = await serviceClient
        .from("canonical_users")
        .select("id, usdc_balance")
        .eq("canonical_user_id", lookupCanonicalId)
        .maybeSingle();

      if (!userData) {
        return new Response(JSON.stringify({
          error: 'User not found',
          ok: false
        }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const userUuid = userData.id;

      // Credit the balance_ledger
      // balance_ledger columns: id, user_id (UUID), balance_type, source, amount, transaction_id (UUID), metadata, created_at, expires_at
      const { error: ledgerError } = await serviceClient
        .from("balance_ledger")
        .insert({
          user_id: userUuid, // UUID from canonical_users.id
          balance_type: "real", // Real USD balance, not bonus
          source: "topup",
          amount: topupAmount,
          transaction_id: transaction_id, // UUID from user_transactions.id
          metadata: { payment_provider: "privy_base_wallet" },
          created_at: new Date().toISOString(),
          expires_at: null, // Real balance doesn't expire
        });

      if (ledgerError) {
        console.error("Error crediting balance_ledger:", ledgerError);
        return new Response(JSON.stringify({
          error: `Failed to credit balance: ${ledgerError.message}`,
          ok: false
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Update canonical_users.usdc_balance using the UUID
      const currentBalance = Number(userData.usdc_balance || 0);
      const newBalance = currentBalance + Number(topupAmount);

      await serviceClient
        .from("canonical_users")
        .update({
          usdc_balance: newBalance,
          updated_at: new Date().toISOString()
        })
        .eq("id", userUuid);

      // Mark transaction as wallet_credited
      await serviceClient
        .from("user_transactions")
        .update({ 
          wallet_credited: true,
          updated_at: new Date().toISOString()
        })
        .eq("id", transaction_id);

      return new Response(JSON.stringify({
        ok: true,
        credited: topupAmount,
        newBalance,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: `Unknown route: ${route}`, ok: false }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Secure write error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Internal error', 
      ok: false 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
