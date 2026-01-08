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

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const RPC = Deno.env.get("BASE_MAINNET_RPC")!;
    const PK = Deno.env.get("ADMIN_WALLET_PRIVATE_KEY")!;
    const CONSUMER = Deno.env.get("VRF_CONSUMER_ADDRESS")!;

    console.log('🔧 Environment Variables Check:');
    console.log('SUPABASE_URL:', SUPABASE_URL ? '✅ Set' : '❌ Missing');
    console.log('SUPABASE_SERVICE_ROLE_KEY:', SUPABASE_SERVICE_ROLE_KEY ? '✅ Set' : '❌ Missing');
    console.log('BASE_MAINNET_RPC:', RPC ? '✅ Set' : '❌ Missing');
    console.log('ADMIN_WALLET_PRIVATE_KEY:', PK ? '✅ Set' : '❌ Missing');
    console.log('VRF_CONSUMER_ADDRESS:', CONSUMER ? '✅ Set' : '❌ Missing');

    if (CONSUMER) {
      console.log('VRF_CONSUMER_ADDRESS value:', CONSUMER);
    }

    const requestData = await req.json();
    const { action } = requestData;

    switch (action) {
      case 'test_env':
        return res(200, {
          ok: true,
          message: "Environment check successful!",
          environment: {
            supabase_url: SUPABASE_URL ? '✅ Set' : '❌ Missing',
            service_role_key: SUPABASE_SERVICE_ROLE_KEY ? '✅ Set' : '❌ Missing',
            base_mainnet_rpc: RPC ? '✅ Set' : '❌ Missing',
            admin_wallet_private_key: PK ? '✅ Set' : '❌ Missing',
            vrf_consumer_address: CONSUMER ? '✅ Set' : '❌ Missing'
          },
          rpc_value: RPC || null,
          consumer_value: CONSUMER || null
        });

      case 'test_rpc':
        // Test RPC connection
        const { createPublicClient, http } = await import("npm:viem@2");
        const { base } = await import("npm:viem/chains");
        
        const publicClient = createPublicClient({ chain: base, transport: http(RPC) });
        const chainId = await publicClient.getChainId();
        const blockNumber = await publicClient.getBlockNumber();
        
        return res(200, {
          ok: true,
          message: "RPC test successful!",
          rpc_info: {
            chain_id: chainId,
            block_number: blockNumber.toString(),
            rpc_url: RPC
          }
        });

      default:
        return res(400, {
          ok: false,
          error: 'Invalid action. Use: test_env, test_rpc'
        });
    }

  } catch (e) {
    console.log('💥 Error:', e.message);
    console.log('💥 Stack:', e.stack);
    return res(500, { ok: false, error: (e as Error).message });
  }
});