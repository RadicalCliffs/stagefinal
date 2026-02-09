import type { Context, Config } from "@netlify/functions";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { toPrizePid, isWalletAddress } from "./_shared/userId.mts";

/**
 * User Balance Function - Server-side wallet balance management
 *
 * This function handles wallet balance operations that require bypassing
 * client-side RLS restrictions. It ensures proper ownership verification
 * and provides atomic balance updates.
 *
 * The original issue: Frontend code was directly reading/updating
 * usdc_balance in canonical_users table, which could fail due to
 * RLS policies or lead to race conditions in balance updates.
 *
 * Routes:
 * - GET /api/user-balance - Get user's current balance
 * - POST /api/user-balance/credit - Credit balance (add funds)
 * - POST /api/user-balance/debit - Debit balance (remove funds)
 * - GET /api/user-balance/history - Get balance change history
 */

// Response helpers
function jsonResponse(data: object, status: number = 200, origin?: string | null): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "content-type, authorization";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function errorResponse(message: string, status: number = 400, origin?: string | null): Response {
  return jsonResponse({ error: message, ok: false }, status, origin);
}

// UUID validation
function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

// Get Supabase client with service role
function getSupabaseClient(): SupabaseClient {
  const supabaseUrl = Netlify.env.get("VITE_SUPABASE_URL") || Netlify.env.get("SUPABASE_URL");
  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl) throw new Error("Missing SUPABASE_URL");
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Verify wallet token authentication
async function verifyWalletToken(
  token: string,
  supabase: SupabaseClient
): Promise<{ userId: string; profileId: string; walletAddress: string } | null> {
  if (!token.startsWith("wallet:")) return null;

  const walletAddress = token.replace("wallet:", "").trim().toLowerCase();
  if (!isWalletAddress(walletAddress)) return null;

  // Convert to canonical format for consistent lookups
  const canonicalUserId = toPrizePid(walletAddress);

  // Strategy 1: Look up user by canonical_user_id FIRST (matches top-up/spend operations)
  const { data: canonicalUser, error: canonicalError } = await supabase
    .from("canonical_users")
    .select("id, privy_user_id, wallet_address, base_wallet_address, usdc_balance, uid")
    .eq("canonical_user_id", canonicalUserId)
    .maybeSingle();

  if (canonicalUser && !canonicalError) {
    console.log("[user-balance] Found user by canonical_user_id:", canonicalUserId.substring(0, 20) + "...");
    return {
      userId: canonicalUserId,
      profileId: canonicalUser.id || canonicalUser.uid,
      walletAddress,
    };
  }

  // Strategy 2: Fallback to wallet_address lookup (for legacy data)
  const { data: user, error } = await supabase
    .from("canonical_users")
    .select("id, privy_user_id, wallet_address, base_wallet_address, usdc_balance, uid")
    .or(`wallet_address.ilike.${walletAddress},base_wallet_address.ilike.${walletAddress}`)
    .maybeSingle();

  if (error || !user) return null;

  console.log("[user-balance] Found user by wallet_address (fallback)");

  return {
    userId: canonicalUserId,
    profileId: user.id || user.uid,
    walletAddress,
  };
}

// Get authenticated user from request
async function getAuthenticatedUser(
  request: Request,
  supabase: SupabaseClient
): Promise<{ userId: string; profileId: string; walletAddress: string } | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.replace("Bearer ", "").trim();
  if (!token || token.length < 10) return null;

  return await verifyWalletToken(token, supabase);
}

interface BalanceOperation {
  amount: number;
  reason: string;
  referenceId?: string;
  referenceType?: "competition" | "topup" | "withdrawal" | "refund" | "bonus" | "adjustment";
}

