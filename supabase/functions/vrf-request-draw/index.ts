import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createPublicClient, http, parseAbi } from "npm:viem@2";
import { base } from "npm:viem/chains";

// Inlined VRF contract configuration (bundler doesn't support shared module imports)
const COMPETITION_VRF_ADDRESS = "0x8ce54644e3313934D663c43Aea29641DFD8BcA1A" as `0x${string}`;

const READ_ABI = parseAbi([
  "function subscriptionId() view returns (uint256)",
  "function keyHash() view returns (bytes32)",
  "function callbackGasLimit() view returns (uint32)",
  "function requestConfirmations() view returns (uint16)",
  "function numWords() view returns (uint32)",
  "function lastRequestId() view returns (uint256)",
  "function lastRandomWords() view returns (uint256[])",
  "function getCompetition(uint256 competitionId) view returns (tuple(uint256 totalTickets,uint256 ticketsSold,uint256 pricePerTicketWei,uint256 endTime,bool active,bool drawn,uint8 numWinners,uint32 maxTicketsPerTx,uint256 totalCollectedWei))",
  "function getWinners(uint256 competitionId) view returns (uint256[] winningNumbers, address[] winners)",
  "function getTicketAllocation(uint256 competitionId, address user) view returns (uint256)",
  "function getInstantWinNumbers(uint256 competitionId) view returns (uint256[] winningNumbers)",
]);

interface OnChainState {
  totalTickets: bigint;
  ticketsSold: bigint;
  pricePerTicketWei: bigint;
  endTime: bigint;
  active: boolean;
  drawn: boolean;
  numWinners: number;
  maxTicketsPerTx: number;
  totalCollectedWei: bigint;
}

function parseCompetitionState(c: {
  totalTickets: bigint;
  ticketsSold: bigint;
  pricePerTicketWei: bigint;
  endTime: bigint;
  active: boolean;
  drawn: boolean;
  numWinners: number;
  maxTicketsPerTx: number;
  totalCollectedWei: bigint;
}): OnChainState {
  return {
    totalTickets: c.totalTickets,
    ticketsSold: c.ticketsSold,
    pricePerTicketWei: c.pricePerTicketWei,
    endTime: c.endTime,
    active: Boolean(c.active),
    drawn: Boolean(c.drawn),
    numWinners: Number(c.numWinners),
    maxTicketsPerTx: Number(c.maxTicketsPerTx),
    totalCollectedWei: c.totalCollectedWei,
  };
}

