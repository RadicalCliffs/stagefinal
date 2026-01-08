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

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function res(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

interface OnChainWinner {
  ticketNumber: number;
  walletAddress: string;
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

    // Create viem client
    const publicClient = createPublicClient({ chain: base, transport: http(RPC) });

    // Verify we're on the right chain
    const chainId = await publicClient.getChainId();
    if (chainId !== 8453) {
      return res(500, { ok: false, error: `Wrong chainId=${chainId} (expected 8453 Base Mainnet)` });
    }

    // If a specific competitionId is provided, process only that one
    // Otherwise, process all competitions in "drawing" status
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
      // Get all competitions that are in "drawing" status or have vrf_draw_requested_at but not completed
      const { data: comps, error } = await supabase
        .from("competitions")
        .select("*")
        .not("onchain_competition_id", "is", null)
        .or("status.eq.drawing,vrf_draw_requested_at.not.is.null")
        .is("vrf_draw_completed_at", null);

      if (error) {
        return res(500, { ok: false, error: `Failed to fetch competitions: ${error.message}` });
      }
      competitionsToProcess = comps || [];
    }

    if (competitionsToProcess.length === 0) {
      return res(200, { ok: true, message: "No competitions to sync", results: [] });
    }

    const results: any[] = [];

    for (const comp of competitionsToProcess) {
      const compResult: any = {
        competitionId: comp.id,
        title: comp.title,
      };

      try {
        const onchainId = comp.onchain_competition_id;

        if (!onchainId || onchainId <= 0) {
          compResult.status = "skipped";
          compResult.error = "NO_VALID_ONCHAIN_ID";
          compResult.message = "Competition does not have a valid onchain_competition_id";
          results.push(compResult);
          continue;
        }

        // Read on-chain state - VRF v2.5 uses getCompetition function
        const c = await publicClient.readContract({
          address: contractAddress,
          abi: READ_ABI,
          functionName: "getCompetition",
          args: [BigInt(onchainId)],
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

        const drawn = Boolean(c.drawn);

        compResult.onchainState = {
          active: Boolean(c.active),
          drawn,
          totalCollectedWei: c.totalCollectedWei.toString(),
        };

        if (!drawn) {
          compResult.status = "waiting";
          compResult.message = "Competition not yet drawn on-chain. VRF callback may be pending.";
          results.push(compResult);
          continue;
        }

        // Competition is drawn - get the winners
        const [winningNumbers, winners] = await publicClient.readContract({
          address: contractAddress,
          abi: READ_ABI,
          functionName: "getWinners",
          args: [BigInt(onchainId)],
        });

        const onChainWinners: OnChainWinner[] = [];
        for (let i = 0; i < winningNumbers.length; i++) {
          onChainWinners.push({
            ticketNumber: Number(winningNumbers[i]),
            walletAddress: winners[i].toLowerCase(),
          });
        }

        compResult.winners = onChainWinners;

        // Sync winners to database
        let winnersCreated = 0;
        let winnersSkipped = 0;

        for (const winner of onChainWinners) {
          // Check if winner already exists
          const { data: existingWinner } = await supabase
            .from("winners")
            .select("id")
            .eq("competition_id", comp.id)
            .eq("ticket_number", winner.ticketNumber)
            .maybeSingle();

          if (existingWinner) {
            winnersSkipped++;
            continue;
          }

          // Try to find the user by wallet address
          const { data: user } = await supabase
            .from("canonical_users")
            .select("id, username, country, wallet_address")
            .or(`wallet_address.ilike.${winner.walletAddress},base_wallet_address.ilike.${winner.walletAddress}`)
            .maybeSingle();

          // Create winner record
          const winnerData = {
            competition_id: comp.id,
            user_id: user?.id || null,
            ticket_number: winner.ticketNumber,
            prize_value: comp.prize_value || 0,
            prize_claimed: false,
            username: user?.username || "Unknown",
            country: user?.country || null,
            wallet_address: winner.walletAddress,
            crdate: new Date().toISOString(),
          };

          const { error: insertError } = await supabase
            .from("winners")
            .insert(winnerData);

          if (insertError) {
            console.error(`[vrf-sync-results] Failed to insert winner: ${insertError.message}`);
          } else {
            winnersCreated++;
          }
        }

        // Update competition status
        await supabase
          .from("competitions")
          .update({
            status: "completed",
            competitionended: 1,
            vrf_draw_completed_at: new Date().toISOString(),
            vrf_error: null,
            draw_date: new Date().toISOString(),
          })
          .eq("id", comp.id);

        compResult.status = "synced";
        compResult.winnersCreated = winnersCreated;
        compResult.winnersSkipped = winnersSkipped;
        compResult.message = `Successfully synced ${winnersCreated} winner(s) from on-chain`;

        results.push(compResult);

      } catch (error) {
        compResult.status = "error";
        compResult.error = "SYNC_FAILED";
        compResult.message = (error as Error).message;
        results.push(compResult);
      }
    }

    return res(200, {
      ok: true,
      processed: results.length,
      results,
    });

  } catch (error) {
    console.error("[vrf-sync-results] Fatal error:", error);
    return res(500, { ok: false, error: (error as Error).message });
  }
});
