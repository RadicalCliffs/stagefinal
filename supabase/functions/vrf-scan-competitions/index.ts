import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createPublicClient, http, parseAbi } from "npm:viem@2";
import { base } from "npm:viem/chains";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, cache-control, pragma, expires",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function res(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const ABI = parseAbi([
  "function competitions(uint256) view returns (uint8 compType,uint256 totalTickets,uint256 ticketsSold,uint256 pricePerTicket,uint256 endTime,bool active,bool drawn,uint8 numWinners,uint32 maxTicketsPerTx,uint256 instantWinSeed,uint256 drawSeed)",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (req.method !== "POST") return res(405, { ok: false, error: "POST only" });

  try {
    const RPC = Deno.env.get("BASE_MAINNET_RPC")!;
    const CONSUMER = Deno.env.get("VRF_CONSUMER_ADDRESS")!;

    console.log('🔍 Checking for existing competitions...');
    console.log('CONSUMER:', CONSUMER);

    const publicClient = createPublicClient({ chain: base, transport: http(RPC) });
    const chainId = await publicClient.getChainId();
    console.log('Chain ID:', chainId);

    const results: any[] = [];

    // Check competition IDs 1-10 to see if any exist
    for (let i = 1; i <= 10; i++) {
      try {
        console.log(`🔍 Checking competition ID ${i}...`);
        const state = await publicClient.readContract({
          address: CONSUMER as `0x${string}`,
          abi: ABI,
          functionName: "competitions",
          args: [BigInt(i)],
        });

        if (state && Array.isArray(state) && state.length >= 11) {
          const compType = state[0];
          const totalTickets = state[1];
          const ticketsSold = state[2];
          const pricePerTicket = state[3];
          const endTime = state[4];
          const active = state[5];
          const drawn = state[6];
          const numWinners = state[7];
          const maxTicketsPerTx = state[8];

          console.log(`✅ Competition ${i} found:`, {
            compType,
            totalTickets: totalTickets.toString(),
            ticketsSold: ticketsSold.toString(),
            pricePerTicket: pricePerTicket.toString(),
            endTime: endTime.toString(),
            active,
            drawn,
            numWinners,
            maxTicketsPerTx
          });

          results.push({
            id: i,
            exists: true,
            compType,
            totalTickets: totalTickets.toString(),
            ticketsSold: ticketsSold.toString(),
            pricePerTicket: pricePerTicket.toString(),
            endTime: endTime.toString(),
            active,
            drawn,
            numWinners,
            maxTicketsPerTx,
            isEnded: Number(endTime) < Math.floor(Date.now() / 1000)
          });
        }
      } catch (error) {
        console.log(`❌ Competition ${i} not found or error:`, error.message);
        results.push({ id: i, exists: false, error: error.message });
      }
    }

    return res(200, {
      ok: true,
      message: "Competition scan complete",
      results,
      summary: {
        totalChecked: 10,
        found: results.filter(r => r.exists).length,
        ended: results.filter(r => r.exists && r.isEnded).length,
        active: results.filter(r => r.exists && r.active).length,
        drawn: results.filter(r => r.exists && r.drawn).length
      }
    });

  } catch (e) {
    console.log('💥 Error:', e.message);
    console.log('💥 Stack:', e.stack);
    return res(500, { ok: false, error: (e as Error).message });
  }
});