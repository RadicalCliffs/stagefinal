import type { Context, Config } from "@netlify/functions";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { toPrizePid, isWalletAddress } from "./_shared/userId.mts";

/**
 * Promo Competition Service
 *
 * Manages promotional competitions that are accessible only via promo codes.
 *
 * User Routes:
 * - POST /api/promo-competitions/redeem - Redeem a promo code
 * - GET /api/promo-competitions/my-entries - Get user's promo competition entries
 * - GET /api/promo-competitions/:id - Get promo competition details (if user has access)
 *
 * Admin Routes (requires ADMIN_API_KEY):
 * - POST /api/promo-competitions/admin/competitions - Create promo competition
 * - GET /api/promo-competitions/admin/competitions - List all promo competitions
 * - PATCH /api/promo-competitions/admin/competitions/:id - Update promo competition
 * - DELETE /api/promo-competitions/admin/competitions/:id - Delete promo competition
 * - POST /api/promo-competitions/admin/codes - Create promo code(s)
 * - GET /api/promo-competitions/admin/codes - List codes for a competition
 * - PATCH /api/promo-competitions/admin/codes/:id - Update a code
 * - DELETE /api/promo-competitions/admin/codes/:id - Deactivate a code
 * - GET /api/promo-competitions/admin/stats - Get statistics
 * - POST /api/promo-competitions/admin/codes/bulk - Generate bulk codes
 */

// Response helpers
function jsonResponse(
  data: object,
  status: number = 200,
  origin?: string | null,
): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] =
      "content-type, authorization, x-admin-api-key";
    headers["Access-Control-Allow-Methods"] =
      "GET, POST, PATCH, DELETE, OPTIONS";
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function errorResponse(
  message: string,
  status: number = 400,
  origin?: string | null,
): Response {
  return jsonResponse({ error: message, ok: false }, status, origin);
}

// UUID validation
function isValidUUID(str: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

// Get Supabase client with service role
function getSupabaseClient(): SupabaseClient {
  const supabaseUrl =
    Netlify.env.get("VITE_SUPABASE_URL") || Netlify.env.get("SUPABASE_URL");
  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl) throw new Error("Missing SUPABASE_URL");
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Verify Admin API Key
function verifyAdminApiKey(request: Request): boolean {
  const authHeader = request.headers.get("Authorization");
  const apiKeyHeader = request.headers.get("X-Admin-Api-Key");

  const adminApiKey = Netlify.env.get("ADMIN_API_KEY");
  if (!adminApiKey) {
    console.warn("[promo-competition-service] ADMIN_API_KEY not configured");
    return false;
  }

  if (apiKeyHeader && apiKeyHeader === adminApiKey) return true;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "").trim();
    if (token === adminApiKey) return true;
  }

  return false;
}

// Verify wallet token authentication
async function verifyWalletToken(
  token: string,
  supabase: SupabaseClient,
): Promise<{ userId: string; profileId: string } | null> {
  if (!token.startsWith("wallet:")) return null;

  const walletAddress = token.replace("wallet:", "").trim().toLowerCase();
  if (!isWalletAddress(walletAddress)) return null;

  const { data: user } = await supabase
    .from("canonical_users")
    .select("id, privy_user_id, wallet_address")
    .or(
      `wallet_address.ilike.${walletAddress},base_wallet_address.ilike.${walletAddress},eth_wallet_address.ilike.${walletAddress}`,
    )
    .maybeSingle();

  if (user) {
    const canonicalUserId = toPrizePid(
      user.privy_user_id || user.wallet_address || walletAddress,
    );
    return { userId: canonicalUserId, profileId: user.id };
  }

  return null;
}

