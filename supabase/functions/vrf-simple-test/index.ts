import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function res(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (req.method !== "POST") return res(405, { ok: false, error: "POST only" });

  try {
    // Check what environment variables are available
    const envVars = {
      SUPABASE_URL: Deno.env.get("SUPABASE_URL") ? "✅ Set" : "❌ Missing",
      SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ? "✅ Set" : "❌ Missing",
      BASE_MAINNET_RPC: Deno.env.get("BASE_MAINNET_RPC") ? "✅ Set" : "❌ Missing",
      ADMIN_WALLET_PRIVATE_KEY: Deno.env.get("ADMIN_WALLET_PRIVATE_KEY") ? "✅ Set" : "❌ Missing",
      VRF_CONSUMER_ADDRESS: Deno.env.get("VRF_CONSUMER_ADDRESS") ? "✅ Set" : "❌ Missing",
    };

    return res(200, {
      ok: true,
      message: "Environment check complete",
      environment: envVars,
      timestamp: new Date().toISOString(),
    });

  } catch (e) {
    return res(500, { ok: false, error: (e as Error).message });
  }
});