// Get user's current balance
async function handleGetBalance(
  profileId: string,
  canonicalUserId: string,
  supabase: SupabaseClient,
  origin?: string | null
): Promise<Response> {
  // Primary: Use get_user_balance RPC which reads from sub_account_balances
  const { data: rpcBalance, error: rpcError } = await supabase.rpc("get_user_balance", {
    p_canonical_user_id: canonicalUserId,
  });

  if (!rpcError && rpcBalance !== null) {
    // Get additional user metadata from sub_account_balances
    const { data: subAccountData } = await supabase
      .from("sub_account_balances")
      .select("id, user_id, pending_balance, canonical_user_id")
      .eq("currency", "USD")
      .or(`canonical_user_id.eq.${canonicalUserId},user_id.ilike.%${profileId}%`)
      .maybeSingle();

    // Also get wallet address from canonical_users
    const { data: userData } = await supabase
      .from("canonical_users")
      .select("wallet_address, base_wallet_address")
      .or(`canonical_user_id.eq.${canonicalUserId},privy_user_id.eq.${profileId}`)
      .maybeSingle();

    return jsonResponse({
      ok: true,
      balance: Number(rpcBalance || 0),
      pendingBalance: Number(subAccountData?.pending_balance || 0),
      walletAddress: userData?.wallet_address || userData?.base_wallet_address || null,
      uid: subAccountData?.user_id || profileId,
      updatedAt: new Date().toISOString(),
    }, 200, origin);
  }

  // Fallback: Direct query to sub_account_balances if RPC fails
  console.log("[user-balance] RPC failed, falling back to sub_account_balances query:", rpcError?.message);

  const { data: subAccountData, error: subAccountError } = await supabase
    .from("sub_account_balances")
    .select("id, user_id, available_balance, pending_balance, canonical_user_id")
    .eq("currency", "USD")
    .or(`canonical_user_id.eq.${canonicalUserId},user_id.ilike.%${profileId}%`)
    .maybeSingle();

  if (subAccountData && !subAccountError) {
    // Also get wallet address from canonical_users
    const { data: userData } = await supabase
      .from("canonical_users")
      .select("wallet_address, base_wallet_address")
      .or(`canonical_user_id.eq.${canonicalUserId},privy_user_id.eq.${profileId}`)
      .maybeSingle();

    return jsonResponse({
      ok: true,
      balance: Number(subAccountData.available_balance || 0),
      pendingBalance: Number(subAccountData.pending_balance || 0),
      walletAddress: userData?.wallet_address || userData?.base_wallet_address || null,
      uid: subAccountData.user_id || profileId,
      updatedAt: new Date().toISOString(),
    }, 200, origin);
  }

  // If no balance record found, return 0 balance (user needs to top up)
  // Don't query legacy tables that may not have the expected schema
  console.log("[user-balance] No balance record found for user:", canonicalUserId.substring(0, 25) + "...");

  // Try to get wallet address from canonical_users for display purposes only
  const { data: userData } = await supabase
    .from("canonical_users")
    .select("uid, wallet_address, base_wallet_address")
    .eq("canonical_user_id", canonicalUserId)
    .maybeSingle();

  return jsonResponse({
    ok: true,
    balance: 0,
    pendingBalance: 0,
    walletAddress: userData?.wallet_address || userData?.base_wallet_address || null,
    uid: userData?.uid || profileId,
    updatedAt: new Date().toISOString(),
  }, 200, origin);
}

