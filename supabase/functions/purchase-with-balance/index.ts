// purchase-with-balance Edge Function (with built-in rescue flow)
// Hotfix: ensure competitionId from body passes through even when body is FormData or text
// Fixed: Query canonical_users instead of user_profiles

import { createClient } from "npm:@supabase/supabase-js@2.45.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function parseAuthHeader(authHeader?: string | null) {
  if (!authHeader) return null;
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") return null;
  return parts[1];
}

function normalizeCanonicalId(id?: string | null) {
  if (!id) return null;
  const trimmed = id.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("prize:pid:") ? trimmed.toLowerCase() : `prize:pid:${trimmed.toLowerCase()}`;
}

function normalizeWallet(addr?: string | null) {
  if (!addr) return null;
  return addr.trim().toLowerCase();
}

async function readBody(req: Request): Promise<any> {
  const ct = req.headers.get("content-type")?.toLowerCase() || "";
  try {
    if (ct.includes("application/json")) return await req.json();
    if (ct.includes("application/x-www-form-urlencoded")) {
      const text = await req.text();
      const params = new URLSearchParams(text);
      const obj: Record<string, any> = {};
      for (const [k, v] of params.entries()) obj[k] = v;
      return obj;
    }
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const obj: Record<string, any> = {};
      for (const [k, v] of form.entries()) obj[k] = typeof v === "string" ? v : undefined;
      return obj;
    }
    // Fallback: try JSON, otherwise parse query-like text
    const raw = await req.text();
    try { return JSON.parse(raw); } catch { /* ignore */ }
    const params = new URLSearchParams(raw);
    const obj: Record<string, any> = {};
    for (const [k, v] of params.entries()) obj[k] = v;
    return obj;
  } catch { return {}; }
}

async function resolveCompetition(supabase: any, competition_id?: string | null, competition_uid?: string | null) {
  if (competition_id) return { id: competition_id };
  if (competition_uid) {
    const { data, error } = await supabase
      .from("competitions")
      .select("id")
      .eq("uid", competition_uid)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }
  return null;
}

async function resolveUser(supabase: any, opts: {
  accessToken: string | null,
  user_id?: string | null,
  canonical_user_id?: string | null,
  wallet_address?: string | null,
  uid?: string | null,
}) {
  const found: Record<string, boolean> = { jwt: false, user_id: false, canonical_user_id: false, wallet_address: false, uid: false };

  // Try JWT first
  if (opts.accessToken) {
    const { data: authUser } = await supabase.auth.getUser(opts.accessToken).catch(() => ({ data: null }));
    if (authUser?.user) {
      found.jwt = true;
      // Look up in canonical_users table
      const { data: profile } = await supabase
        .from("canonical_users")
        .select("auth_user_id, canonical_user_id, wallet_address")
        .eq("auth_user_id", authUser.user.id)
        .limit(1)
        .maybeSingle();
      if (profile) {
        return { auth_user_id: profile.auth_user_id, canonical_user_id: profile.canonical_user_id, wallet_address: profile.wallet_address, found };
      }
      return { auth_user_id: authUser.user.id, canonical_user_id: null, wallet_address: null, found };
    }
  }

  // Try user_id lookup
  if (opts.user_id) {
    found.user_id = true;
    const { data: profile } = await supabase
      .from("canonical_users")
      .select("auth_user_id, canonical_user_id, wallet_address")
      .eq("auth_user_id", opts.user_id)
      .limit(1)
      .maybeSingle();
    if (profile) return { ...profile, found };
    return { auth_user_id: opts.user_id, canonical_user_id: null, wallet_address: null, found };
  }

  // Try canonical_user_id lookup
  if (opts.canonical_user_id) {
    found.canonical_user_id = true;
    const canon = opts.canonical_user_id; // Already normalized by caller
    const { data: profile } = await supabase
      .from("canonical_users")
      .select("auth_user_id, canonical_user_id, wallet_address")
      .eq("canonical_user_id", canon)
      .limit(1)
      .maybeSingle();
    if (profile) return { ...profile, found };
    // If not found but we have the canonical_user_id, pass it through directly
    // This handles cases where user exists in sub_account_balances but not canonical_users
    return { auth_user_id: null, canonical_user_id: canon, wallet_address: null, found };
  }

  // Try wallet_address lookup
  if (opts.wallet_address) {
    found.wallet_address = true;
    const wallet = opts.wallet_address; // Already normalized by caller
    const { data: profile } = await supabase
      .from("canonical_users")
      .select("auth_user_id, canonical_user_id, wallet_address")
      .eq("wallet_address", wallet)
      .limit(1)
      .maybeSingle();
    if (profile) return { ...profile, found };
    // If not found but we have wallet, derive canonical_user_id from it
    const derivedCanonical = `prize:pid:${wallet}`;
    return { auth_user_id: null, canonical_user_id: derivedCanonical, wallet_address: wallet, found };
  }

  // Try uid lookup (alias for canonical_user_id)
  if (opts.uid) {
    found.uid = true;
    const canon = normalizeCanonicalId(opts.uid);
    const { data: profile } = await supabase
      .from("canonical_users")
      .select("auth_user_id, canonical_user_id, wallet_address")
      .eq("canonical_user_id", canon)
      .limit(1)
      .maybeSingle();
    if (profile) return { ...profile, found };
    // Pass through if we have a uid
    return { auth_user_id: null, canonical_user_id: canon, wallet_address: null, found };
  }

  return { auth_user_id: null, canonical_user_id: null, wallet_address: null, found };
}