/**
 * vrf-request-draw - VRF v2.5 Competition Status Check
 *
 * NOTE: The VRF v2.5 contract (0x8ce54644e3313934D663c43Aea29641DFD8BcA1A) does not expose
 * a drawWinners function for external calling. The draw is handled automatically by the
 * VRF system. This endpoint now serves as a status check for competition draw readiness.
 *
 * For actual VRF draw triggers, the contract's internal mechanisms handle this.
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, cache-control, pragma, expires",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function res(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

async function getOnChainState(
  publicClient: ReturnType<typeof createPublicClient>,
  contractAddress: `0x${string}`,
  onchainCompetitionId: number
): Promise<OnChainState> {
  const c = await publicClient.readContract({
    address: contractAddress,
    abi: READ_ABI,
    functionName: "getCompetition",
    args: [BigInt(onchainCompetitionId)],
  }) as {
    totalTickets: bigint;
    ticketsSold: bigint;
    pricePerTicketWei: bigint;
    endTime: bigint;
    active: boolean;
    drawn: boolean;
    numWinners: number;
    maxTicketsPerTx: number;
    totalCollectedWei: bigint;
  };

  return parseCompetitionState(c);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (req.method !== "POST") return res(405, { ok: false, error: "POST only" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const RPC = Deno.env.get("BASE_MAINNET_RPC");

  // Use centralized contract address from vrf-contract.ts
  const contractAddress = COMPETITION_VRF_ADDRESS;

  if (!RPC) {
    return res(500, { ok: false, error: "Missing VRF configuration (BASE_MAINNET_RPC)" });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const { competitionId } = body;

    // Create viem clients
    const publicClient = createPublicClient({ chain: base, transport: http(RPC) });

    // Verify we're on the right chain
    const chainId = await publicClient.getChainId();
    if (chainId !== 8453) {
      return res(500, { ok: false, error: `Wrong chainId=${chainId} (expected 8453 Base Mainnet)` });
    }

    // If a specific competitionId is provided, process only that one
    // Otherwise, process all eligible competitions
    let competitionsToProcess: any[] = [];

    if (competitionId) {
      const { data: comp, error } = await supabase
        .from("competitions")
        .select("*")
        .eq("id", competitionId)
        .maybeSingle();

      if (error || !comp) {
        return res(404, { ok: false, error: "Competition not found" });
      }
      competitionsToProcess = [comp];
    } else {
      // Get all competitions that are ended but not yet drawn
      const { data: comps, error } = await supabase
        .from("competitions")
        .select("*")
        .not("end_date", "is", null)
        .lt("end_date", new Date().toISOString())
        .in("status", ["active", "drawing"])
        .is("vrf_draw_completed_at", null);

      if (error) {
        return res(500, { ok: false, error: `Failed to fetch competitions: ${error.message}` });
      }
      competitionsToProcess = comps || [];
    }

    if (competitionsToProcess.length === 0) {
      return res(200, { ok: true, message: "No eligible competitions to process", results: [] });
    }

    const results: any[] = [];

    for (const comp of competitionsToProcess) {
      const compResult: any = {
        competitionId: comp.id,
        title: comp.title,
      };

      try {
        // ====== HARD GUARD 1: Check onchain_competition_id exists and is valid ======
        const onchainId = comp.onchain_competition_id;

        if (onchainId === null || onchainId === undefined) {
          compResult.status = "skipped";
          compResult.error = "NO_ONCHAIN_ID";
          compResult.message = "Competition does not have an onchain_competition_id. Create it on-chain first.";

          await supabase
            .from("competitions")
            .update({ vrf_error: "NO_ONCHAIN_ID: Competition not created on-chain" })
            .eq("id", comp.id);

          results.push(compResult);
          continue;
        }

        if (typeof onchainId !== "number" || onchainId <= 0 || !Number.isInteger(onchainId)) {
          compResult.status = "skipped";
          compResult.error = "INVALID_ONCHAIN_ID";
          compResult.message = `Invalid onchain_competition_id: ${onchainId}. Must be a positive integer.`;

          await supabase
            .from("competitions")
            .update({ vrf_error: `INVALID_ONCHAIN_ID: ${onchainId}` })
            .eq("id", comp.id);

          results.push(compResult);
          continue;
        }

        // ====== HARD GUARD 2: Read on-chain state and validate ======
        let onChainState: OnChainState;
        try {
          onChainState = await getOnChainState(publicClient, contractAddress, onchainId);
        } catch (readError) {
          compResult.status = "skipped";
          compResult.error = "CHAIN_READ_FAILED";
          compResult.message = `Failed to read on-chain state: ${(readError as Error).message}`;

          await supabase
            .from("competitions")
            .update({ vrf_error: `CHAIN_READ_FAILED: ${(readError as Error).message}` })
            .eq("id", comp.id);

          results.push(compResult);
          continue;
        }

        compResult.onchainState = {
          active: onChainState.active,
          drawn: onChainState.drawn,
          endTime: onChainState.endTime.toString(),
          ticketsSold: onChainState.ticketsSold.toString(),
          numWinners: onChainState.numWinners,
        };

        // ====== HARD GUARD 3: Check if competition is active on-chain ======
        if (!onChainState.active) {
          compResult.status = "skipped";
          compResult.error = "NOT_ACTIVE_ONCHAIN";
          compResult.message = "Competition is not active on-chain";

          await supabase
            .from("competitions")
            .update({ vrf_error: "NOT_ACTIVE_ONCHAIN" })
            .eq("id", comp.id);

          results.push(compResult);
          continue;
        }

        // ====== HARD GUARD 4: Check if already drawn on-chain ======
        if (onChainState.drawn) {
          compResult.status = "completed";
          compResult.error = null;
          compResult.message = "Competition already drawn on-chain";

          // Clear any error and mark as completed
          await supabase
            .from("competitions")
            .update({
              vrf_error: null,
              vrf_draw_completed_at: new Date().toISOString(),
              status: "completed",
              competitionended: 1
            })
            .eq("id", comp.id);

          results.push(compResult);
          continue;
        }

        // ====== HARD GUARD 5: Check if end time has passed ======
        const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
        if (onChainState.endTime > nowSeconds) {
          compResult.status = "skipped";
          compResult.error = "NOT_ENDED_YET";
          compResult.message = `Competition end time (${onChainState.endTime}) has not passed yet (current: ${nowSeconds})`;

          // Don't mark as error since this is expected - competition just hasn't ended
          results.push(compResult);
          continue;
        }

        // ====== HARD GUARD 6: Check if there are tickets sold ======
        if (onChainState.ticketsSold === BigInt(0)) {
          compResult.status = "skipped";
          compResult.error = "NO_TICKETS_SOLD";
          compResult.message = "No tickets sold for this competition";

          await supabase
            .from("competitions")
            .update({ vrf_error: "NO_TICKETS_SOLD" })
            .eq("id", comp.id);

          results.push(compResult);
          continue;
        }

        // ====== VRF v2.5 Note ======
        // The new VRF v2.5 contract does not expose a drawWinners function for external calling.
        // The draw is handled automatically by the VRF system when conditions are met.
        // This endpoint now serves as a status check to monitor competitions ready for draw.

        console.log(`[vrf-request-draw] Competition ${comp.id} (onchain: ${onchainId}) is ready for VRF draw`);

        // Mark as ready for draw (the VRF system will handle the actual draw)
        await supabase
          .from("competitions")
          .update({
            status: "drawing",
            vrf_draw_requested_at: new Date().toISOString(),
            vrf_error: null
          })
          .eq("id", comp.id);

        compResult.status = "ready_for_draw";
        compResult.message = "Competition is ready for VRF draw. The VRF system will handle the draw automatically.";
        compResult.onchainState = {
          ...compResult.onchainState,
          totalCollectedWei: onChainState.totalCollectedWei.toString(),
        };

        results.push(compResult);

      } catch (error) {
        compResult.status = "error";
        compResult.error = "UNEXPECTED_ERROR";
        compResult.message = (error as Error).message;

        await supabase
          .from("competitions")
          .update({ vrf_error: `UNEXPECTED: ${(error as Error).message}` })
          .eq("id", comp.id);

        results.push(compResult);
      }
    }

    return res(200, {
      ok: true,
      processed: results.length,
      results
    });

  } catch (error) {
    console.error("[vrf-request-draw] Fatal error:", error);
    return res(500, { ok: false, error: (error as Error).message });
  }
});
