import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  decodeFunctionResult,
} from "npm:viem";
import { privateKeyToAccount } from "npm:viem/accounts";
import { base } from "npm:viem/chains";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, cache-control, pragma, expires",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VRF_CONTRACT_DEFAULT =
  "0xc5Dfc3f6a227B30161f53F0BC167495158854854" as const;

// Minimal ABI fragments we need
const ABI = [
  {
    type: "function",
    name: "createCompetition",
    stateMutability: "nonpayable",
    inputs: [
      { name: "totalTickets", type: "uint256" },
      { name: "pricePerTicketWei", type: "uint256" },
      { name: "endTime", type: "uint256" },
      { name: "numWinners", type: "uint8" },
      { name: "maxTicketsPerTx", type: "uint32" },
    ],
    outputs: [{ name: "competitionId", type: "uint256" }],
  },
  {
    type: "function",
    name: "nextCompetitionId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "drawWinners",
    stateMutability: "nonpayable",
    inputs: [
      { name: "competitionId", type: "uint256" },
      { name: "useVRF", type: "bool" },
    ],
    outputs: [{ name: "requestId", type: "uint256" }],
  },
  {
    type: "function",
    name: "getWinners",
    stateMutability: "view",
    inputs: [{ name: "competitionId", type: "uint256" }],
    outputs: [
      { name: "winningNumbers", type: "uint256[]" },
      { name: "winners", type: "address[]" },
    ],
  },
] as const;

type CompetitionRow = {
  id: string;
  title: string | null;
  status: string | null;
  end_date: string | null;
  total_tickets: number | null;
  ticket_price: number | null;
  is_instant_win: boolean | null;
  winner_address: string | null;
  uid: string | null; // we will store onchain_competition_id here for MVP
};

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

