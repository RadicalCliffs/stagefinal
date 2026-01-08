import type { Context, Config } from "@netlify/functions";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { toPrizePid, isWalletAddress } from "./_shared/userId.mts";

/**
 * Transaction Status Function - Server-side transaction status management
 *
 * This function handles transaction status updates that require bypassing
 * client-side RLS restrictions. It ensures proper ownership verification
 * before allowing status updates.
 *
 * The original issue: Frontend code was directly updating user_transactions
 * table, which fails when RLS requires auth.uid() match because the client
 * doesn't have a valid auth context.
 *
 * Routes:
 * - GET /api/transaction-status/:id - Get transaction status
 * - PATCH /api/transaction-status/:id - Update transaction status
 * - POST /api/transaction-status/:id/complete - Mark transaction as complete
 * - POST /api/transaction-status/:id/fail - Mark transaction as failed
 */

// Valid transaction statuses
type TransactionStatus = "pending" | "processing" | "confirming" | "completed" | "finished" | "failed" | "expired" | "cancelled";

const SUCCESS_STATUSES = ["completed", "finished", "confirmed", "success", "paid"];
const FAILURE_STATUSES = ["failed", "expired", "cancelled", "unresolved", "error"];
const PROCESSING_STATUSES = ["processing", "confirming", "sending"];

// Response helpers
function jsonResponse(data: object, status: number = 200, origin?: string | null): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "content-type, authorization";
    headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, OPTIONS";
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

