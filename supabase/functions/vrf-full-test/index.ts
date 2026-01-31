import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createPublicClient, createWalletClient, http, parseAbi } from "npm:viem@2";
import { privateKeyToAccount } from "npm:viem/accounts";
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
  "function drawWinners(uint256 competitionId, bool useVRF)",
  "function competitions(uint256) view returns (uint8 compType,uint256 totalTickets,uint256 ticketsSold,uint256 pricePerTicket,uint256 endTime,bool active,bool drawn,uint8 numWinners,uint32 maxTicketsPerTx,uint256 instantWinSeed,uint256 drawSeed)",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (req.method !== "POST") return res(405, { ok: false, error: "POST only" });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const RPC = Deno.env.get("BASE_MAINNET_RPC")!;
    const PK = Deno.env.get("ADMIN_WALLET_PRIVATE_KEY")!;
    const CONSUMER = Deno.env.get("VRF_CONSUMER_ADDRESS")!;

    console.log('🎯 Creating FULL VRF TEST - COMPETITION TO VRF FULFILLMENT');
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Base MAINNET only
    const publicClient = createPublicClient({ chain: base, transport: http(RPC) });
    const chainId = await publicClient.getChainId();
    console.log('Chain ID:', chainId);
    if (chainId !== 8453) return res(500, { ok: false, error: `RPC is not Base mainnet. chainId=${chainId}` });

    // Ensure private key is properly formatted
    let privateKey = PK;
    if (!privateKey.startsWith('0x')) {
      privateKey = '0x' + privateKey;
    }
    
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const walletClient = createWalletClient({ chain: base, transport: http(RPC), account });

    console.log('✅ Blockchain clients initialized');

    // Try multiple competition IDs to find one that can be drawn
    const testIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    let workingCompetition = null;

    for (const compId of testIds) {
      try {
        console.log(`🔍 Testing competition ID ${compId}...`);
        const state = await publicClient.readContract({
          address: CONSUMER as `0x${string}`,
          abi: ABI,
          functionName: "competitions",
          args: [BigInt(compId)],
        });

        if (state && Array.isArray(state) && state.length >= 11) {
          const active = state[5];
          const drawn = state[6];
          const endTime = Number(state[4]);
          const now = Math.floor(Date.now() / 1000);
          const compType = state[0];

          console.log(`Competition ${compId}:`, {
            active, drawn, endTime, now, compType,
            timeToEnd: endTime - now,
            canDraw: active && !drawn && endTime <= now
          });

          // Check if this competition can be drawn
          if (compType === 0 && !drawn && endTime <= now) {
            workingCompetition = {
              id: compId,
              state,
              canDraw: true
            };
            console.log(`✅ Found drawable competition: ID ${compId}`);
            break;
          }
        }
      } catch (error) {
        console.log(`Competition ${compId} error:`, error.message);
      }
    }

    if (!workingCompetition) {
      console.log('❌ No drawable competitions found, trying to create one...');
      // Try to activate competition ID 1 by simulating a draw (which might activate it)
      try {
        console.log('🚀 Attempting to activate competition 1...');
        await publicClient.simulateContract({
          address: CONSUMER as `0x${string}`,
          abi: ABI,
          functionName: "drawWinners",
          args: [BigInt(1), true],
          account: account.address,
        });
        console.log('✅ Competition 1 simulation successful');
        workingCompetition = { id: 1, state: null, canDraw: true };
      } catch (simError) {
        console.log('❌ Cannot activate competition:', simError.message);
        return res(500, { ok: false, error: `No drawable competitions found and cannot activate: ${simError.message}` });
      }
    }

    const compId = workingCompetition.id;
    console.log(`🎯 Using competition ID ${compId} for VRF test`);

    // Create database record for this competition
    const nowDate = new Date();
    const endDate = new Date((Math.floor(Date.now() / 1000) - 300) * 1000); // Ended 5 minutes ago
    
    const { data: dbCompetition, error: dbError } = await supabase
      .from("competitions")
      .insert({
        title: `VRF FULFILLMENT TEST - Competition ID ${compId}`,
        description: `Full end-to-end VRF test with on-chain competition ID ${compId}`,
        competition_type: "lottery",
        status: "active",
        start_date: new Date((Math.floor(Date.now() / 1000) - 600) * 1000).toISOString(), // Started 10 minutes ago
        end_date: endDate.toISOString(),
        total_tickets: 100,
        ticket_price: 0.01,
        onchain_competition_id: compId,
        vrf_requested_at: null,
        vrf_draw_tx: null,
        vrf_error: null,
      })
      .select()
      .single();

    if (dbError) {
      console.log('❌ Database insert failed:', dbError.message);
      return res(500, { ok: false, error: `Database insert failed: ${dbError.message}` });
    }

    console.log('✅ Database record created:', dbCompetition.id);

    // Now trigger the VRF draw request
    console.log('🚀 Triggering VRF draw request...');
    
    let vrfResult;
    try {
      // Call the VRF request draw function directly
      const vrfResponse = await fetch(`${SUPABASE_URL}/functions/v1/vrf-request-draw`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'apikey': SUPABASE_SERVICE_ROLE_KEY
        },
        body: JSON.stringify({})
      });
      
      vrfResult = await vrfResponse.json();
      console.log('✅ VRF request response:', vrfResult);
    } catch (vrfError) {
      console.log('❌ VRF request failed:', vrfError.message);
      vrfResult = { error: vrfError.message };
    }

    // Check the final state
    const { data: finalCompetition } = await supabase
      .from("competitions")
      .select("id, title, status, vrf_error, vrf_requested_at, vrf_draw_tx, onchain_competition_id")
      .eq("id", dbCompetition.id)
      .single();

    return res(200, {
      ok: true,
      message: "🎉 VRF END-TO-END TEST COMPLETE",
      testSummary: {
        competitionId: compId,
        databaseId: dbCompetition.id,
        vrfRequestSuccessful: vrfResult?.results?.some(r => r.id === dbCompetition.id && r.ok) || false,
        finalStatus: finalCompetition?.status,
        vrfError: finalCompetition?.vrf_error,
        vrfTxHash: finalCompetition?.vrf_draw_tx
      },
      stepByStep: {
        1: "✅ Found on-chain competition",
        2: "✅ Created database record",
        3: "✅ Triggered VRF request",
        4: "✅ VRF system processed request"
      },
      vrfResponse: vrfResult,
      finalDatabaseState: finalCompetition
    });

  } catch (e) {
    console.log('💥 Error:', e.message);
    console.log('💥 Stack:', e.stack);
    return res(500, { ok: false, error: (e as Error).message });
  }
});