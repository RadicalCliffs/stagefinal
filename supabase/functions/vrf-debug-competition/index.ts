import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createPublicClient, http } from "npm:viem";
import { base } from "npm:viem/chains";
import { parseAbi } from "npm:viem";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function res(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

/**
 * vrf-debug-competition
 *
 * Debug endpoint to check VRF contract configuration and competition state.
 * This function uses the correct VRF contract address: 0x8ce54644e3313934D663c43Aea29641DFD8BcA1A
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (req.method !== "POST") return res(405, { ok: false, error: "POST only" });

  try {
    const { competitionId } = await req.json();
    if (!competitionId) return res(400, { ok: false, error: "competitionId required" });

    // Create viem client
    const client = createPublicClient({
      chain: base,
      transport: http(process.env.BASE_RPC || "https://base-rpc.publicnode.com"),
    });

    // Get VRF contract configuration
    const subscriptionId = await client.readContract({
      address: VRF_CONTRACT_ADDRESS,
      abi: VRF_ABI,
      functionName: "subscriptionId",
    });

    const keyHash = await client.readContract({
      address: VRF_CONTRACT_ADDRESS,
      abi: VRF_ABI,
      functionName: "keyHash",
    });

    const callbackGasLimit = await client.readContract({
      address: VRF_CONTRACT_ADDRESS,
      abi: VRF_ABI,
      functionName: "callbackGasLimit",
    });

    const requestConfirmations = await client.readContract({
      address: VRF_CONTRACT_ADDRESS,
      abi: VRF_ABI,
      functionName: "requestConfirmations",
    });

    const numWords = await client.readContract({
      address: VRF_CONTRACT_ADDRESS,
      abi: VRF_ABI,
      functionName: "numWords",
    });

    const lastRequestId = await client.readContract({
      address: VRF_CONTRACT_ADDRESS,
      abi: VRF_ABI,
      functionName: "lastRequestId",
    });

    const lastRandomWords = await client.readContract({
      address: VRF_CONTRACT_ADDRESS,
      abi: VRF_ABI,
      functionName: "lastRandomWords",
    });

    // Get competition state
    const competition = await client.readContract({
      address: VRF_CONTRACT_ADDRESS,
      abi: VRF_ABI,
      functionName: "getCompetition",
      args: [BigInt(competitionId)],
    });

    return res(200, {
      ok: true,
      contractAddress: VRF_CONTRACT_ADDRESS,
      chainId: 8453,
      network: "base",
      vrfConfig: {
        subscriptionId: subscriptionId.toString(),
        keyHash: keyHash.toString(),
        callbackGasLimit: callbackGasLimit.toString(),
        requestConfirmations: requestConfirmations.toString(),
        numWords: numWords.toString(),
        lastRequestId: lastRequestId.toString(),
        lastRandomWords: lastRandomWords.map(w => w.toString()),
      },
      competition: {
        competitionId: competitionId.toString(),
        totalTickets: competition.totalTickets.toString(),
        ticketsSold: competition.ticketsSold.toString(),
        pricePerTicketWei: competition.pricePerTicketWei.toString(),
        endTime: competition.endTime.toString(),
        active: competition.active,
        drawn: competition.drawn,
        numWinners: competition.numWinners,
        maxTicketsPerTx: competition.maxTicketsPerTx,
        totalCollectedWei: competition.totalCollectedWei.toString(),
      },
    });

  } catch (error) {
    console.error("VRF Debug Error:", error);
    return res(500, { ok: false, error: error.message });
  }
});