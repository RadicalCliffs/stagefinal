import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, cache-control, pragma, expires",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function res(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (req.method !== "POST") return res(405, { ok: false, error: "POST only" });

  try {
    console.log('🧪 Basic test function called');
    
    // Test environment variables
    const env = {
      SUPABASE_URL: !!Deno.env.get("SUPABASE_URL"),
      SUPABASE_SERVICE_ROLE_KEY: !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
      BASE_MAINNET_RPC: !!Deno.env.get("BASE_MAINNET_RPC"),
      ADMIN_WALLET_PRIVATE_KEY: !!Deno.env.get("ADMIN_WALLET_PRIVATE_KEY"),
      VRF_CONSUMER_ADDRESS: !!Deno.env.get("VRF_CONSUMER_ADDRESS"),
    };

    console.log('Environment check:', env);

    // Test basic blockchain connection
    console.log('🌐 Testing blockchain connection...');
    const RPC = Deno.env.get("BASE_MAINNET_RPC");
    
    if (!RPC) {
      return res(500, { ok: false, error: "BASE_MAINNET_RPC not found" });
    }

    const response = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_chainId',
        params: []
      })
    });

    const chainResult = await response.json();
    console.log('Chain ID result:', chainResult);

    if (chainResult.error) {
      return res(500, { ok: false, error: `RPC error: ${chainResult.error.message}` });
    }

    const chainId = parseInt(chainResult.result, 16);
    console.log('Chain ID:', chainId);

    if (chainId !== 8453) {
      return res(500, { ok: false, error: `Wrong chain. Expected 8453, got ${chainId}` });
    }

    console.log('✅ Basic test successful');

    return res(200, {
      ok: true,
      message: "Basic test successful",
      environment: env,
      chainId,
      chainName: chainId === 8453 ? "Base Mainnet" : "Unknown",
      timestamp: new Date().toISOString()
    });

  } catch (e) {
    console.log('💥 Error:', e.message);
    return res(500, { ok: false, error: (e as Error).message });
  }
});