async function performPurchase(supabase: any, args: {
  competition_id: string,
  auth_user_id: string | null,
  canonical_user_id: string | null,
  wallet_address: string | null,
  reservation_id?: string | null,
  ticket_numbers?: number[] | null,
}) {
  const payload = {
    competition_id: args.competition_id,
    reservation_id: args.reservation_id ?? null,
    ticket_numbers: args.ticket_numbers ?? null,
    auth_user_id: args.auth_user_id,
    canonical_user_id: args.canonical_user_id,
    wallet_address: args.wallet_address,
  };
  return await supabase.rpc("purchase_with_balance", payload);
}

async function performRescue(supabase: any, args: {
  competition_id: string,
  auth_user_id: string | null,
  canonical_user_id: string | null,
  wallet_address: string | null,
  reservation_id?: string | null,
  ticket_numbers?: number[] | null,
}) {
  const payload = {
    competition_id: args.competition_id,
    reservation_id: args.reservation_id ?? null,
    ticket_numbers: args.ticket_numbers ?? null,
    auth_user_id: args.auth_user_id,
    canonical_user_id: args.canonical_user_id,
    wallet_address: args.wallet_address,
  };
  return await supabase.rpc("verify_and_rescue_purchase", payload);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, { global: { headers: { "x-client-info": "edge-fn-purchase-with-balance" } } });

    const accessToken = parseAuthHeader(req.headers.get("Authorization"));

    const body = await readBody(req);

    // Support all expected keys and also allow competitionId on querystring
    const competition_id_raw = (
      body.competition_id || body.competitionId || body.competition ||
      url.searchParams.get("competition_id") || url.searchParams.get("competitionId") || url.searchParams.get("competition")
    );
    const competition_uid = body.competition_uid || body.competitionUid || url.searchParams.get("competition_uid") || url.searchParams.get("competitionUid");

    const reservation_id = body.reservation_id ?? body.reservationId ?? url.searchParams.get("reservation_id") ?? url.searchParams.get("reservationId");
    // Accept both array and CSV string for tickets
    let ticket_numbers: number[] | null = null;
    const tn = body.ticket_numbers ?? body.ticketNumbers ?? url.searchParams.get("ticket_numbers") ?? url.searchParams.get("ticketNumbers");
    if (Array.isArray(tn)) ticket_numbers = tn.map((n: any) => Number(n)).filter((n: any) => Number.isFinite(n));
    else if (typeof tn === "string" && tn) ticket_numbers = tn.split(",").map((n) => Number(n.trim())).filter((n) => Number.isFinite(n));

    const uid = body.uid ?? url.searchParams.get("uid");
    const canonical_user_id_raw = body.canonical_user_id ?? body.canonicalUserId ?? url.searchParams.get("canonical_user_id") ?? url.searchParams.get("canonicalUserId");
    const wallet_address_raw = body.wallet_address ?? body.walletAddress ?? url.searchParams.get("wallet_address") ?? url.searchParams.get("walletAddress");
    const user_id = body.user_id ?? body.userId ?? url.searchParams.get("user_id") ?? url.searchParams.get("userId");

    const comp = await resolveCompetition(supabaseAdmin, competition_id_raw, competition_uid);
    if (!comp?.id) {
      return json(400, { error: "missing_competition", received: { competition_id_raw, competition_uid }, hint: "Provide competition_id (uuid) or competition_uid (slug)" });
    }

    const userRes = await resolveUser(supabaseAdmin, {
      accessToken,
      user_id,
      canonical_user_id: normalizeCanonicalId(canonical_user_id_raw),
      wallet_address: normalizeWallet(wallet_address_raw),
      uid,
    });

    const hasAnyUser = Boolean(userRes.auth_user_id || userRes.canonical_user_id || userRes.wallet_address);
    if (!hasAnyUser) {
      return json(400, {
        error: "missing_user_identifier",
        looked_for: ["jwt.auth.uid", "user_id", "canonical_user_id", "wallet_address", "uid"],
        found: userRes.found,
        hint: "Send Authorization: Bearer <user_jwt> or include canonical_user_id or wallet_address",
      });
    }

    const primary = await performPurchase(supabaseAdmin, {
      competition_id: comp.id,
      auth_user_id: userRes.auth_user_id,
      canonical_user_id: userRes.canonical_user_id,
      wallet_address: userRes.wallet_address,
      reservation_id,
      ticket_numbers,
    });

    if (!primary.error) {
      return json(200, { ok: true, phase: "primary", competition_id: comp.id, resolved_user: { auth_user_id: userRes.auth_user_id, canonical_user_id: userRes.canonical_user_id, wallet_address: userRes.wallet_address, sources: userRes.found }, result: primary.data });
    }

    const code = primary.error.code || "";
    const message = (primary.error.message || "").toLowerCase();
    const isValidation = code === "PGRST116" || message.includes("invalid") || message.includes("missing") || message.includes("not found");

    if (isValidation) {
      return json(400, { ok: false, phase: "primary", error: primary.error.code || primary.error.message || "purchase_failed", details: primary.error.details ?? null, hint: primary.error.hint ?? null });
    }

    const rescue = await performRescue(supabaseAdmin, {
      competition_id: comp.id,
      auth_user_id: userRes.auth_user_id,
      canonical_user_id: userRes.canonical_user_id,
      wallet_address: userRes.wallet_address,
      reservation_id,
      ticket_numbers,
    });

    if (!rescue.error) {
      return json(200, { ok: true, phase: "rescue", competition_id: comp.id, resolved_user: { auth_user_id: userRes.auth_user_id, canonical_user_id: userRes.canonical_user_id, wallet_address: userRes.wallet_address, sources: userRes.found }, result: rescue.data });
    }

    return json(400, { ok: false, phase: "rescue_failed", error: rescue.error.code || rescue.error.message || "rescue_failed", primary_error: primary.error.message ?? null, rescue_details: rescue.error.details ?? null, rescue_hint: rescue.error.hint ?? null });
  } catch (e) {
    const message = e?.message || "internal_error";
    return json(500, { error: "internal_error", message });
  }
});