// Normalize status for consistent comparison
function normalizeStatus(status: string): "pending" | "processing" | "completed" | "failed" {
  const lower = status.toLowerCase();
  if (SUCCESS_STATUSES.includes(lower)) return "completed";
  if (FAILURE_STATUSES.includes(lower)) return "failed";
  if (PROCESSING_STATUSES.includes(lower)) return "processing";
  return "pending";
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

  // Look up user by wallet address
  const { data: user, error } = await supabase
    .from("canonical_users")
    .select("id, privy_user_id, wallet_address, base_wallet_address")
    .or(`wallet_address.ilike.${walletAddress},base_wallet_address.ilike.${walletAddress}`)
    .maybeSingle();

  if (error || !user) return null;

  // Convert user ID to canonical format for consistent storage
  const canonicalUserId = toPrizePid(user.privy_user_id || walletAddress);

  return {
    userId: canonicalUserId,
    profileId: user.id,
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

// Verify user owns the transaction
async function verifyTransactionOwnership(
  transactionId: string,
  userId: string,
  walletAddress: string,
  supabase: SupabaseClient
): Promise<{ owned: boolean; transaction: Record<string, unknown> | null }> {
  const { data: transaction, error } = await supabase
    .from("user_transactions")
    .select("*")
    .eq("id", transactionId)
    .single();

  if (error || !transaction) {
    return { owned: false, transaction: null };
  }

  // Check ownership via multiple identifier fields
  // Normalize for case-insensitive wallet address comparison
  const txUserId = transaction.user_id?.toLowerCase();
  const txPrivyUserId = transaction.user_privy_id?.toLowerCase();
  const txWalletAddress = transaction.wallet_address?.toLowerCase();
  const normalizedUserId = userId.toLowerCase();
  const normalizedWallet = walletAddress.toLowerCase();

  const isOwned =
    txUserId === normalizedUserId ||
    txUserId === normalizedWallet ||
    txPrivyUserId === normalizedUserId ||
    txPrivyUserId === normalizedWallet ||
    txWalletAddress === normalizedWallet;

  return { owned: isOwned, transaction };
}

// Get transaction status
async function handleGetStatus(
  transactionId: string,
  userId: string,
  walletAddress: string,
  supabase: SupabaseClient,
  origin?: string | null
): Promise<Response> {
  if (!isValidUUID(transactionId)) {
    return errorResponse("Invalid transaction ID", 400, origin);
  }

  const { owned, transaction } = await verifyTransactionOwnership(
    transactionId,
    userId,
    walletAddress,
    supabase
  );

  if (!transaction) {
    return errorResponse("Transaction not found", 404, origin);
  }

  if (!owned) {
    return errorResponse("Not authorized to view this transaction", 403, origin);
  }

  const rawStatus = transaction.status || transaction.payment_status || "pending";

  return jsonResponse({
    ok: true,
    transaction: {
      id: transaction.id,
      status: normalizeStatus(rawStatus as string),
      rawStatus,
      transactionHash: transaction.tx_id,
      amount: transaction.amount,
      ticketCount: transaction.ticket_count,
      competitionId: transaction.competition_id,
      createdAt: transaction.created_at,
      updatedAt: transaction.updated_at,
      completedAt: transaction.completed_at,
    },
  }, 200, origin);
}

// Update transaction status
async function handleUpdateStatus(
  transactionId: string,
  newStatus: string,
  additionalData: Record<string, unknown>,
  userId: string,
  walletAddress: string,
  supabase: SupabaseClient,
  origin?: string | null
): Promise<Response> {
  if (!isValidUUID(transactionId)) {
    return errorResponse("Invalid transaction ID", 400, origin);
  }

  const { owned, transaction } = await verifyTransactionOwnership(
    transactionId,
    userId,
    walletAddress,
    supabase
  );

  if (!transaction) {
    return errorResponse("Transaction not found", 404, origin);
  }

  if (!owned) {
    return errorResponse("Not authorized to update this transaction", 403, origin);
  }

  // Build update data
  const updateData: Record<string, unknown> = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  };

  // Add payment_status for consistency
  if (SUCCESS_STATUSES.includes(newStatus.toLowerCase())) {
    updateData.payment_status = "finished";
    updateData.completed_at = new Date().toISOString();
  } else if (FAILURE_STATUSES.includes(newStatus.toLowerCase())) {
    updateData.payment_status = "failed";
  } else if (PROCESSING_STATUSES.includes(newStatus.toLowerCase())) {
    updateData.payment_status = "processing";
  }

  // Add additional data if provided
  if (additionalData.transactionHash) {
    updateData.tx_id = additionalData.transactionHash;
  }
  if (additionalData.notes) {
    updateData.notes = additionalData.notes;
  }

  const { error } = await supabase
    .from("user_transactions")
    .update(updateData)
    .eq("id", transactionId);

  if (error) {
    console.error("Error updating transaction status:", error);
    return errorResponse(`Failed to update status: ${error.message}`, 500, origin);
  }

  console.log(`[Transaction Status] Updated ${transactionId}: ${transaction.status} → ${newStatus}`);

  return jsonResponse({
    ok: true,
    transactionId,
    previousStatus: transaction.status,
    newStatus,
    normalizedStatus: normalizeStatus(newStatus),
  }, 200, origin);
}

// Mark transaction as complete
async function handleComplete(
  transactionId: string,
  body: Record<string, unknown>,
  userId: string,
  walletAddress: string,
  supabase: SupabaseClient,
  origin?: string | null
): Promise<Response> {
  return handleUpdateStatus(
    transactionId,
    "completed",
    {
      transactionHash: body.transactionHash,
      notes: body.notes,
    },
    userId,
    walletAddress,
    supabase,
    origin
  );
}

// Mark transaction as failed
async function handleFail(
  transactionId: string,
  body: Record<string, unknown>,
  userId: string,
  walletAddress: string,
  supabase: SupabaseClient,
  origin?: string | null
): Promise<Response> {
  return handleUpdateStatus(
    transactionId,
    "failed",
    {
      notes: body.error || body.notes || "Transaction failed",
    },
    userId,
    walletAddress,
    supabase,
    origin
  );
}

// Main handler
export default async (req: Request, context: Context): Promise<Response> => {
  const origin = req.headers.get("origin");

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin || "*",
        "Access-Control-Allow-Headers": "content-type, authorization",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
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
    const pathParts = url.pathname.replace("/api/transaction-status", "").split("/").filter(Boolean);

    if (pathParts.length === 0) {
      return errorResponse("Transaction ID required", 400, origin);
    }

    const transactionId = pathParts[0];

    // GET - get transaction status
    if (req.method === "GET") {
      return handleGetStatus(
        transactionId,
        authUser.userId,
        authUser.walletAddress,
        supabase,
        origin
      );
    }

    // Parse body for POST/PATCH
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // No body is acceptable for some routes
    }

    // POST routes
    if (req.method === "POST") {
      if (pathParts[1] === "complete") {
        return handleComplete(
          transactionId,
          body,
          authUser.userId,
          authUser.walletAddress,
          supabase,
          origin
        );
      }

      if (pathParts[1] === "fail") {
        return handleFail(
          transactionId,
          body,
          authUser.userId,
          authUser.walletAddress,
          supabase,
          origin
        );
      }

      return errorResponse("Unknown action", 404, origin);
    }

    // PATCH - update status
    if (req.method === "PATCH") {
      const newStatus = body.status as string;
      if (!newStatus) {
        return errorResponse("Missing status field", 400, origin);
      }

      return handleUpdateStatus(
        transactionId,
        newStatus,
        body,
        authUser.userId,
        authUser.walletAddress,
        supabase,
        origin
      );
    }

    return errorResponse("Method not allowed", 405, origin);
  } catch (err) {
    console.error("Transaction status error:", err);
    return errorResponse(
      err instanceof Error ? err.message : "Internal server error",
      500,
      origin
    );
  }
};

export const config: Config = {
  path: "/api/transaction-status/*",
};
