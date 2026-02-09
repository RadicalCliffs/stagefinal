import type { Context, Config } from "@netlify/functions";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { toPrizePid, isWalletAddress } from "./_shared/userId.mts";

/**
 * Competition Status Function - Server-side competition state management
 *
 * This function handles competition status transitions that require bypassing
 * client-side RLS restrictions. It validates state transitions and ensures
 * proper admin authorization before making changes.
 *
 * Routes:
 * - GET /api/competition-status/:id - Get competition status
 * - POST /api/competition-status/:id/transition - Transition to new status
 * - POST /api/competition-status/:id/force - Force transition (admin only)
 */

// Valid state transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["active"],
  active: ["drawing", "cancelled", "completed"],
  drawing: ["drawn", "completed", "cancelled"],
  drawn: ["completed"],
  completed: [], // Terminal state
  cancelled: [], // Terminal state
};

type CompetitionStatus = "draft" | "active" | "drawing" | "drawn" | "completed" | "cancelled";

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
): Promise<{ userId: string; profileId: string; isAdmin: boolean } | null> {
  if (!token.startsWith("wallet:")) return null;

  const walletAddress = token.replace("wallet:", "").trim().toLowerCase();
  if (!isWalletAddress(walletAddress)) return null;

  // Look up user by wallet address with admin check
  const { data: user, error } = await supabase
    .from("canonical_users")
    .select("id, privy_user_id, wallet_address, base_wallet_address, is_admin")
    .or(`wallet_address.ilike.${walletAddress},base_wallet_address.ilike.${walletAddress}`)
    .maybeSingle();

  if (error || !user) return null;

  // Convert user ID to canonical format for consistent storage
  const canonicalUserId = toPrizePid(user.privy_user_id || walletAddress);

  return {
    userId: canonicalUserId,
    profileId: user.id,
    isAdmin: user.is_admin === true,
  };
}

// Get authenticated user from request
async function getAuthenticatedUser(
  request: Request,
  supabase: SupabaseClient
): Promise<{ userId: string; profileId: string; isAdmin: boolean } | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.replace("Bearer ", "").trim();
  if (!token || token.length < 10) return null;

  // Try wallet token first
  const walletUser = await verifyWalletToken(token, supabase);
  if (walletUser) return walletUser;

  // Fallback to Supabase auth
  const anonKey = Netlify.env.get("VITE_SUPABASE_ANON_KEY") || Netlify.env.get("SUPABASE_ANON_KEY");
  const supabaseUrl = Netlify.env.get("VITE_SUPABASE_URL") || Netlify.env.get("SUPABASE_URL");

  if (!anonKey || !supabaseUrl) return null;

  const anonClient = createClient(supabaseUrl, anonKey);
  const { data: { user }, error } = await anonClient.auth.getUser(token);

  if (error || !user) return null;

  // Check if Supabase user is admin
  const { data: profile } = await supabase
    .from("canonical_users")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  return {
    userId: user.id,
    profileId: user.id,
    isAdmin: profile?.is_admin === true,
  };
}

// Validate status transition
function validateStatusTransition(currentStatus: string, newStatus: string): boolean {
  const normalizedCurrent = currentStatus.toLowerCase();
  const normalizedNew = newStatus.toLowerCase();
  const validNext = VALID_TRANSITIONS[normalizedCurrent];
  if (!validNext) return false;
  return validNext.includes(normalizedNew);
}

// Get valid next states
function getValidNextStates(currentStatus: string): string[] {
  return VALID_TRANSITIONS[currentStatus.toLowerCase()] || [];
}

// Route handlers
async function handleGetStatus(
  competitionId: string,
  supabase: SupabaseClient,
  origin?: string | null
): Promise<Response> {
  if (!isValidUUID(competitionId)) {
    return errorResponse("Invalid competition ID", 400, origin);
  }

  const { data, error } = await supabase
    .from("competitions")
    .select("id, status, title, total_tickets, end_date, draw_date, competitionended")
    .eq("id", competitionId)
    .single();

  if (error || !data) {
    return errorResponse("Competition not found", 404, origin);
  }

  return jsonResponse({
    ok: true,
    competition: {
      id: data.id,
      status: data.status,
      title: data.title,
      totalTickets: data.total_tickets,
      endDate: data.end_date,
      drawDate: data.draw_date,
      isEnded: data.competitionended === 1,
      validNextStates: getValidNextStates(data.status),
    },
  }, 200, origin);
}

