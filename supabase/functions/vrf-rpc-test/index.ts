import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createPublicClient, http } from "npm:viem@2";
import { base } from "npm:viem/chains";

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
    const RPC = Deno.env.get("BASE_MAINNET_RPC");
    
    console.log('🔧 Testing RPC connection...');
    console.log('RPC:', RPC ? `Set: ${RPC.substring(0, 20)}...` : 'Missing');

    if (!RPC) {
      return res(500, { ok: false, error: "BASE_MAINNET_RPC not set" });
    }

    const publicClient = createPublicClient({ 
      chain: base, 
      transport: http(RPC) 
    });

    console.log('✅ Public client created');

    // Test basic connection
    const chainId = await publicClient.getChainId();
    console.log('✅ Chain ID retrieved:', chainId);

    // Test block number
    const blockNumber = await publicClient.getBlockNumber();
    console.log('✅ Block number retrieved:', blockNumber.toString());

    // Test gas price
    const gasPrice = await publicClient.getGasPrice();
    console.log('✅ Gas price retrieved:', gasPrice.toString());

    return res(200, {
      ok: true,
      message: "RPC connection test successful",
      chainId,
      blockNumber: blockNumber.toString(),
      gasPrice: gasPrice.toString(),
    });

  } catch (e) {
    console.log('💥 RPC Test Error:', e.message);
    console.log('💥 Stack:', e.stack);
    return res(500, { ok: false, error: `RPC Test Error: ${e.message}` });
  }
});