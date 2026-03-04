import { useState, useEffect } from "react";
import type { WinnerInfoField } from "../../models/models";
import WinnerHashCard from "./WinnerHashCard";
import VRFVerificationCard from "./VRFVerificationCard";
import { supabase } from "../../lib/supabase";
import { ShieldCheck } from "lucide-react";

interface WinnerDetailsProps {
  competitionId: string;
}

interface WinnerData {
  winnerAddress: string | null;
  winnerUsername: string | null;
  winningTicket: number | null;
  txHash: string | null;
  vrfSeed: string | null;
  ticketsSold: number;
}

const WinnerDetails = ({ competitionId }: WinnerDetailsProps) => {
  const [winnerData, setWinnerData] = useState<WinnerData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchWinnerData = async () => {
      if (!competitionId) {
        setLoading(false);
        return;
      }

      try {
        // Fetch competition data including VRF info
        const { data: compDataById, error: compError } = (await supabase
          .from("competitions")
          .select(
            "id, winner_address, outcomes_vrf_seed, tickets_sold, vrf_tx_hash",
          )
          .eq("id", competitionId)
          .maybeSingle()) as any;

        if (compError) {
          console.error("Error fetching competition winner data:", compError);
        }

        let compData = compDataById;
        let resolvedCompId = competitionId;

        // Fallback to uid if not found by id
        if (!compData) {
          const { data: byUid } = (await supabase
            .from("competitions")
            .select(
              "id, winner_address, outcomes_vrf_seed, tickets_sold, vrf_tx_hash",
            )
            .eq("uid", competitionId)
            .maybeSingle()) as any;
          compData = byUid || null;
          if (byUid?.id) {
            resolvedCompId = byUid.id;
          }
        }

        // Initialize with competition data
        let resultData: WinnerData = {
          winnerAddress: compData?.winner_address || null,
          winnerUsername: null,
          winningTicket: null,
          txHash: compData?.vrf_tx_hash || null,
          vrfSeed: compData?.outcomes_vrf_seed || null,
          ticketsSold: compData?.tickets_sold || 0,
        };

        // Fetch from winners table first (primary source)
        const { data: winnersData } = (await supabase
          .from("winners")
          .select("wallet_address, ticket_number, user_id, username")
          .eq("competition_id", resolvedCompId)
          .eq("prize_position", 1)
          .maybeSingle()) as any;

        if (winnersData) {
          resultData.winnerAddress =
            winnersData.wallet_address || resultData.winnerAddress;
          resultData.winningTicket = winnersData.ticket_number;
          resultData.winnerUsername = winnersData.username || null;
        }

        // Fallback: Fetch from competition_winners table
        if (!winnersData) {
          const { data: winnerRow, error: winnerErr } = (await supabase
            .from("competition_winners")
            .select(
              "winner, ticket_number, username, tx_hash, txhash, vrf_tx_hash, rngtrxhash",
            )
            .eq("competitionid", resolvedCompId)
            .maybeSingle()) as any;

          if (winnerErr) {
            console.error("Error fetching competition_winners:", winnerErr);
          }

          if (winnerRow) {
            resultData = {
              ...resultData,
              winnerAddress:
                resultData.winnerAddress || winnerRow.winner || null,
              winnerUsername: winnerRow.username || null,
              winningTicket: winnerRow.ticket_number || null,
              txHash:
                resultData.txHash ||
                winnerRow.tx_hash ||
                winnerRow.txhash ||
                winnerRow.vrf_tx_hash ||
                winnerRow.rngtrxhash ||
                null,
            };
          }
        }

        // Try to get username from profiles if not found
        if (!resultData.winnerUsername && resultData.winnerAddress) {
          const { data: profileData } = (await supabase
            .from("profiles")
            .select("username, display_name")
            .eq("wallet_address", resultData.winnerAddress)
            .maybeSingle()) as any;

          if (profileData) {
            resultData.winnerUsername =
              profileData.display_name || profileData.username || null;
          }
        }

        setWinnerData(resultData);
      } catch (err) {
        console.error("Error fetching winner data:", err);
      }
      setLoading(false);
    };

    fetchWinnerData();
  }, [competitionId]);

  if (loading) {
    return (
      <div className="bg-[#191919] max-w-7xl mx-auto rounded-2xl lg:px-20 px-6 lg:py-14 py-8">
        <div className="animate-pulse">
          <div className="h-6 bg-[#2A2A2A] rounded w-1/3 mb-4"></div>
          <div className="h-4 bg-[#2A2A2A] rounded w-2/3 mb-2"></div>
          <div className="h-4 bg-[#2A2A2A] rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  // If no winner data at all, show drawing state (not "not available")
  if (
    !winnerData ||
    (!winnerData.winnerAddress &&
      !winnerData.winnerUsername &&
      !winnerData.winningTicket &&
      !winnerData.txHash)
  ) {
    return (
      <div className="bg-[#191919] max-w-7xl mx-auto rounded-2xl lg:px-20 px-6 lg:py-14 py-8">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#DDE404]/10 mb-4">
            <div className="animate-spin">
              <ShieldCheck className="w-8 h-8 text-[#DDE404]" />
            </div>
          </div>
          <p className="sequel-75 text-white text-xl mb-2">Drawing Winner...</p>
          <p className="sequel-45 text-white/60 text-sm">
            VRF draw in progress. Results will appear once confirmed on the
            blockchain.
          </p>
        </div>
      </div>
    );
  }

  // Build fields array from available data
  const fields: WinnerInfoField[] = [];

  // Show username first if available, otherwise show wallet address
  if (winnerData.winnerUsername) {
    fields.push({
      label: "Winner",
      value: winnerData.winnerUsername,
      copyable: false,
    });
  }

  if (winnerData.winnerAddress) {
    fields.push({
      label: winnerData.winnerUsername ? "Wallet Address" : "Winner",
      value: winnerData.winnerAddress,
      copyable: true,
    });
  }

  if (winnerData.winningTicket !== null) {
    fields.push({
      label: "Winning Ticket",
      value: `#${winnerData.winningTicket}`,
      copyable: false,
    });
  }

  if (winnerData.txHash) {
    fields.push({
      label: "VRF Transaction Hash",
      value: winnerData.txHash,
      copyable: true,
      link: `https://basescan.org/tx/${winnerData.txHash}`,
    });
  }

  if (winnerData.vrfSeed) {
    fields.push({
      label: "Blockchain RNG Seed",
      value: winnerData.vrfSeed,
      copyable: true,
    });
  }

  return (
    <div className="space-y-6">
      {/* Winner Details Card */}
      {fields.length > 0 && <WinnerHashCard fields={fields} />}

      {/* VRF Verification Card - Only show if VRF seed is available */}
      {winnerData.vrfSeed && winnerData.ticketsSold > 0 && (
        <VRFVerificationCard
          vrfSeed={winnerData.vrfSeed}
          ticketsSold={winnerData.ticketsSold}
          winningTicketNumber={winnerData.winningTicket}
        />
      )}
    </div>
  );
};

export default WinnerDetails;