// Get authenticated user from request
async function getAuthenticatedUser(
  request: Request,
  supabase: SupabaseClient,
): Promise<{ userId: string; profileId: string } | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.replace("Bearer ", "").trim();
  if (!token || token.length < 10) return null;

  const walletUser = await verifyWalletToken(token, supabase);
  if (walletUser) return walletUser;

  // Fallback to Supabase auth
  const anonKey =
    Netlify.env.get("VITE_SUPABASE_ANON_KEY") ||
    Netlify.env.get("SUPABASE_ANON_KEY");
  const supabaseUrl =
    Netlify.env.get("VITE_SUPABASE_URL") || Netlify.env.get("SUPABASE_URL");

  if (!anonKey || !supabaseUrl) return null;

  const anonClient = createClient(supabaseUrl, anonKey);
  const {
    data: { user },
    error,
  } = await anonClient.auth.getUser(token);

  if (error || !user) return null;

  return { userId: user.id, profileId: user.id };
}

// Generate random code
function generatePromoCode(length: number = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Avoiding confusing chars: 0, O, I, 1
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// ============ USER HANDLERS ============

async function handleRedeemCode(
  userId: string,
  body: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<Response> {
  const { code } = body;

  if (!code || typeof code !== "string") {
    return errorResponse("Promo code is required");
  }

  // Call the redeem_promo_code function
  const { data, error } = await supabase.rpc("redeem_promo_code", {
    p_code: code.trim().toUpperCase(),
    p_canonical_user_id: userId,
  });

  if (error) {
    console.error("[promo-competition-service] Redeem error:", error);
    return errorResponse("Failed to redeem code", 500);
  }

  if (!data?.success) {
    return errorResponse(data?.error || "Failed to redeem code", 400);
  }

  return jsonResponse({
    ok: true,
    ...data,
  });
}

async function handleGetMyEntries(
  userId: string,
  supabase: SupabaseClient,
): Promise<Response> {
  // Get all competitions where user has redeemed codes
  const { data: redemptions, error } = await supabase
    .from("promo_competition_redemptions")
    .select(
      `
      id,
      entries_granted,
      ticket_numbers,
      redeemed_at,
      promo_competitions (
        id,
        title,
        description,
        image_url,
        prize_name,
        prize_description,
        prize_value,
        total_tickets,
        tickets_allocated,
        status,
        start_date,
        end_date,
        draw_date,
        winning_ticket_numbers
      )
    `,
    )
    .eq("canonical_user_id", userId)
    .order("redeemed_at", { ascending: false });

  if (error) {
    console.error("[promo-competition-service] Get entries error:", error);
    return errorResponse("Failed to fetch entries", 500);
  }

  // Also get user's ticket details
  const { data: tickets } = await supabase
    .from("promo_competition_tickets")
    .select("promo_competition_id, ticket_number, is_winner")
    .eq("canonical_user_id", userId);

  // Group tickets by competition
  const ticketsByComp: Record<string, { number: number; isWinner: boolean }[]> =
    {};
  (tickets || []).forEach((t) => {
    if (!ticketsByComp[t.promo_competition_id]) {
      ticketsByComp[t.promo_competition_id] = [];
    }
    ticketsByComp[t.promo_competition_id].push({
      number: t.ticket_number,
      isWinner: t.is_winner || false,
    });
  });

  // Enrich redemptions with ticket details
  const entries = (redemptions || []).map((r) => {
    const comp = r.promo_competitions as any;
    return {
      redemption_id: r.id,
      entries_granted: r.entries_granted,
      redeemed_at: r.redeemed_at,
      competition: comp,
      tickets: ticketsByComp[comp?.id] || [],
      hasWinningTicket: (ticketsByComp[comp?.id] || []).some((t) => t.isWinner),
    };
  });

  return jsonResponse({ ok: true, entries });
}

async function handleGetCompetition(
  competitionId: string,
  userId: string,
  supabase: SupabaseClient,
): Promise<Response> {
  if (!isValidUUID(competitionId)) {
    return errorResponse("Invalid competition ID");
  }

  // Check if user has access (redeemed a code for this competition)
  const { data: access } = await supabase
    .from("promo_competition_redemptions")
    .select("id")
    .eq("promo_competition_id", competitionId)
    .eq("canonical_user_id", userId)
    .maybeSingle();

  if (!access) {
    return errorResponse(
      "You do not have access to this competition. Redeem a valid code first.",
      403,
    );
  }

  // Get competition details
  const { data: competition, error } = await supabase
    .from("promo_competitions")
    .select("*")
    .eq("id", competitionId)
    .single();

  if (error || !competition) {
    return errorResponse("Competition not found", 404);
  }

  // Get user's tickets
  const { data: tickets } = await supabase
    .from("promo_competition_tickets")
    .select("ticket_number, is_winner")
    .eq("promo_competition_id", competitionId)
    .eq("canonical_user_id", userId);

  return jsonResponse({
    ok: true,
    competition,
    my_tickets: tickets || [],
  });
}

// ============ ADMIN HANDLERS ============

async function handleAdminCreateCompetition(
  body: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<Response> {
  const {
    title,
    description,
    image_url,
    prize_name,
    prize_description,
    prize_value,
    total_tickets,
    start_date,
    end_date,
    draw_date,
    status,
  } = body;

  if (!title || !prize_name) {
    return errorResponse("title and prize_name are required");
  }

  const { data, error } = await supabase
    .from("promo_competitions")
    .insert({
      title,
      description: description || null,
      image_url: image_url || null,
      prize_name,
      prize_description: prize_description || null,
      prize_value: prize_value || null,
      total_tickets: total_tickets || 1000,
      status: status || "draft",
      start_date: start_date || null,
      end_date: end_date || null,
      draw_date: draw_date || null,
    })
    .select()
    .single();

  if (error) {
    console.error(
      "[promo-competition-service] Create competition error:",
      error,
    );
    return errorResponse("Failed to create competition", 500);
  }

  return jsonResponse({ ok: true, competition: data }, 201);
}

async function handleAdminListCompetitions(
  searchParams: URLSearchParams,
  supabase: SupabaseClient,
): Promise<Response> {
  const status = searchParams.get("status");
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");

  let query = supabase
    .from("promo_competitions")
    .select("*, promo_competition_codes(count)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error, count } = await query;

  if (error) {
    console.error(
      "[promo-competition-service] List competitions error:",
      error,
    );
    return errorResponse("Failed to list competitions", 500);
  }

  return jsonResponse({ ok: true, competitions: data, total: count });
}

async function handleAdminUpdateCompetition(
  competitionId: string,
  body: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<Response> {
  if (!isValidUUID(competitionId)) {
    return errorResponse("Invalid competition ID");
  }

  const allowedFields = [
    "title",
    "description",
    "image_url",
    "prize_name",
    "prize_description",
    "prize_value",
    "total_tickets",
    "status",
    "start_date",
    "end_date",
    "draw_date",
    "winning_ticket_numbers",
    "drawn_at",
    "vrf_status",
    "vrf_random_word",
  ];

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates[field] = body[field];
    }
  }

  const { data, error } = await supabase
    .from("promo_competitions")
    .update(updates)
    .eq("id", competitionId)
    .select()
    .single();

  if (error) {
    console.error(
      "[promo-competition-service] Update competition error:",
      error,
    );
    return errorResponse("Failed to update competition", 500);
  }

  return jsonResponse({ ok: true, competition: data });
}

async function handleAdminDeleteCompetition(
  competitionId: string,
  supabase: SupabaseClient,
): Promise<Response> {
  if (!isValidUUID(competitionId)) {
    return errorResponse("Invalid competition ID");
  }

  // Soft delete by setting status to cancelled
  const { error } = await supabase
    .from("promo_competitions")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", competitionId);

  if (error) {
    console.error(
      "[promo-competition-service] Delete competition error:",
      error,
    );
    return errorResponse("Failed to delete competition", 500);
  }

  return jsonResponse({ ok: true, deleted: true });
}

async function handleAdminCreateCode(
  body: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<Response> {
  const {
    promo_competition_id,
    code,
    entries_granted,
    max_redemptions,
    valid_from,
    valid_until,
    restricted_to_user_id,
    description,
  } = body;

  if (!promo_competition_id || !isValidUUID(promo_competition_id as string)) {
    return errorResponse("Valid promo_competition_id is required");
  }

  if (
    !entries_granted ||
    typeof entries_granted !== "number" ||
    entries_granted < 1
  ) {
    return errorResponse("entries_granted must be a positive number");
  }

  const finalCode = (code as string) || generatePromoCode();

  const { data, error } = await supabase
    .from("promo_competition_codes")
    .insert({
      promo_competition_id,
      code: finalCode.toUpperCase(),
      entries_granted,
      max_redemptions: max_redemptions || null,
      valid_from: valid_from || new Date().toISOString(),
      valid_until: valid_until || null,
      restricted_to_user_id: restricted_to_user_id || null,
      description: description || null,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      // Unique violation
      return errorResponse(
        "A code with this name already exists for this competition",
        409,
      );
    }
    console.error("[promo-competition-service] Create code error:", error);
    return errorResponse("Failed to create code", 500);
  }

  return jsonResponse({ ok: true, code: data }, 201);
}

async function handleAdminBulkCreateCodes(
  body: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<Response> {
  const {
    promo_competition_id,
    count,
    entries_granted,
    max_redemptions,
    valid_from,
    valid_until,
    prefix,
    description,
  } = body;

  if (!promo_competition_id || !isValidUUID(promo_competition_id as string)) {
    return errorResponse("Valid promo_competition_id is required");
  }

  const codeCount = (count as number) || 10;
  if (codeCount < 1 || codeCount > 1000) {
    return errorResponse("count must be between 1 and 1000");
  }

  const entriesPerCode = (entries_granted as number) || 1;
  const codePrefix = ((prefix as string) || "").toUpperCase();

  const codes: Array<{
    promo_competition_id: string;
    code: string;
    entries_granted: number;
    max_redemptions: number | null;
    valid_from: string;
    valid_until: string | null;
    description: string | null;
    is_active: boolean;
  }> = [];

  // Generate unique codes
  const existingCodes = new Set<string>();
  for (let i = 0; i < codeCount; i++) {
    let code: string;
    do {
      code = codePrefix + generatePromoCode(codePrefix ? 6 : 8);
    } while (existingCodes.has(code));
    existingCodes.add(code);

    codes.push({
      promo_competition_id: promo_competition_id as string,
      code,
      entries_granted: entriesPerCode,
      max_redemptions: (max_redemptions as number) || null,
      valid_from: (valid_from as string) || new Date().toISOString(),
      valid_until: (valid_until as string) || null,
      description: (description as string) || `Bulk generated code`,
      is_active: true,
    });
  }

  const { data, error } = await supabase
    .from("promo_competition_codes")
    .insert(codes)
    .select();

  if (error) {
    console.error(
      "[promo-competition-service] Bulk create codes error:",
      error,
    );
    return errorResponse("Failed to create codes", 500);
  }

  return jsonResponse(
    {
      ok: true,
      created: data?.length || 0,
      codes: data,
    },
    201,
  );
}

async function handleAdminListCodes(
  searchParams: URLSearchParams,
  supabase: SupabaseClient,
): Promise<Response> {
  const competitionId = searchParams.get("competition_id");
  const activeOnly = searchParams.get("active_only") === "true";
  const limit = parseInt(searchParams.get("limit") || "100");
  const offset = parseInt(searchParams.get("offset") || "0");

  let query = supabase
    .from("promo_competition_codes")
    .select(
      `
      *,
      promo_competitions (id, title, status)
    `,
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (competitionId && isValidUUID(competitionId)) {
    query = query.eq("promo_competition_id", competitionId);
  }

  if (activeOnly) {
    query = query.eq("is_active", true);
  }

  const { data, error, count } = await query;

  if (error) {
    console.error("[promo-competition-service] List codes error:", error);
    return errorResponse("Failed to list codes", 500);
  }

  return jsonResponse({ ok: true, codes: data, total: count });
}

async function handleAdminUpdateCode(
  codeId: string,
  body: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<Response> {
  if (!isValidUUID(codeId)) {
    return errorResponse("Invalid code ID");
  }

  const allowedFields = [
    "entries_granted",
    "max_redemptions",
    "valid_from",
    "valid_until",
    "is_active",
    "restricted_to_user_id",
    "description",
  ];

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates[field] = body[field];
    }
  }

  const { data, error } = await supabase
    .from("promo_competition_codes")
    .update(updates)
    .eq("id", codeId)
    .select()
    .single();

  if (error) {
    console.error("[promo-competition-service] Update code error:", error);
    return errorResponse("Failed to update code", 500);
  }

  return jsonResponse({ ok: true, code: data });
}

async function handleAdminDeleteCode(
  codeId: string,
  supabase: SupabaseClient,
): Promise<Response> {
  if (!isValidUUID(codeId)) {
    return errorResponse("Invalid code ID");
  }

  // Soft delete by deactivating
  const { error } = await supabase
    .from("promo_competition_codes")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", codeId);

  if (error) {
    console.error("[promo-competition-service] Delete code error:", error);
    return errorResponse("Failed to delete code", 500);
  }

  return jsonResponse({ ok: true, deactivated: true });
}

async function handleAdminGetStats(
  supabase: SupabaseClient,
): Promise<Response> {
  // Get competition counts by status
  const { data: compStats } = await supabase
    .from("promo_competitions")
    .select("status")
    .then(({ data }) => {
      const counts: Record<string, number> = {};
      (data || []).forEach((c) => {
        counts[c.status] = (counts[c.status] || 0) + 1;
      });
      return { data: counts };
    });

  // Get total redemptions
  const { count: totalRedemptions } = await supabase
    .from("promo_competition_redemptions")
    .select("*", { count: "exact", head: true });

  // Get total tickets allocated
  const { data: ticketStats } = await supabase
    .from("promo_competitions")
    .select("tickets_allocated")
    .then(({ data }) => {
      const total = (data || []).reduce(
        (sum, c) => sum + (c.tickets_allocated || 0),
        0,
      );
      return { data: { total_tickets_allocated: total } };
    });

  // Get code stats
  const { data: codeStats } = await supabase
    .from("promo_competition_codes")
    .select("is_active, current_redemptions")
    .then(({ data }) => {
      let active = 0;
      let inactive = 0;
      let totalCodeRedemptions = 0;
      (data || []).forEach((c) => {
        if (c.is_active) active++;
        else inactive++;
        totalCodeRedemptions += c.current_redemptions || 0;
      });
      return {
        data: {
          active_codes: active,
          inactive_codes: inactive,
          total_code_redemptions: totalCodeRedemptions,
        },
      };
    });

  return jsonResponse({
    ok: true,
    stats: {
      competitions_by_status: compStats,
      total_redemptions: totalRedemptions || 0,
      ...ticketStats,
      ...codeStats,
    },
  });
}

async function handleAdminGetRedemptions(
  searchParams: URLSearchParams,
  supabase: SupabaseClient,
): Promise<Response> {
  const competitionId = searchParams.get("competition_id");
  const codeId = searchParams.get("code_id");
  const limit = parseInt(searchParams.get("limit") || "100");
  const offset = parseInt(searchParams.get("offset") || "0");

  let query = supabase
    .from("promo_competition_redemptions")
    .select(
      `
      *,
      promo_competitions (id, title),
      promo_competition_codes (id, code, entries_granted)
    `,
      { count: "exact" },
    )
    .order("redeemed_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (competitionId && isValidUUID(competitionId)) {
    query = query.eq("promo_competition_id", competitionId);
  }

  if (codeId && isValidUUID(codeId)) {
    query = query.eq("code_id", codeId);
  }

  const { data, error, count } = await query;

  if (error) {
    console.error("[promo-competition-service] Get redemptions error:", error);
    return errorResponse("Failed to get redemptions", 500);
  }

  return jsonResponse({ ok: true, redemptions: data, total: count });
}

// ============ MAIN HANDLER ============

export default async function handler(
  request: Request,
  context: Context,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace("/api/promo-competitions", "");
  const method = request.method;
  const origin = request.headers.get("Origin");

  // Handle CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin || "*",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":
          "content-type, authorization, x-admin-api-key",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  try {
    const supabase = getSupabaseClient();
    const isAdmin = verifyAdminApiKey(request);

    // Parse body for POST/PATCH
    let body: Record<string, unknown> = {};
    if (method === "POST" || method === "PATCH") {
      try {
        body = await request.json();
      } catch {
        // Empty body is ok for some endpoints
      }
    }

    // ============ ADMIN ROUTES ============
    if (path.startsWith("/admin")) {
      if (!isAdmin) {
        return errorResponse(
          "Unauthorized - Admin API key required",
          401,
          origin,
        );
      }

      // POST /admin/competitions - Create competition
      if (path === "/admin/competitions" && method === "POST") {
        return handleAdminCreateCompetition(body, supabase);
      }

      // GET /admin/competitions - List competitions
      if (path === "/admin/competitions" && method === "GET") {
        return handleAdminListCompetitions(url.searchParams, supabase);
      }

      // PATCH /admin/competitions/:id - Update competition
      const compUpdateMatch = path.match(/^\/admin\/competitions\/([^/]+)$/);
      if (compUpdateMatch && method === "PATCH") {
        return handleAdminUpdateCompetition(compUpdateMatch[1], body, supabase);
      }

      // DELETE /admin/competitions/:id - Delete competition
      if (compUpdateMatch && method === "DELETE") {
        return handleAdminDeleteCompetition(compUpdateMatch[1], supabase);
      }

      // POST /admin/codes - Create code
      if (path === "/admin/codes" && method === "POST") {
        return handleAdminCreateCode(body, supabase);
      }

      // POST /admin/codes/bulk - Bulk create codes
      if (path === "/admin/codes/bulk" && method === "POST") {
        return handleAdminBulkCreateCodes(body, supabase);
      }

      // GET /admin/codes - List codes
      if (path === "/admin/codes" && method === "GET") {
        return handleAdminListCodes(url.searchParams, supabase);
      }

      // PATCH /admin/codes/:id - Update code
      const codeUpdateMatch = path.match(/^\/admin\/codes\/([^/]+)$/);
      if (codeUpdateMatch && method === "PATCH") {
        return handleAdminUpdateCode(codeUpdateMatch[1], body, supabase);
      }

      // DELETE /admin/codes/:id - Deactivate code
      if (codeUpdateMatch && method === "DELETE") {
        return handleAdminDeleteCode(codeUpdateMatch[1], supabase);
      }

      // GET /admin/stats - Get statistics
      if (path === "/admin/stats" && method === "GET") {
        return handleAdminGetStats(supabase);
      }

      // GET /admin/redemptions - Get redemptions
      if (path === "/admin/redemptions" && method === "GET") {
        return handleAdminGetRedemptions(url.searchParams, supabase);
      }

      return errorResponse("Admin endpoint not found", 404, origin);
    }

    // ============ USER ROUTES ============
    const authUser = await getAuthenticatedUser(request, supabase);
    if (!authUser) {
      return errorResponse("Authentication required", 401, origin);
    }

    const { userId } = authUser;

    // POST /redeem - Redeem code
    if (path === "/redeem" && method === "POST") {
      return handleRedeemCode(userId, body, supabase);
    }

    // GET /my-entries - Get user's entries
    if (path === "/my-entries" && method === "GET") {
      return handleGetMyEntries(userId, supabase);
    }

    // GET /:id - Get specific competition
    const compMatch = path.match(/^\/([^/]+)$/);
    if (compMatch && method === "GET") {
      return handleGetCompetition(compMatch[1], userId, supabase);
    }

    return errorResponse("Endpoint not found", 404, origin);
  } catch (err) {
    console.error("[promo-competition-service] Unexpected error:", err);
    return errorResponse("Internal server error", 500, origin);
  }
}

export const config: Config = {
  path: "/api/promo-competitions/*",
};
