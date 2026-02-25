import { useState, useEffect } from "react";
import type { WinnerInfoField } from "../../models/models";
import WinnerHashCard from "./WinnerHashCard";
import VRFVerificationCard from "./VRFVerificationCard";
import { supabase } from "../../lib/supabase";

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
            "id, winner_address, outcomes_vrf_seed, tickets_sold, vrf_pregenerated_tx_hash",
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
              "id, winner_address, outcomes_vrf_seed, tickets_sold, vrf_pregenerated_tx_hash",
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
          txHash: compData?.vrf_pregenerated_tx_hash || null,
          vrfSeed: compData?.outcomes_vrf_seed || null,
          ticketsSold: compData?.tickets_sold || 0,
        };

        // Always fetch from competition_winners table for winner details
        const { data: winnerRow, error: winnerErr } = (await supabase
          .from("competition_winners")
          .select(
            "wallet_address, username, winner, ticket_number, winningticketnumber, tx_hash, txhash, vrf_tx_hash, rngtrxhash",
          )
          .eq("competition_id", resolvedCompId)
          .eq("is_winner", true)
          .maybeSingle()) as any;

        if (winnerErr) {
          console.error("Error fetching competition_winners:", winnerErr);
        }

        if (winnerRow) {
          resultData = {
            ...resultData,
            winnerAddress: resultData.winnerAddress || winnerRow.wallet_address,
            winnerUsername: winnerRow.username || winnerRow.winner || null,
            winningTicket:
              winnerRow.ticket_number || winnerRow.winningticketnumber || null,
            txHash:
              resultData.txHash ||
              winnerRow.tx_hash ||
              winnerRow.txhash ||
              winnerRow.vrf_tx_hash ||
              winnerRow.rngtrxhash ||
              null,
          };
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

  // If no winner data at all, show placeholder
  if (
    !winnerData ||
    (!winnerData.winnerAddress &&
      !winnerData.winnerUsername &&
      !winnerData.winningTicket &&
      !winnerData.txHash)
  ) {
    return (
      <div className="bg-[#191919] max-w-7xl mx-auto rounded-2xl lg:px-20 px-6 lg:py-14 py-8">
        <p className="sequel-45 text-white/60 text-center">
          Winner information not available yet.
        </p>
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
