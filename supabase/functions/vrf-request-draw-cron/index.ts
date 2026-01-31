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
  // Allow both POST and GET for cron jobs

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const RPC = Deno.env.get("BASE_MAINNET_RPC")!;
    const PK = Deno.env.get("ADMIN_WALLET_PRIVATE_KEY")!;
    const CONSUMER = Deno.env.get("VRF_CONSUMER_ADDRESS")!;
    const limit = Number(Deno.env.get("VRF_BATCH_LIMIT") || "10");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ✅ Base MAINNET only
    const publicClient = createPublicClient({ chain: base, transport: http(RPC) });
    const chainId = await publicClient.getChainId();
    if (chainId !== 8453) return res(500, { ok: false, error: `RPC is not Base mainnet. chainId=${chainId}` });

    // 🔧 Fix private key format - ensure it's hex and add 0x if missing
    let privateKey = PK.trim();
    if (!privateKey.startsWith('0x')) {
      privateKey = '0x' + privateKey;
    }
    
    // Validate private key length (should be 66 chars: 0x + 64 hex chars)
    if (privateKey.length !== 66) {
      return res(500, { ok: false, error: `Invalid private key length: ${privateKey.length}. Expected 66 chars (0x + 64 hex)` });
    }
    
    // Validate hex format
    if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
      return res(500, { ok: false, error: "Private key is not valid hex format" });
    }

    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const walletClient = createWalletClient({ chain: base, transport: http(RPC), account });

    // Pull comps that ended and haven't requested VRF draw
    // Adjust column names if yours differ; this matches typical patterns.
    const now = new Date().toISOString();

    const { data: comps, error } = await supabase
      .from("competitions")
      .select("id, onchain_competition_id, status, end_date, vrf_requested_at, vrf_draw_tx")
      .lt("end_date", now)
      .in("status", ["active", "ended", "drawing"])
      .is("vrf_requested_at", null)
      .limit(limit);

    if (error) return res(500, { ok: false, error: error.message });
    if (!comps?.length) return res(200, { ok: true, message: "No competitions needing VRF request" });

    const results: any[] = [];

    for (const c of comps) {
      const compId = BigInt(c.onchain_competition_id ?? 0);
      if (!compId) {
        results.push({ id: c.id, ok: false, error: "Missing competitions.onchain_competition_id" });
        continue;
      }

      // Safety check on-chain if already drawn
      const state = await publicClient.readContract({
        address: CONSUMER as `0x${string}`,
        abi: ABI,
        functionName: "competitions",
        args: [compId],
      });

      const drawn = state[6] as boolean;
      if (drawn) {
        await supabase.from("competitions").update({ status: "completed", vrf_requested_at: new Date().toISOString() }).eq("id", c.id);
        results.push({ id: c.id, ok: true, note: "Already drawn on-chain; marked completed" });
        continue;
      }

      // Simulate first: catch permission reverts without spending gas
      await publicClient.simulateContract({
        address: CONSUMER as `0x${string}`,
        abi: ABI,
        functionName: "drawWinners",
        args: [compId, true],
        account: account.address,
      });

      const hash = await walletClient.writeContract({
        address: CONSUMER as `0x${string}`,
        abi: ABI,
        functionName: "drawWinners",
        args: [compId, true],
      });

      await supabase
        .from("competitions")
        .update({ status: "drawing", vrf_requested_at: new Date().toISOString(), vrf_draw_tx: hash })
        .eq("id", c.id);

      results.push({ id: c.id, ok: true, onchainId: compId.toString(), txHash: hash });
    }

    return res(200, { ok: true, results });
  } catch (e) {
    return res(500, { ok: false, error: (e as Error).message });
  }
});