// Credit (add to) user's balance
async function handleCreditBalance(
  profileId: string,
  canonicalUserId: string,
  operation: BalanceOperation,
  supabase: SupabaseClient,
  origin?: string | null
): Promise<Response> {
  const { amount, reason, referenceId, referenceType } = operation;

  if (typeof amount !== "number" || amount <= 0) {
    return errorResponse("Amount must be a positive number", 400, origin);
  }

  if (amount > 100000) {
    return errorResponse("Amount exceeds maximum allowed (100000)", 400, origin);
  }

  if (!reason) {
    return errorResponse("Reason is required", 400, origin);
  }

  try {
    // For topup/deposit reasons, use bonus-aware function to apply 50% first-time bonus
    const isTopup = reason?.toLowerCase().includes('topup') || 
                    reason?.toLowerCase().includes('deposit') || 
                    referenceType === 'topup';
    
    if (isTopup) {
      // Use credit_balance_with_first_deposit_bonus for topups (applies 50% bonus on first deposit)
      const { data: bonusResult, error: bonusError } = await supabase.rpc("credit_balance_with_first_deposit_bonus", {
        p_canonical_user_id: canonicalUserId,
        p_amount: amount,
        p_reason: reason,
        p_reference_id: referenceId || null,
      });

      if (!bonusError && bonusResult?.success) {
        console.log(`[User Balance] Credited ${amount} to user with bonus check: ` +
          `deposited=${bonusResult.deposited_amount}, bonus=${bonusResult.bonus_amount}, ` +
          `total=${bonusResult.total_credited}, balance: ${bonusResult.previous_balance} → ${bonusResult.new_balance}`);

        return jsonResponse({
          ok: true,
          previousBalance: bonusResult.previous_balance,
          depositedAmount: bonusResult.deposited_amount,
          bonusAmount: bonusResult.bonus_amount || 0,
          bonusApplied: bonusResult.bonus_applied || false,
          totalCredited: bonusResult.total_credited,
          newBalance: bonusResult.new_balance,
          reason,
        }, 200, origin);
      }

      // If bonus function fails, log and fall through to standard credit
      if (bonusError) {
        console.error("[user-balance] credit_balance_with_first_deposit_bonus failed:", bonusError.message);
        // For topups, we should still try standard credit as fallback
        // This ensures user gets their deposit even if bonus system fails
      }
    }

    // Primary: Use credit_sub_account_balance RPC for atomic balance update (non-topup or bonus fallback)
    const { data: creditResult, error: creditError } = await supabase.rpc("credit_sub_account_balance", {
      p_canonical_user_id: canonicalUserId,
      p_amount: amount,
      p_currency: "USD",
    });

    if (!creditError && creditResult && creditResult.length > 0 && creditResult[0].success) {
      const result = creditResult[0];
      console.log(`[User Balance] Credited ${amount} to user via sub_account_balances: ${result.previous_balance} → ${result.new_balance}`);

      // Log the balance change to balance_history (legacy audit table)
      await supabase.from("balance_history").insert({
        user_id: profileId,
        amount,
        type: "credit",
        reason,
        reference_id: referenceId || null,
        reference_type: referenceType || null,
        balance_before: result.previous_balance,
        balance_after: result.new_balance,
        created_at: new Date().toISOString(),
      }).then(({ error }) => {
        if (error) {
          console.warn("Failed to log balance history:", error);
        }
      });

      return jsonResponse({
        ok: true,
        previousBalance: result.previous_balance,
        creditedAmount: amount,
        newBalance: result.new_balance,
        reason,
      }, 200, origin);
    }

    // Log RPC error for debugging
    if (creditError) {
      console.warn("[user-balance] credit_sub_account_balance RPC failed:", creditError.message);
    }

    // Fallback: Direct update to sub_account_balances table
    console.log("[user-balance] Falling back to direct sub_account_balances update");

    // Find sub_account_balances record
    const { data: subAccountRecord, error: findError } = await supabase
      .from("sub_account_balances")
      .select("id, available_balance, canonical_user_id, user_id")
      .eq("currency", "USD")
      .or(`canonical_user_id.eq.${canonicalUserId},user_id.ilike.%${profileId}%,privy_user_id.eq.${profileId}`)
      .maybeSingle();

    if (findError) {
      console.error("[user-balance] Error finding sub_account_balances record:", findError);
    }

    if (subAccountRecord) {
      const currentBalance = Number(subAccountRecord.available_balance || 0);
      const newBalance = Number((currentBalance + amount).toFixed(2));

      const { error: updateError, data: updateResult } = await supabase
        .from("sub_account_balances")
        .update({
          available_balance: newBalance,
          last_updated: new Date().toISOString(),
        })
        .eq("id", subAccountRecord.id)
        .select("id");

      if (updateError) {
        console.error("[user-balance] Error updating sub_account_balances:", updateError);
        return errorResponse(`Failed to update balance: ${updateError.message}`, 500, origin);
      }

      if (!updateResult || updateResult.length === 0) {
        return errorResponse("Balance update did not affect any rows", 409, origin);
      }

      console.log(`[User Balance] Credited ${amount} to user via direct update: ${currentBalance} → ${newBalance}`);

      // Log the balance change
      await supabase.from("balance_history").insert({
        user_id: profileId,
        amount,
        type: "credit",
        reason,
        reference_id: referenceId || null,
        reference_type: referenceType || null,
        balance_before: currentBalance,
        balance_after: newBalance,
        created_at: new Date().toISOString(),
      }).then(({ error }) => {
        if (error) {
          console.warn("Failed to log balance history:", error);
        }
      });

      return jsonResponse({
        ok: true,
        previousBalance: currentBalance,
        creditedAmount: amount,
        newBalance,
        reason,
      }, 200, origin);
    }

    // If no sub_account_balances record exists, create one with the credit amount
    // This handles new users who are receiving their first top-up
    console.log("[user-balance] No sub_account_balances record found, creating new record for credit");

    const { data: insertResult, error: insertError } = await supabase
      .from("sub_account_balances")
      .insert({
        canonical_user_id: canonicalUserId,
        user_id: profileId,
        available_balance: amount,
        pending_balance: 0,
        currency: "USD",
        created_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      })
      .select("id, available_balance");

    if (insertError) {
      console.error("[user-balance] Error creating sub_account_balances record:", insertError);
      return errorResponse(`Failed to create balance record: ${insertError.message}`, 500, origin);
    }

    console.log(`[User Balance] Created new balance record with ${amount} for user ${canonicalUserId.substring(0, 25)}...`);

    // Log the balance change
    await supabase.from("balance_history").insert({
      user_id: profileId,
      amount,
      type: "credit",
      reason,
      reference_id: referenceId || null,
      reference_type: referenceType || null,
      balance_before: 0,
      balance_after: amount,
      created_at: new Date().toISOString(),
    }).then(({ error }) => {
      if (error) {
        console.warn("Failed to log balance history:", error);
      }
    });

    return jsonResponse({
      ok: true,
      previousBalance: 0,
      creditedAmount: amount,
      newBalance: amount,
      reason,
    }, 200, origin);
  } catch (err) {
    console.error("Credit balance error:", err);
    return errorResponse(
      err instanceof Error ? err.message : "Failed to credit balance",
      500,
      origin
    );
  }
}

