import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { toPrizePid } from "../_shared/userId.ts";

/**
 * Coinbase Onramp Complete Handler
 *
 * This edge function handles the redirect callback when a user completes
 * an onramp transaction via Coinbase. It updates the transaction status
 * and can redirect the user back to the application.
 *
 * Endpoint: https://cyxjzycxnfqctxocolwr.supabase.co/functions/v1/onramp-complete
 */

// CORS configuration
const ALLOWED_ORIGINS = [
  'https://vocal-cascaron-bcef9b.netlify.app',
  'https://stage.theprize.io',
  'https://theprize.io',
  'https://www.theprize.io',
  'http://localhost:3000',
  'http://localhost:5173',
];

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

// Default redirect URL - Use stage.theprize.io URL as primary
const DEFAULT_REDIRECT_URL = 'https://stage.theprize.io/dashboard/entries?status=complete';

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);
  const requestId = crypto.randomUUID().slice(0, 8);

  console.log(`[onramp-complete][${requestId}] Incoming request: method=${req.method}`);

  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    const url = new URL(req.url);

    // Extract query parameters (Coinbase may pass these on redirect)
    const partnerUserRef = url.searchParams.get('partnerUserRef');
    const transactionId = url.searchParams.get('transactionId');
    const status = url.searchParams.get('status') || 'complete';
    const redirectUrl = url.searchParams.get('redirectUrl');

    console.log(`[onramp-complete][${requestId}] partnerUserRef=${partnerUserRef}, transactionId=${transactionId}, status=${status}`);

    // If we have transaction tracking info, update the database
    if (partnerUserRef || transactionId) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      if (supabaseUrl && supabaseServiceKey) {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Try to find and update the transaction
        if (transactionId) {
          // Get transaction details first
          const { data: txData } = await supabase
            .from('user_transactions')
            .select('id, user_id, user_privy_id, amount, wallet_credited')
            .eq('id', transactionId)
            .maybeSingle();

          await supabase
            .from('user_transactions')
            .update({
              status: 'complete',
              payment_status: 'confirmed',
              updated_at: new Date().toISOString(),
            })
            .eq('id', transactionId);

          // Credit balance if transaction exists and wasn't already credited
          if (txData && !txData.wallet_credited && txData.amount) {
            const inputUserId = txData.user_privy_id || txData.user_id;
            const canonicalUserId = toPrizePid(inputUserId);
            const amount = Number(txData.amount);

            if (inputUserId && amount > 0) {
              console.log(`[onramp-complete][${requestId}] Crediting user ${inputUserId} (canonical: ${canonicalUserId}) with ${amount}`);

              // Get current balance using canonical_user_id lookup (primary), with fallback to legacy lookups
              let userData = null;

              // Primary lookup by canonical_user_id
              const { data: canonicalData } = await supabase
                .from('canonical_users')
                .select('id, usdc_balance')
                .eq('canonical_user_id', canonicalUserId)
                .maybeSingle();

              if (canonicalData) {
                userData = canonicalData;
              } else {
                // Fallback to legacy lookups for backward compatibility
                const { data: legacyData } = await supabase
                  .from('canonical_users')
                  .select('id, usdc_balance')
                  .or(`privy_user_id.eq.${inputUserId},wallet_address.ilike.${inputUserId},base_wallet_address.ilike.${inputUserId}`)
                  .maybeSingle();
                userData = legacyData;
              }

              if (userData) {
                // Use credit_sub_account_balance RPC for atomic balance update
                // This is the primary balance system - writes to sub_account_balances.available_balance
                const { data: creditResult, error: creditError } = await supabase.rpc(
                  'credit_sub_account_balance',
                  {
                    p_canonical_user_id: canonicalUserId,
                    p_amount: amount,
                    p_currency: 'USD'
                  }
                );

                if (creditError) {
                  console.error(`[onramp-complete][${requestId}] Error crediting balance:`, creditError);
                } else {
                  const newBalance = creditResult?.[0]?.new_balance ?? amount;
                  const previousBalance = creditResult?.[0]?.previous_balance ?? 0;
                  const creditSuccess = creditResult?.[0]?.success ?? false;

                  if (creditSuccess) {
                    // Mark transaction as credited
                    await supabase
                      .from('user_transactions')
                      .update({ wallet_credited: true })
                      .eq('id', transactionId);

                    console.log(`[onramp-complete][${requestId}] ✅ Balance credited: ${amount} (${previousBalance} → ${newBalance})`);
                  } else {
                    console.error(`[onramp-complete][${requestId}] Balance credit failed:`, creditResult?.[0]?.error_message);
                  }
                }
              }
            }
          }
        } else if (partnerUserRef) {
          // Convert to canonical format for lookup
          const canonicalUserRef = toPrizePid(partnerUserRef);
          console.log(`[onramp-complete][${requestId}] Looking up by partnerUserRef: ${partnerUserRef} -> ${canonicalUserRef}`);

          // Try canonical user_id lookup first
          const { error: canonicalError, count: canonicalCount } = await supabase
            .from('user_transactions')
            .update({
              status: 'complete',
              payment_status: 'confirmed',
              updated_at: new Date().toISOString(),
            })
            .eq('user_id', canonicalUserRef)
            .eq('payment_provider', 'coinbase_onramp')
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(1);

          // If no rows updated with canonical, try legacy user_privy_id
          if (!canonicalError && (!canonicalCount || canonicalCount === 0)) {
            await supabase
              .from('user_transactions')
              .update({
                status: 'complete',
                payment_status: 'confirmed',
                updated_at: new Date().toISOString(),
              })
              .eq('user_privy_id', partnerUserRef)
              .eq('payment_provider', 'coinbase_onramp')
              .eq('status', 'pending')
              .order('created_at', { ascending: false })
              .limit(1);
          }
        }
      }
    }

    // Handle GET requests (redirect callback)
    if (req.method === "GET") {
      const finalRedirectUrl = redirectUrl || DEFAULT_REDIRECT_URL;
      const redirectWithStatus = new URL(finalRedirectUrl);
      redirectWithStatus.searchParams.set('onramp_status', 'complete');

      if (transactionId) {
        redirectWithStatus.searchParams.set('transaction_id', transactionId);
      }

      return new Response(null, {
        status: 302,
        headers: {
          ...cors,
          'Location': redirectWithStatus.toString(),
        },
      });
    }

    // Handle POST requests (API callback)
    if (req.method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        body = await req.json();
      } catch {
        // Body may be empty for simple completion calls
      }

      console.log(`[onramp-complete][${requestId}] POST body:`, JSON.stringify(body));

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Onramp completion acknowledged',
          status: 'complete',
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json", ...cors } }
    );
  } catch (error) {
    console.error(`[onramp-complete][${requestId}] Error:`, error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      { status: 500, headers: { "Content-Type": "application/json", ...cors } }
    );
  }
});
