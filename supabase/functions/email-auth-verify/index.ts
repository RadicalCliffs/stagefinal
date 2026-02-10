import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);

  // Handle CORS preflight - no auth required
  if (req.method === "OPTIONS") {
    return handleCorsOptions(req);
  }

  // Get origin for CORS headers on all responses
  const corsHeaders = buildCorsHeaders(req.headers.get('origin'));

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      console.error(`[email-auth-verify][${requestId}] Missing Supabase config`);
      return new Response(
        JSON.stringify({ success: false, error: "Server misconfigured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch((err) => {
      console.error(`[email-auth-verify][${requestId}] Invalid JSON`, err);
      return null;
    });

    const { sessionId, code } = body || {};

    if (!sessionId || !code) {
      return new Response(
        JSON.stringify({ success: false, error: "sessionId and code are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data, error } = await supabase
      .from("email_auth_sessions")
      .select("id, email, verification_code, expires_at, verified_at, used_at")
      .eq("id", sessionId)
      .maybeSingle();

    if (error || !data) {
      console.error(`[email-auth-verify][${requestId}] Session not found`, error);
      return new Response(
        JSON.stringify({ success: false, error: "Invalid session" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (data.used_at) {
      return new Response(
        JSON.stringify({ success: false, error: "Code already used" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const now = new Date();
    if (new Date(data.expires_at) < now) {
      return new Response(
        JSON.stringify({ success: false, error: "Code expired" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (String(data.verification_code) !== String(code)) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid code" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { error: updateError } = await supabase
      .from("email_auth_sessions")
      .update({
        verified_at: data.verified_at || now.toISOString(),
        used_at: now.toISOString(),
      })
      .eq("id", data.id);

    if (updateError) {
      console.error(`[email-auth-verify][${requestId}] Failed to update session`, updateError);
    }

    // Check if this email is already linked to a Privy account
    const { data: existingUser, error: userLookupError } = await supabase
      .from("canonical_users")
      .select("id, privy_user_id, email, wallet_address")
      .eq("email", data.email)
      .not("privy_user_id", "is", null)
      .maybeSingle();

    if (userLookupError) {
      console.error(`[email-auth-verify][${requestId}] Error looking up existing user`, userLookupError);
    }

    // Return whether this email has a linked Privy account
    const hasLinkedPrivyAccount = existingUser?.privy_user_id ? true : false;

    console.log(`[email-auth-verify][${requestId}] Email verified: ${data.email}, hasLinkedPrivyAccount: ${hasLinkedPrivyAccount}`);

    return new Response(
      JSON.stringify({
        success: true,
        email: data.email,
        hasLinkedPrivyAccount,
        // If linked, provide hint to frontend that this is a returning user
        isReturningUser: hasLinkedPrivyAccount,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error(`[email-auth-verify][${requestId}] Fatal error`, error);
    return new Response(
      JSON.stringify({ success: false, error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
