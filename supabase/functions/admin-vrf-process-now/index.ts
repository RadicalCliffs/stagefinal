import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createPublicClient, createWalletClient, http } from "npm:viem";
import { privateKeyToAccount } from "npm:viem/accounts";
import { base } from "npm:viem/chains";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, cache-control, pragma, expires",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// VRFWinnerSelector contract on Base
const VRF_CONTRACT_DEFAULT =
  "0xc5Dfc3f6a227B30161f53F0BC167495158854854" as const;

// Function selectors (verified from successful on-chain transactions)
const SELECTOR_CREATE = "0x9134b595"; // createCompetition(bytes name,uint32 totalTickets,uint8 numWinners)
const SELECTOR_DRAWS = "0x0cc36c36"; // draws(uint256) - get competition by index

// Helper to encode createCompetition call manually
// This contract uses selector 0x9134b595 with params: (bytes name, uint32 totalTickets, uint8 numWinners)
// When called, it automatically triggers VRF request to select winners
function encodeCreateCompetition(
  name: string,
  totalTickets: number,
  numWinners: number,
): `0x${string}` {
  // Convert name to bytes
  const nameBytes = new TextEncoder().encode(name);
  const nameHex = Array.from(nameBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Calculate padding for name bytes (to 32-byte boundary)
  const namePadding = (32 - (nameBytes.length % 32)) % 32;
  const paddedNameHex = nameHex + "0".repeat(namePadding * 2);

  // ABI encoding for (bytes, uint32, uint8):
  // - offset to bytes data (0x60 = 96)
  // - uint32 totalTickets padded to 32 bytes
  // - uint8 numWinners padded to 32 bytes
  // - bytes length (32 bytes)
  // - bytes data (padded)
  const offset =
    "0000000000000000000000000000000000000000000000000000000000000060";
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
  ticket_price: number | null;
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
    const vrfContract = (Deno.env.get("VRF_CONTRACT") ||
      VRF_CONTRACT_DEFAULT) as `0x${string}`;

    console.log("ENV CHECK:", {
      hasUrl: !!supabaseUrl,
      hasService: !!serviceRole,
      hasRpc: !!rpc,
      hasPk: !!adminPk,
    });

    if (!supabaseUrl || !serviceRole)
      throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    if (!rpc) throw new Error("Missing BASE_RPC");
    if (!adminPk) throw new Error("Missing ADMIN_WALLET_PRIVATE_KEY");

    const supabase = createClient(supabaseUrl, serviceRole);
    console.log("Supabase client created:", !!supabase);

    const body = await req.json().catch(() => ({}));
    const competitionId: string | undefined = body?.competitionId;
    console.log("Body parsed, competitionId:", competitionId);

    const account = privateKeyToAccount(adminPk as `0x${string}`);
    const pub = createPublicClient({ chain: base, transport: http(rpc) });
    const wallet = createWalletClient({
      chain: base,
      transport: http(rpc),
      account,
    });

    // 1) Fetch competitions to process
    let comps: CompetitionRow[] = [];

    if (competitionId) {
      console.log("Querying single competition:", competitionId);
      const result = await supabase
        .from("competitions")
        .select(
          "id,title,status,end_date,total_tickets,ticket_price,is_instant_win,winner_address,uid",
        )
        .eq("id", competitionId)
        .limit(1);

      console.log("Single query result:", JSON.stringify(result));
      if (result?.error) throw result.error;
      comps = (result?.data || []) as CompetitionRow[];
    } else {
      // Selection: competitions that need VRF processing
      // 1. Ended-by-time AND not already with winner
      console.log("Querying ended competitions...");
      const endedResult = await supabase
        .from("competitions")
        .select(
          "id,title,status,end_date,total_tickets,ticket_price,is_instant_win,winner_address,uid",
        )
        .is("winner_address", null)
        .not("end_date", "is", null)
        .lt("end_date", new Date().toISOString())
        .limit(20);

      console.log("Ended result:", JSON.stringify(endedResult));
      if (endedResult?.error) throw endedResult.error;
      const endedComps = endedResult?.data || [];

      // 2. Sold out competitions (ready immediately, regardless of end_date)
      console.log("Querying sold_out competitions...");
      const soldOutResult = await supabase
        .from("competitions")
        .select(
          "id,title,status,end_date,total_tickets,ticket_price,is_instant_win,winner_address,uid",
        )
        .is("winner_address", null)
        .eq("status", "sold_out")
        .limit(20);

      console.log("SoldOut result:", JSON.stringify(soldOutResult));
      if (soldOutResult?.error) throw soldOutResult.error;
      const soldOutComps = soldOutResult?.data || [];

      // Combine, removing duplicates by id
      const compMap = new Map();
      for (const c of [...endedComps, ...soldOutComps]) {
        compMap.set(c.id, c);
      }
      comps = Array.from(compMap.values()).slice(0, 20) as CompetitionRow[];
    }

    if (!comps.length) {
      return new Response(
        JSON.stringify({
          ok: true,
          processed: 0,
          message: "No competitions eligible right now.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const results: any[] = [];

    for (const comp of comps) {
      try {
        // Skip instant win (handled by Prize_Instantprizes flows)
        if (comp.is_instant_win) {
          results.push({ id: comp.id, skipped: true, reason: "instant_win" });
          continue;
        }

        // Use the Supabase UUID as the on-chain competition name
        const competitionName = comp.id;

        // Check if already registered (uid stores the name when registered)
        if (comp.uid === competitionName) {
          results.push({
            id: comp.id,
            skipped: true,
            reason: "already_registered",
            uid: comp.uid,
          });
          continue;
        }

        // Register competition on VRFWinnerSelector contract
        // This automatically triggers VRF request for random winner selection
        const totalTickets = comp.total_tickets || 100;
        const numWinners = 1; // MVP: 1 main winner

        // Encode the createCompetition call
        const data = encodeCreateCompetition(
          competitionName,
          totalTickets,
          numWinners,
        );

        const fee = await pub.estimateFeesPerGas();
        const nonce = await pub.getTransactionCount({
          address: account.address,
        });

        // Estimate gas with buffer, fallback to 300k if estimation fails
        let gas = 300000n;
        try {
          gas = await pub.estimateGas({
            account: account.address,
            to: vrfContract,
            data,
            value: 0n,
          });
          gas = (gas * 130n) / 100n; // Add 30% buffer for VRF callback
        } catch (_e) {
          // Use default gas
        }

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

        // Store the competition name in uid to mark as registered
        // Also update status to "drawing" since VRF was triggered
        await supabase
          .from("competitions")
          .update({
            uid: competitionName,
            tx_hash: txHash,
            status: "drawing",
          })
          .eq("id", comp.id);

        results.push({
          id: comp.id,
          competitionName,
          txHash,
          status: receipt.status,
          step: "vrf_triggered",
          message:
            "VRF request sent. Winners will be selected by Chainlink callback.",
        });
      } catch (compError) {
        results.push({
          id: comp.id,
          error: String((compError as Error)?.message || compError),
        });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, processed: results.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String((e as Error)?.message || e) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