// MVP: use a fixed on-chain ticket price (0.001 ETH) because your DB ticket_price is not guaranteed to be ETH
const DEFAULT_PRICE_WEI = 1000000000000000n; // 0.001 ETH

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

    if (!supabaseUrl || !serviceRole)
      throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    if (!rpc) throw new Error("Missing BASE_RPC");
    if (!adminPk) throw new Error("Missing ADMIN_WALLET_PRIVATE_KEY");

    const supabase = createClient(supabaseUrl, serviceRole);

    const body = await req.json().catch(() => ({}));
    const competitionId: string | undefined = body?.competitionId;

    const account = privateKeyToAccount(adminPk as `0x${string}`);
    const pub = createPublicClient({ chain: base, transport: http(rpc) });
    const wallet = createWalletClient({
      chain: base,
      transport: http(rpc),
      account,
    });

    // 1) Fetch comps to process
    let comps: CompetitionRow[] = [];

    if (competitionId) {
      const { data, error } = await supabase
        .from("competitions")
        .select(
          "id,title,status,end_date,total_tickets,ticket_price,is_instant_win,winner_address,uid",
        )
        .eq("id", competitionId)
        .limit(1);

      if (error) throw error;
      comps = (data || []) as CompetitionRow[];
    } else {
      // Selection: competitions that need VRF processing
      // 1. Ended-by-time AND not already with winner
      const { data: endedComps, error: endedError } = await supabase
        .from("competitions")
        .select(
          "id,title,status,end_date,total_tickets,ticket_price,is_instant_win,winner_address,uid",
        )
        .is("winner_address", null)
        .not("end_date", "is", null)
        .lt("end_date", new Date().toISOString())
        .limit(20);

      if (endedError) throw endedError;

      // 2. Sold out competitions (ready immediately, regardless of end_date)
      const { data: soldOutComps, error: soldOutError } = await supabase
        .from("competitions")
        .select(
          "id,title,status,end_date,total_tickets,ticket_price,is_instant_win,winner_address,uid",
        )
        .is("winner_address", null)
        .eq("status", "sold_out")
        .limit(20);

      if (soldOutError) throw soldOutError;

      // Combine, removing duplicates by id
      const compMap = new Map();
      for (const c of [...(endedComps || []), ...(soldOutComps || [])]) {
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
      // Skip instant win (MVP: those are handled by Prize_Instantprizes flows)
      if (comp.is_instant_win) {
        results.push({ id: comp.id, skipped: true, reason: "instant_win" });
        continue;
      }

      // 2) Ensure onchain ID exists (store in uid)
      // Check if uid is a valid numeric string (not a UUID)
      let onchainId: string | null = null;
      if (comp.uid && /^\d+$/.test(comp.uid)) {
        onchainId = comp.uid;
      }

      if (!onchainId) {
        // For on-chain creation, always use a future endTime (contract rejects past times)
        // The actual competition end logic is handled in the DB, this is just for VRF
        const endTime = nowUnix() + 3600; // 1 hour from now

        const totalTickets = BigInt(comp.total_tickets || 100);
        const pricePerTicketWei = DEFAULT_PRICE_WEI;
        const numWinners = 1; // MVP: 1 main winner
        const maxTicketsPerTx = 10;

        const data = encodeFunctionData({
          abi: ABI,
          functionName: "createCompetition",
          args: [
            totalTickets,
            pricePerTicketWei,
            BigInt(endTime),
            numWinners,
            maxTicketsPerTx,
          ],
        });

        const fee = await pub.estimateFeesPerGas();
        const nonce = await pub.getTransactionCount({
          address: account.address,
        });
        const gas = await pub.estimateGas({
          account: account.address,
          to: vrfContract,
          data,
          value: 0n,
        });

        const txHash = await wallet.sendTransaction({
          to: vrfContract,
          data,
          value: 0n,
          gas,
          nonce,
          maxFeePerGas: fee.maxFeePerGas,
          maxPriorityFeePerGas: fee.maxPriorityFeePerGas,
        });

        await pub.waitForTransactionReceipt({ hash: txHash });

        const nextId = await pub.readContract({
          address: vrfContract,
          abi: ABI,
          functionName: "nextCompetitionId",
        });
        onchainId = (BigInt(nextId) - 1n).toString();

        // Store onchain link into DB
        await supabase
          .from("competitions")
          .update({
            uid: onchainId,
          })
          .eq("id", comp.id);

        results.push({
          id: comp.id,
          step: "created_onchain",
          onchainId,
          txHash,
        });
      }

      // 3) Request VRF draw
      const drawData = encodeFunctionData({
        abi: ABI,
        functionName: "drawWinners",
        args: [BigInt(onchainId), true],
      });

      const fee2 = await pub.estimateFeesPerGas();
      const nonce2 = await pub.getTransactionCount({
        address: account.address,
      });
      const gas2 = await pub.estimateGas({
        account: account.address,
        to: vrfContract,
        data: drawData,
        value: 0n,
      });

      const drawTx = await wallet.sendTransaction({
        to: vrfContract,
        data: drawData,
        value: 0n,
        gas: gas2,
        nonce: nonce2,
        maxFeePerGas: fee2.maxFeePerGas,
        maxPriorityFeePerGas: fee2.maxPriorityFeePerGas,
      });

      const receipt = await pub.waitForTransactionReceipt({ hash: drawTx });

      // Try to extract requestId by simulating decode from call output is not available post-tx,
      // so MVP: store tx hash and let sync read winners. (You already have tx hash fields.)
      await supabase
        .from("competitions")
        .update({
          tx_hash: drawTx,
          status: "drawing",
        })
        .eq("id", comp.id);

      // 4) Try immediate sync
      let ready = false;
      let winners: string[] = [];
      let winningNumbers: string[] = [];

      try {
        const res = await pub.readContract({
          address: vrfContract,
          abi: ABI,
          functionName: "getWinners",
          args: [BigInt(onchainId)],
        });

        const nums = (res[0] || []).map((n: bigint) => n.toString());
        const addrs = (res[1] || []) as string[];

        if (addrs.length > 0) {
          ready = true;
          winners = addrs;
          winningNumbers = nums;

          await supabase
            .from("competitions")
            .update({
              winner_address: addrs[0],
              status: "completed",
              drawn_at: new Date().toISOString(),
            })
            .eq("id", comp.id);
        }
      } catch (_e) {
        // Not fulfilled yet or "Not drawn" revert, treat as pending
      }

      results.push({
        id: comp.id,
        onchainId,
        drawTx,
        drawMined: receipt.status,
        ready,
        winners,
        winningNumbers,
      });
    }

    return new Response(
      JSON.stringify({ ok: true, processed: results.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String(e?.message || e) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
