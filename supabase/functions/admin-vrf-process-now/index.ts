import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createPublicClient, createWalletClient, http } from "npm:viem@2";
import { privateKeyToAccount } from "npm:viem@2/accounts";
import { base } from "npm:viem@2/chains";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, cache-control, pragma, expires",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VRF_CONTRACT_DEFAULT = "0xc5Dfc3f6a227B30161f53F0BC167495158854854" as const;
const SELECTOR_CREATE = "0x9134b595";

function encodeCreateCompetition(name: string, totalTickets: number, numWinners: number): `0x${string}` {
  const nameBytes = new TextEncoder().encode(name);
  const nameHex = Array.from(nameBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const namePadding = (32 - (nameBytes.length % 32)) % 32;
  const paddedNameHex = nameHex + "0".repeat(namePadding * 2);
  const offset = "0000000000000000000000000000000000000000000000000000000000000060";
  const ticketsPadded = totalTickets.toString(16).padStart(64, "0");
  const winnersPadded = numWinners.toString(16).padStart(64, "0");
  const lengthPadded = nameBytes.length.toString(16).padStart(64, "0");
  return `${SELECTOR_CREATE}${offset}${ticketsPadded}${winnersPadded}${lengthPadded}${paddedNameHex}` as `0x${string}`;
}

type CompetitionRow = {
  id: string;
  title: string | null;
  status: string | null;
  end_date: string | null;
  total_tickets: number | null;
  is_instant_win: boolean | null;
  winner_address: string | null;
  uid: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const rpc = Deno.env.get("BASE_RPC");
    const adminPk = Deno.env.get("ADMIN_WALLET_PRIVATE_KEY");
    const vrfContract = (Deno.env.get("VRF_CONTRACT") || VRF_CONTRACT_DEFAULT) as `0x${string}`;

    if (!supabaseUrl || !serviceRole) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    if (!rpc) throw new Error("Missing BASE_RPC");
    if (!adminPk) throw new Error("Missing ADMIN_WALLET_PRIVATE_KEY");

    const supabase = createClient(supabaseUrl, serviceRole);
    const body = await req.json().catch(() => ({}));
    const competitionId: string | undefined = body?.competitionId;

    const account = privateKeyToAccount(adminPk as `0x${string}`);
    const pub = createPublicClient({ chain: base, transport: http(rpc) });
    const wallet = createWalletClient({ chain: base, transport: http(rpc), account });

    let comps: CompetitionRow[] = [];

    if (competitionId) {
      const { data, error } = await supabase
        .from("competitions")
        .select("id,title,status,end_date,total_tickets,is_instant_win,winner_address,uid")
        .eq("id", competitionId)
        .limit(1);
      if (error) throw error;
      comps = (data || []) as CompetitionRow[];
    } else {
      const { data: endedData, error: endedError } = await supabase
        .from("competitions")
        .select("id,title,status,end_date,total_tickets,is_instant_win,winner_address,uid")
        .is("winner_address", null)
        .not("end_date", "is", null)
        .lt("end_date", new Date().toISOString())
        .limit(20);
      if (endedError) throw endedError;

      const { data: soldOutData, error: soldOutError } = await supabase
        .from("competitions")
        .select("id,title,status,end_date,total_tickets,is_instant_win,winner_address,uid")
        .is("winner_address", null)
        .eq("status", "sold_out")
        .limit(20);
      if (soldOutError) throw soldOutError;

      const compMap = new Map();
      for (const c of [...(endedData || []), ...(soldOutData || [])]) {
        compMap.set(c.id, c);
      }
      comps = Array.from(compMap.values()).slice(0, 20) as CompetitionRow[];
    }

    if (!comps.length) {
      return new Response(
        JSON.stringify({ ok: true, processed: 0, message: "No competitions eligible right now." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results: any[] = [];

    for (const comp of comps) {
      try {
        if (comp.is_instant_win) {
          results.push({ id: comp.id, skipped: true, reason: "instant_win" });
          continue;
        }

        const competitionName = comp.id;
        if (comp.uid === competitionName) {
          results.push({ id: comp.id, skipped: true, reason: "already_registered", uid: comp.uid });
          continue;
        }

        const totalTickets = comp.total_tickets || 100;
        const numWinners = 1;
        const data = encodeCreateCompetition(competitionName, totalTickets, numWinners);

        const fee = await pub.estimateFeesPerGas();
        const nonce = await pub.getTransactionCount({ address: account.address });

        let gas = 300000n;
        try {
          gas = await pub.estimateGas({ account: account.address, to: vrfContract, data, value: 0n });
          gas = (gas * 130n) / 100n;
        } catch (_e) { /* use default */ }

        const txHash = await wallet.sendTransaction({
          to: vrfContract,
          data,
          value: 0n,
          gas,
          nonce,
          maxFeePerGas: fee.maxFeePerGas,
          maxPriorityFeePerGas: fee.maxPriorityFeePerGas,
        });

        const receipt = await pub.waitForTransactionReceipt({ hash: txHash });

        await supabase
          .from("competitions")
          .update({ uid: competitionName, tx_hash: txHash, status: "drawing" })
          .eq("id", comp.id);

        results.push({
          id: comp.id,
          competitionName,
          txHash,
          status: receipt.status,
          step: "vrf_triggered",
          message: "VRF request sent. Winners will be selected by Chainlink callback.",
        });
      } catch (compError) {
        results.push({ id: comp.id, error: String((compError as Error)?.message || compError) });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, processed: results.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String((e as Error)?.message || e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

