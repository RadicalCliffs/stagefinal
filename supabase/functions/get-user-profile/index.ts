import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { toPrizePid, normalizeWalletAddress, isWalletAddress } from "../_shared/userId.ts";

// Inlined CORS configuration (bundler doesn't support shared module imports)
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://stage.theprize.io';
const ALLOWED_ORIGINS = [
  SITE_URL,
  'https://stage.theprize.io',
  'https://theprize.io',
  'https://theprizeio.netlify.app',
  'https://www.theprize.io',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8888',
];

function getCorsOrigin(requestOrigin: string | null): string {
  // Validate request origin is in allowed list
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
    return requestOrigin;
  }
  
  // Always return a specific origin (never empty string or wildcard)
  // This is required when using Access-Control-Allow-Credentials: true
  return SITE_URL;
}

function buildCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const origin = getCorsOrigin(requestOrigin);
  
  // Ensure we never return empty string (required for credentials: true)
  if (!origin) {
    throw new Error('CORS origin cannot be empty when using credentials');
  }
  
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control, pragma, expires',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function handleCorsOptions(req: Request): Response {
  const origin = req.headers.get('origin');
  return new Response(null, {
    status: 200,  // Use 200 instead of 204 for better compatibility
    headers: buildCorsHeaders(origin),
  });
}

// Note: isWalletAddress is imported from the shared userId module above

Deno.serve(async (req: Request) => {
  // Handle CORS preflight - no auth required
  if (req.method === "OPTIONS") {
    return handleCorsOptions(req);
  }

  // Get origin for CORS headers on all responses
  const corsHeaders = buildCorsHeaders(req.headers.get('origin'));

  try {
    // Accept user_identifier (wallet address or privy_user_id) as canonical identity
    let inputUserId: string | null = null;

    if (req.method === "GET") {
      const url = new URL(req.url);
      // Support both user_identifier and legacy privy_user_id parameters
      inputUserId = url.searchParams.get("user_identifier") || url.searchParams.get("privy_user_id");
    } else {
      const body = await req.json().catch(() => ({}));
      inputUserId = body.user_identifier || body.privy_user_id || body.user_id || null;
    }

    if (!inputUserId) {
      return new Response(
        JSON.stringify({ error: { code: "MISSING_USER_IDENTIFIER", message: "user_identifier (wallet address or privy_user_id) is required" } }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Convert to canonical format
    const canonicalUserId = toPrizePid(inputUserId);
    console.log(`[get-user-profile] Canonical user ID: ${canonicalUserId}`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase configuration missing");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // 1) Profile + Wallet (from canonical_users)
    // Query by canonical_user_id (primary) with fallback to legacy fields during transition
    const { data, error } = await supabase
      .from("canonical_users")
      .select("canonical_user_id, privy_user_id, email, username, avatar_url, available_balance, has_used_new_user_bonus, wallet_address, base_wallet_address")
      .eq("canonical_user_id", canonicalUserId)
      .maybeSingle();
    
    // If not found by canonical ID, try legacy lookup for backward compatibility
    let puc = data;
    if (!puc && inputUserId) {
      console.log(`[get-user-profile] Canonical lookup failed, trying legacy lookup`);
      const { data: legacyData } = await supabase
        .from("canonical_users")
        .select("canonical_user_id, privy_user_id, email, username, avatar_url, available_balance, has_used_new_user_bonus, wallet_address, base_wallet_address")
        .or(`privy_user_id.eq.${inputUserId},wallet_address.ilike.${inputUserId},base_wallet_address.ilike.${inputUserId}`)
        .maybeSingle();
      puc = legacyData;
    }

    if (error && !puc) {
      console.error(`[get-user-profile] Failed to load profile:`, error);
    }

    // Provide default profile if not found (but do not error hard)
    const profile = puc || {
      canonical_user_id: canonicalUserId,
      privy_user_id: inputUserId,
      email: null,
      username: null,
      avatar_url: null,
      available_balance: 0,
      has_used_new_user_bonus: false,
      wallet_address: isWalletAddress(inputUserId) ? inputUserId.toLowerCase() : null,
    };

    // 2) Canonical tickets for this user (group by competition)
    // Query using canonical user ID
    const { data: userTickets, error: ticketsErr } = await supabase
      .from("tickets")
      .select("competition_id, ticket_number, purchased_at")
      .eq("user_id", canonicalUserId)
      .order("purchased_at", { ascending: false });

    if (ticketsErr) {
      console.error(`[get-user-profile] Failed to load tickets:`, ticketsErr);
    }

    const byCompetition: Record<string, { competition_id: string; count: number; ticket_numbers: number[] }> = {};
    const recentTickets: { competition_id: string; ticket_number: number; purchased_at: string | null }[] = [];

    for (const t of userTickets || []) {
      const compId = t.competition_id as string;
      const num = Number(t.ticket_number);
      if (!byCompetition[compId]) byCompetition[compId] = { competition_id: compId, count: 0, ticket_numbers: [] };
      byCompetition[compId].count += 1;
      byCompetition[compId].ticket_numbers.push(num);

      if (recentTickets.length < 50) {
        recentTickets.push({ competition_id: compId, ticket_number: num, purchased_at: t.purchased_at });
      }
    }

    const competitionsSummary = Object.values(byCompetition).map((g) => ({
      competition_id: g.competition_id,
      ticket_count: g.count,
      ticket_numbers: g.ticket_numbers,
    }));

    // 3) Recent orders summary - query by canonical user ID
    const { data: orders, error: ordersErr } = await supabase
      .from("orders")
      .select("id, competition_id, amount_usd, payment_status, created_at")
      .eq("user_id", canonicalUserId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (ordersErr) throw new Error(`Failed to load orders: ${ordersErr.message}`);

    const response = {
      user_identifier: canonicalUserId,
      privy_user_id: profile.privy_user_id, // Kept for backward compatibility
      wallet_address: profile.wallet_address || (isWalletAddress(inputUserId) ? inputUserId.toLowerCase() : null),
      profile: {
        email: profile.email,
        username: profile.username,
        avatar_url: profile.avatar_url,
        has_used_new_user_bonus: profile.has_used_new_user_bonus,
      },
      wallet: {
        available_balance: Number(profile.available_balance ?? 0),
      },
      tickets: {
        total_count: (userTickets || []).length,
        by_competition: competitionsSummary,
        recent: recentTickets,
      },
      orders: orders || [],
    };

    return new Response(JSON.stringify({ data: response }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("get-user-profile error:", error);

    return new Response(
      JSON.stringify({ error: { code: "PROFILE_FETCH_FAILED", message: (error as Error).message } }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