// Debit (remove from) user's balance
async function handleDebitBalance(
  profileId: string,
  canonicalUserId: string,
  operation: BalanceOperation,
  supabase: SupabaseClient,
  origin?: string | null
): Promise<Response> {
  const { amount, reason, referenceId, referenceType } = operation;

  if (typeof amount !== "number" || amount <= 0) {
    return errorResponse("Amount must be a positive number", 400, origin);
  }

  if (!reason) {
    return errorResponse("Reason is required", 400, origin);
  }

  try {
    // Primary: Use debit_sub_account_balance RPC for atomic balance update
    const { data: debitResult, error: debitError } = await supabase.rpc("debit_sub_account_balance", {
      p_canonical_user_id: canonicalUserId,
      p_amount: amount,
      p_currency: "USD",
    });

    if (!debitError && debitResult && debitResult.length > 0) {
      const result = debitResult[0];

      if (result.success) {
        console.log(`[User Balance] Debited ${amount} from user via sub_account_balances: ${result.previous_balance} → ${result.new_balance}`);

        // Log the balance change
        await supabase.from("balance_history").insert({
          user_id: profileId,
          amount: -amount,
          type: "debit",
          reason,
          reference_id: referenceId || null,
          reference_type: referenceType || null,
          balance_before: result.previous_balance,
          balance_after: result.new_balance,
          created_at: new Date().toISOString(),
        }).then(({ error }) => {
          if (error) {
            console.warn("Failed to log balance history:", error);
          }
        });

        return jsonResponse({
          ok: true,
          previousBalance: result.previous_balance,
          debitedAmount: amount,
          newBalance: result.new_balance,
          reason,
        }, 200, origin);
      } else {
        // Insufficient balance or user not found
        return errorResponse(result.error_message || "Insufficient balance", 400, origin);
      }
    }

    // Log RPC error for debugging
    if (debitError) {
      console.warn("[user-balance] debit_sub_account_balance RPC failed:", debitError.message);
    }

    // Fallback: Direct update to sub_account_balances table
    console.log("[user-balance] Falling back to direct sub_account_balances debit");

    // Find sub_account_balances record
    const { data: subAccountRecord, error: findError } = await supabase
      .from("sub_account_balances")
      .select("id, available_balance, canonical_user_id, user_id")
      .eq("currency", "USD")
      .or(`canonical_user_id.eq.${canonicalUserId},user_id.ilike.%${profileId}%,privy_user_id.eq.${profileId}`)
      .maybeSingle();

    if (findError) {
      console.error("[user-balance] Error finding sub_account_balances record:", findError);
    }

    if (subAccountRecord) {
      const currentBalance = Number(subAccountRecord.available_balance || 0);

      if (currentBalance < amount) {
        return errorResponse(
          `Insufficient balance. Current: ${currentBalance}, Required: ${amount}`,
          400,
          origin
        );
      }

      const newBalance = Number((currentBalance - amount).toFixed(2));

      const { error: updateError, data: updateResult } = await supabase
        .from("sub_account_balances")
        .update({
          available_balance: newBalance,
          last_updated: new Date().toISOString(),
        })
        .eq("id", subAccountRecord.id)
        .gte("available_balance", amount)
        .select("id");

      if (updateError || !updateResult || updateResult.length === 0) {
        return errorResponse(
          "Insufficient balance or balance was modified by another transaction",
          409,
          origin
        );
      }

      console.log(`[User Balance] Debited ${amount} from user via direct update: ${currentBalance} → ${newBalance}`);

      // Log the balance change
      await supabase.from("balance_history").insert({
        user_id: profileId,
        amount: -amount,
        type: "debit",
        reason,
        reference_id: referenceId || null,
        reference_type: referenceType || null,
        balance_before: currentBalance,
        balance_after: newBalance,
        created_at: new Date().toISOString(),
      }).then(({ error }) => {
        if (error) {
          console.warn("Failed to log balance history:", error);
        }
      });

      return jsonResponse({
        ok: true,
        previousBalance: currentBalance,
        debitedAmount: amount,
        newBalance,
        reason,
      }, 200, origin);
    }

    // No sub_account_balances record found - user has no balance to debit
    console.log("[user-balance] No sub_account_balances record found for debit operation");
    return errorResponse("No balance record found. Please top up your account first.", 400, origin);
  } catch (err) {
    console.error("Debit balance error:", err);
    return errorResponse(
      err instanceof Error ? err.message : "Failed to debit balance",
      500,
      origin
    );
  }
}

