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

/**
 * Create New User Function - Updated for Canonical prize:pid: Format
 *
 * This function creates or updates user profiles with canonical prize:pid: user IDs.
 * All user identifiers are now stored in the format: prize:pid:<id>
 *
 * Changes from legacy:
 * - Converts all wallet addresses to prize:pid:<wallet-lowercase>
 * - Converts legacy Privy DIDs to prize:pid:<uuid>
 * - Normalizes all identifiers to lowercase for case-insensitive matching
 * - Removes Privy DID dependencies
 *
 * Note: isWalletAddress is imported from the shared userId module above
 */

Deno.serve(async (req: Request) => {
  // Handle CORS preflight - no auth required
  if (req.method === "OPTIONS") {
    return handleCorsOptions(req);
  }

  // Get origin for CORS headers on all responses
  const corsHeaders = buildCorsHeaders(req.headers.get('origin'));

  try {
    const body = await req.json();
    const {
      // Accept user_identifier (wallet address or privy_user_id) as the canonical identifier
      // For Base auth: wallet address (0x...)
      // For legacy Privy auth: DID (did:privy:...)
      user_identifier,
      privy_user_id,        // Legacy parameter name - kept for backward compatibility
      email = null,
      username = null,
      avatar_url = "/default-avatar.png",
      telephone_number = null,
      wallet_address = null,
      // Optional legacy linkage
      link_legacy_user = false,
    } = body || {};

    // Support both new user_identifier and legacy privy_user_id parameters
    const effectiveIdentifier = user_identifier || privy_user_id;

    if (!effectiveIdentifier) {
      return new Response(
        JSON.stringify({ error: { code: "MISSING_USER_IDENTIFIER", message: "user_identifier (wallet address or privy_user_id) is required" } }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Convert to canonical prize:pid: format
    const canonicalUserId = toPrizePid(effectiveIdentifier);
    console.log(`[create-new-user] Canonical user ID: ${canonicalUserId}`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase configuration missing");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Determine the effective wallet address - always normalize to lowercase
    // If user_identifier is a wallet address, use it as wallet_address too
    const effectiveWalletAddress = wallet_address 
      ? normalizeWalletAddress(wallet_address) 
      : (isWalletAddress(effectiveIdentifier) ? normalizeWalletAddress(effectiveIdentifier) : null);

    // 1) Upsert into canonical_users (canonical)
    // Now uses canonical_user_id as the primary identifier in prize:pid: format
    const { data: upserted, error: upsertErr } = await supabase
      .from("canonical_users")
      .upsert(
        {
          canonical_user_id: canonicalUserId,  // NEW: Canonical prize:pid: format
          privy_user_id: effectiveIdentifier,  // LEGACY: Keep for backward compatibility during transition
          email,
          username,
          avatar_url,
          telephone_number,
          wallet_address: effectiveWalletAddress,
          base_wallet_address: effectiveWalletAddress,
          available_balance: 0,
          has_used_new_user_bonus: false,
        },
        { onConflict: "canonical_user_id" }  // Use canonical_user_id as conflict key
      )
      .select("canonical_user_id, privy_user_id, email, username, avatar_url, available_balance, has_used_new_user_bonus, wallet_address")
      .maybeSingle();

    if (upsertErr) {
      throw new Error(`Failed to upsert canonical_users: ${upsertErr.message}`);
    }

    // 2) Optionally link legacy users table by setting users.privy_user_id if a users row already exists
    let legacyLinked = false;
    if (link_legacy_user) {
      // Try to find an existing users row that matches wallet_address or email; if found, set privy_user_id
      if (effectiveWalletAddress || email) {
        const filters: string[] = [];
        if (effectiveWalletAddress) filters.push(`wallet_address.eq.${effectiveWalletAddress}`);
        if (email) filters.push(`email.eq.${email}`);

        const orFilter = filters.join(",");
        let query = supabase.from("users").select("id, wallet_address, email, privy_user_id");
        if (orFilter) query = query.or(orFilter);

        const { data: existingUsers, error: existingErr } = await query.limit(1);
        if (!existingErr && existingUsers && existingUsers.length > 0) {
          const target = existingUsers[0];
          if (toPrizePid(target.privy_user_id) !== canonicalUserId) {
            const { error: linkErr } = await supabase
              .from("users")
              .update({ privy_user_id: canonicalUserId })  // Use canonical ID
              .eq("id", target.id);
            if (!linkErr) legacyLinked = true;
          } else {
            legacyLinked = true;
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        data: {
          success: true,
          profile: upserted,
          canonical_user_id: canonicalUserId,  // Return canonical ID
          legacy_linked: legacyLinked,
          message: "User created/updated successfully with canonical prize:pid: format",
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("create-new-user error:", error);
    return new Response(
      JSON.stringify({ error: { code: "CREATE_USER_ERROR", message: (error as Error).message } }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
