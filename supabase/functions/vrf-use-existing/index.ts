import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createPublicClient, createWalletClient, http, parseAbi } from "npm:viem@2";
import { privateKeyToAccount } from "npm:viem/accounts";
import { base } from "npm:viem/chains";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const RPC = Deno.env.get("BASE_MAINNET_RPC")!;
    const PK = Deno.env.get("ADMIN_WALLET_PRIVATE_KEY")!;
    const CONSUMER = Deno.env.get("VRF_CONSUMER_ADDRESS")!;

    console.log('🔧 Using existing competition for VRF test...');
    
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
    console.log('Account address:', account.address);

    // Use competition ID 7 (which exists and is empty)
    const competitionId = BigInt(7);
    console.log('🎯 Using competition ID:', competitionId.toString());

    // Read the existing competition
    let state;
    try {
      state = await publicClient.readContract({
        address: CONSUMER as `0x${string}`,
        abi: ABI,
        functionName: "competitions",
        args: [competitionId],
      });
      console.log('✅ Competition state retrieved:', state);
    } catch (error) {
      console.log('❌ Failed to read competition:', error.message);
      return res(500, { ok: false, error: `Failed to read competition: ${error.message}` });
    }

    if (!state || !Array.isArray(state) || state.length < 11) {
      return res(500, { ok: false, error: "Invalid competition state" });
    }

    // Set the competition as active and ended for testing
    const now = Math.floor(Date.now() / 1000);
    const endTime = now - 60; // Ended 1 minute ago
    const totalTickets = BigInt(100);
    const pricePerTicket = BigInt(10000000000000000); // 0.01 ETH
    const numWinners = 1;
    const maxTicketsPerTx = 10;

    console.log('🚀 Updating competition to test state...');
    try {
      // For now, let's just create the database record since the on-chain state might be controlled by the contract
      // In a real scenario, we'd need to call a function to update the on-chain state
      
      // Create competition in database
      console.log('💾 Creating database record for existing competition...');
      const startDate = new Date((endTime - 300) * 1000); // Started 5 minutes ago
      const endDate = new Date(endTime * 1000); // Ended 1 minute ago
      
      const { data: dbCompetition, error: dbError } = await supabase
        .from("competitions")
        .insert({
          title: "VRF Test Competition (Existing On-Chain)",
          description: "Using existing on-chain competition ID 7 for VRF testing",
          competition_type: "lottery",
          status: "active",
          start_date: startDate.toISOString(),
          end_date: endDate.toISOString(),
          total_tickets: Number(totalTickets),
          ticket_price: 0.01,
          onchain_competition_id: Number(competitionId), // Use numeric ID as required by schema
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

      console.log('✅ Database record created for competition ID', competitionId.toString());
      console.log('🎉 Ready for VRF testing!');

      return res(200, {
        ok: true,
        message: "Existing competition prepared for VRF testing!",
        competitionId: competitionId.toString(),
        dbId: dbCompetition.id,
        onchainState: {
          compType: state[0],
          totalTickets: state[1].toString(),
          ticketsSold: state[2].toString(),
          pricePerTicket: state[3].toString(),
          endTime: state[4].toString(),
          active: state[5],
          drawn: state[6],
          numWinners: state[7],
          maxTicketsPerTx: state[8]
        },
        databaseRecord: {
          id: dbCompetition.id,
          title: dbCompetition.title,
          onchain_competition_id: dbCompetition.onchain_competition_id,
          status: dbCompetition.status
        }
      });

    } catch (e) {
      console.log('💥 Error:', e.message);
      return res(500, { ok: false, error: (e as Error).message });
    }

  } catch (e) {
    console.log('💥 Error:', e.message);
    console.log('💥 Stack:', e.stack);
    return res(500, { ok: false, error: (e as Error).message });
  }
});