async function handleTransition(
  competitionId: string,
  newStatus: string,
  supabase: SupabaseClient,
  origin?: string | null
): Promise<Response> {
  if (!isValidUUID(competitionId)) {
    return errorResponse("Invalid competition ID", 400, origin);
  }

  // Get current competition status
  const { data: competition, error: fetchError } = await supabase
    .from("competitions")
    .select("status, title")
    .eq("id", competitionId)
    .single();

  if (fetchError || !competition) {
    return errorResponse("Competition not found", 404, origin);
  }

  const currentStatus = competition.status;

  // Validate the transition
  if (!validateStatusTransition(currentStatus, newStatus)) {
    return errorResponse(
      `Invalid status transition: ${currentStatus} → ${newStatus}. Valid transitions: ${getValidNextStates(currentStatus).join(", ") || "none (terminal state)"}`,
      400,
      origin
    );
  }

  // Build update data
  const updateData: Record<string, unknown> = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  };

  // Add specific fields based on target status
  if (newStatus === "completed" || newStatus === "drawn") {
    updateData.competitionended = 1;
    updateData.draw_date = new Date().toISOString();
  }

  if (newStatus === "cancelled") {
    updateData.competitionended = 1;
  }

  // Perform the update
  const { error: updateError } = await supabase
    .from("competitions")
    .update(updateData)
    .eq("id", competitionId);

  if (updateError) {
    console.error("Error updating competition status:", updateError);
    return errorResponse(`Failed to update status: ${updateError.message}`, 500, origin);
  }

  console.log(`[Competition Status] Transitioned ${competition.title} (${competitionId}): ${currentStatus} → ${newStatus}`);

  return jsonResponse({
    ok: true,
    previousStatus: currentStatus,
    newStatus,
    competitionId,
    title: competition.title,
  }, 200, origin);
}

async function handleForceTransition(
  competitionId: string,
  newStatus: string,
  adminUserId: string,
  supabase: SupabaseClient,
  origin?: string | null
): Promise<Response> {
  if (!isValidUUID(competitionId)) {
    return errorResponse("Invalid competition ID", 400, origin);
  }

  // Get current status for logging
  const { data: competition } = await supabase
    .from("competitions")
    .select("status, title")
    .eq("id", competitionId)
    .single();

  if (!competition) {
    return errorResponse("Competition not found", 404, origin);
  }

  // Build update data
  const updateData: Record<string, unknown> = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  };

  if (newStatus === "completed" || newStatus === "drawn" || newStatus === "cancelled") {
    updateData.competitionended = 1;
  }

  if (newStatus === "active") {
    updateData.competitionended = 0;
  }

  // Perform the update
  const { error } = await supabase
    .from("competitions")
    .update(updateData)
    .eq("id", competitionId);

  if (error) {
    console.error("Error force updating competition status:", error);
    return errorResponse(`Failed to force update status: ${error.message}`, 500, origin);
  }

  console.warn(`[Competition Status] FORCE TRANSITION by admin ${adminUserId}: ${competition.title} (${competitionId}): ${competition.status} → ${newStatus}`);

  return jsonResponse({
    ok: true,
    previousStatus: competition.status,
    newStatus,
    competitionId,
    title: competition.title,
    forcedBy: adminUserId,
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

    // Parse route
    const url = new URL(req.url);
    const pathParts = url.pathname.replace("/api/competition-status", "").split("/").filter(Boolean);

    if (pathParts.length === 0) {
      return errorResponse("Competition ID required", 400, origin);
    }

    const competitionId = pathParts[0];

    // GET - no auth required for status check
    if (req.method === "GET") {
      return handleGetStatus(competitionId, supabase, origin);
    }

    // POST - auth required for transitions
    if (req.method === "POST") {
      const authUser = await getAuthenticatedUser(req, supabase);
      if (!authUser) {
        return errorResponse("Unauthorized - valid Bearer token required", 401, origin);
      }

      let body: Record<string, unknown> = {};
      try {
        body = await req.json();
      } catch {
        return errorResponse("Invalid JSON body", 400, origin);
      }

      const newStatus = body.status as string;
      if (!newStatus) {
        return errorResponse("Missing status field", 400, origin);
      }

      // Validate status is a known value
      const validStatuses: CompetitionStatus[] = ["draft", "active", "drawing", "drawn", "completed", "cancelled"];
      if (!validStatuses.includes(newStatus.toLowerCase() as CompetitionStatus)) {
        return errorResponse(`Invalid status: ${newStatus}. Valid values: ${validStatuses.join(", ")}`, 400, origin);
      }

      // Check if this is a force transition
      if (pathParts[1] === "force") {
        if (!authUser.isAdmin) {
          return errorResponse("Admin access required for force transitions", 403, origin);
        }
        return handleForceTransition(competitionId, newStatus.toLowerCase(), authUser.profileId, supabase, origin);
      }

      // Regular transition
      if (pathParts[1] === "transition") {
        return handleTransition(competitionId, newStatus.toLowerCase(), supabase, origin);
      }

      return errorResponse("Unknown action. Use /transition or /force", 400, origin);
    }

    return errorResponse("Method not allowed", 405, origin);
  } catch (err) {
    console.error("Competition status error:", err);
    return errorResponse(
      err instanceof Error ? err.message : "Internal server error",
      500,
      origin
    );
  }
};

export const config: Config = {
  path: "/api/competition-status/*",
};