// Get balance change history
async function handleGetHistory(
  profileId: string,
  limit: number,
  offset: number,
  supabase: SupabaseClient,
  origin?: string | null
): Promise<Response> {
  // Try to get from balance_history table if it exists
  const { data, error, count } = await supabase
    .from("balance_history")
    .select("*", { count: "exact" })
    .eq("user_id", profileId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    // Table might not exist, return empty history
    if (error.code === "42P01") {
      return jsonResponse({
        ok: true,
        history: [],
        total: 0,
        limit,
        offset,
      }, 200, origin);
    }
    console.error("Error fetching balance history:", error);
    return errorResponse(`Failed to fetch history: ${error.message}`, 500, origin);
  }

  return jsonResponse({
    ok: true,
    history: data || [],
    total: count || 0,
    limit,
    offset,
  }, 200, origin);
}

// Main handler
export default async (req: Request, context: Context): Promise<Response> => {
  const origin = req.headers.get("origin");

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": origin || "*",
        "Access-Control-Allow-Headers": "content-type, authorization",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      },
    });
  }

  try {
    const supabase = getSupabaseClient();

    // All routes require authentication
    const authUser = await getAuthenticatedUser(req, supabase);
    if (!authUser) {
      return errorResponse("Unauthorized - valid Bearer token required", 401, origin);
    }

    // Parse route
    const url = new URL(req.url);
    const pathParts = url.pathname.replace("/api/user-balance", "").split("/").filter(Boolean);

    // GET routes
    if (req.method === "GET") {
      if (pathParts[0] === "history") {
        const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
        const offset = parseInt(url.searchParams.get("offset") || "0");
        return handleGetHistory(authUser.profileId, limit, offset, supabase, origin);
      }

      // Default: get current balance
      return handleGetBalance(authUser.profileId, authUser.userId, supabase, origin);
    }

    // POST routes
    if (req.method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        body = await req.json();
      } catch {
        return errorResponse("Invalid JSON body", 400, origin);
      }

      const operation: BalanceOperation = {
        amount: body.amount as number,
        reason: body.reason as string,
        referenceId: body.referenceId as string | undefined,
        referenceType: body.referenceType as BalanceOperation["referenceType"],
      };

      if (pathParts[0] === "credit") {
        return handleCreditBalance(authUser.profileId, authUser.userId, operation, supabase, origin);
      }

      if (pathParts[0] === "debit") {
        return handleDebitBalance(authUser.profileId, authUser.userId, operation, supabase, origin);
      }

      return errorResponse("Unknown action. Use /credit or /debit", 404, origin);
    }

    return errorResponse("Method not allowed", 405, origin);
  } catch (err) {
    console.error("User balance error:", err);
    return errorResponse(
      err instanceof Error ? err.message : "Internal server error",
      500,
      origin
    );
  }
};

export const config: Config = {
  path: "/api/user-balance/*",
};
