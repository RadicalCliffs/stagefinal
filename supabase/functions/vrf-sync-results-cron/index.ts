import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createPublicClient, http, parseAbi } from "npm:viem@2";
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
  "function getWinners(uint256 competitionId) view returns (uint256[] winningNumbers, address[] winners)",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  // Allow both POST and GET for cron jobs

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const RPC = Deno.env.get("BASE_MAINNET_RPC")!;
    const CONSUMER = Deno.env.get("VRF_CONSUMER_ADDRESS")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const publicClient = createPublicClient({ chain: base, transport: http(RPC) });

    const chainId = await publicClient.getChainId();
    if (chainId !== 8453) return res(500, { ok: false, error: `RPC is not Base mainnet. chainId=${chainId}` });

    const { data: comps, error } = await supabase
      .from("competitions")
      .select("id, onchain_competition_id, status")
      .eq("status", "drawing")
      .limit(25);

    if (error) return res(500, { ok: false, error: error.message });
    if (!comps?.length) return res(200, { ok: true, message: "No drawing competitions to sync" });

    const results: any[] = [];

    for (const c of comps) {
      const compId = BigInt(c.onchain_competition_id ?? 0);
      if (!compId) {
        results.push({ id: c.id, ok: false, error: "Missing competitions.onchain_competition_id" });
        continue;
      }

      const [nums, winners] = await publicClient.readContract({
        address: CONSUMER as `0x${string}`,
        abi: ABI,
        functionName: "getWinners",
        args: [compId],
      });

      if (!winners?.length) {
        results.push({ id: c.id, ok: true, note: "No winners yet (VRF not fulfilled/finalized)" });
        continue;
      }

      // Insert winners idempotently
      for (let i = 0; i < winners.length; i++) {
        const ticketNum = Number(nums[i]);
        const wallet = winners[i];

        const { data: existing } = await supabase
          .from("winners")
          .select("id")
          .eq("competition_id", c.id)
          .eq("ticket_number", ticketNum)
          .maybeSingle();

        if (existing) continue;

        const { error: insertError } = await supabase.from("winners").insert({
          competition_id: c.id,
          ticket_number: ticketNum,
          wallet_address: wallet,
          prize_claimed: false,
          crdate: new Date().toISOString(),
        });
        if (insertError) {
          console.error(`[VRF Sync] Failed to insert winner for competition ${c.id}, ticket ${ticketNum}:`, insertError);
        }
      }

      await supabase
        .from("competitions")
        .update({ status: "completed", draw_date: new Date().toISOString() })
        .eq("id", c.id);

      results.push({ id: c.id, ok: true, winners: winners.length });
    }

    return res(200, { ok: true, results });
  } catch (e) {
    return res(500, { ok: false, error: (e as Error).message });
  }
});