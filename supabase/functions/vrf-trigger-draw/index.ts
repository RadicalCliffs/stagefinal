import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createPublicClient, http } from "npm:viem";
import { base } from "npm:viem/chains";
import { parseAbi } from "npm:viem";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, cache-control, pragma, expires",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function res(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

/**
 * vrf-trigger-draw
 *
 * Simple one-time call endpoint for admin to trigger VRF draw on a specific on-chain competition.
 * Unlike vrf-request-draw which uses Supabase UUIDs, this takes the on-chain competition ID directly.
 *
 * Correct VRF Contract Address: 0x8ce54644e3313934D663c43Aea29641DFD8BcA1A (Base Mainnet)
 *
 * NOTE: The VRF v2.5 contract does not expose a drawWinners function to admin.
 * Winners are drawn automatically through the VRF callback when conditions are met.
 * This endpoint now serves to check competition state for VRF readiness.
 *
 * Request: { competitionId: number } - the ON-CHAIN competition ID
 * Response: { ok: true, competitionId: string, state: CompetitionState }
 */

// Correct VRF Contract Address
const VRF_CONTRACT_ADDRESS = "0x8ce54644e3313934D663c43Aea29641DFD8BcA1A" as const;

// VRF Contract ABI
const VRF_ABI = parseAbi([
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

interface CompetitionState {
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (req.method !== "POST") return res(405, { ok: false, error: "POST only" });

  try {
    const { competitionId } = await req.json();
    if (!competitionId) return res(400, { ok: false, error: "competitionId required (on-chain ID)" });

    // Create viem client
    const client = createPublicClient({
      chain: base,
      transport: http(process.env.BASE_RPC || "https://base-rpc.publicnode.com"),
    });

    // Get competition state from VRF contract
    const competition = await client.readContract({
      address: VRF_CONTRACT_ADDRESS,
      abi: VRF_ABI,
      functionName: "getCompetition",
      args: [BigInt(competitionId)],
    });

    const state: CompetitionState = {
      totalTickets: competition.totalTickets,
      ticketsSold: competition.ticketsSold,
      pricePerTicketWei: competition.pricePerTicketWei,
      endTime: competition.endTime,
      active: Boolean(competition.active),
      drawn: Boolean(competition.drawn),
      numWinners: Number(competition.numWinners),
      maxTicketsPerTx: Number(competition.maxTicketsPerTx),
      totalCollectedWei: competition.totalCollectedWei,
    };

    // Check if competition is ready for draw
    const currentTime = BigInt(Math.floor(Date.now() / 1000));
    const isPastEndTime = currentTime > competition.endTime;
    const isFullySold = competition.ticketsSold >= competition.totalTickets;
    const isNotDrawn = !competition.drawn;

    const readyForDraw = isPastEndTime && isFullySold && isNotDrawn;

    return res(200, {
      ok: true,
      competitionId: competitionId.toString(),
      contractAddress: VRF_CONTRACT_ADDRESS,
      chainId: 8453,
      state,
      drawReadiness: {
        readyForDraw,
        isPastEndTime,
        isFullySold,
        isNotDrawn,
        currentTime: currentTime.toString(),
        endTime: competition.endTime.toString(),
      },
      message: readyForDraw 
        ? "Competition is ready for VRF draw" 
        : "Competition is not yet ready for draw",
    });

  } catch (error) {
    console.error("VRF Trigger Draw Error:", error);
    return res(500, { ok: false, error: error.message });
  }
});