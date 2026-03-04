import { useState, useEffect } from "react";
import { monkeyNft, individualLogoToken } from "../../assets/images";
import Countdown from "../Countdown";
import type { CompetitionWrapper } from "../../models/models";
import { supabase } from "../../lib/supabase";
import {
  ExternalLink,
  Trophy,
  Ticket,
  ShieldCheck,
  Copy,
  CopyCheck,
} from "lucide-react";

interface WinnerData {
  winnerAddress: string | null;
  winnerUsername: string | null;
  winningTicket: number | null;
  vrfTxHash: string | null;
  vrfSeed: string | null;
  ticketsSold: number;
}

const FinishedCompetitionHeroSection = ({
  competition,
}: CompetitionWrapper) => {
  const { description, title, created_at, image_url, end_date, draw_date, id } =
    competition;
  const [winnerData, setWinnerData] = useState<WinnerData | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Fetch winner and VRF data
  useEffect(() => {
    const fetchWinnerData = async () => {
      if (!id) return;

      try {
        // Fetch from competitions table first
        const { data: compData } = (await supabase
          .from("competitions")
          .select(
            "winner_address, outcomes_vrf_seed, tickets_sold, vrf_tx_hash, status, vrf_draw_completed_at",
          )
          .eq("id", id)
          .maybeSingle()) as any;

        let result: WinnerData = {
          winnerAddress: compData?.winner_address || null,
          winnerUsername: null,
          winningTicket: null,
          vrfTxHash: compData?.vrf_tx_hash || null,
          vrfSeed: compData?.outcomes_vrf_seed || null,
          ticketsSold: compData?.tickets_sold || 0,
        };

        // Fetch from winners table (primary source for winner data)
        const { data: winnersData } = (await supabase
          .from("winners")
          .select("wallet_address, ticket_number, user_id, username")
          .eq("competition_id", id)
          .eq("prize_position", 1)
          .maybeSingle()) as any;

        if (winnersData) {
          result.winnerAddress =
            winnersData.wallet_address || result.winnerAddress;
          result.winningTicket = winnersData.ticket_number;
          result.winnerUsername = winnersData.username || null;
        }

        // Fallback: Fetch from competition_winners for additional details
        if (!winnersData) {
          const { data: winnerRow } = (await supabase
            .from("competition_winners")
            .select(
              "winner, ticket_number, user_id, username, tx_hash, txhash, vrf_tx_hash, rngtrxhash",
            )
            .eq("competitionid", id)
            .maybeSingle()) as any;

          if (winnerRow) {
            result.winnerAddress =
              result.winnerAddress || winnerRow.winner || null;
            result.winnerUsername = winnerRow.username || null;
            result.winningTicket = winnerRow.ticket_number || null;
            result.vrfTxHash =
              result.vrfTxHash ||
              winnerRow.tx_hash ||
              winnerRow.txhash ||
              winnerRow.vrf_tx_hash ||
              winnerRow.rngtrxhash ||
              null;
          }
        }

        // Extract username from user_id if it's a prize:pid format
        if (!result.winnerUsername && result.winnerAddress) {
          // Check if the winner has a profile (case-insensitive search)
          const { data: profileData } = (await supabase
            .from("profiles")
            .select("username, display_name")
            .ilike("wallet_address", result.winnerAddress)
            .maybeSingle()) as any;

          if (profileData) {
            result.winnerUsername =
              profileData.display_name || profileData.username || null;
          }
        }

        setWinnerData(result);
      } catch (err) {
        console.error("Error fetching winner data:", err);
      }
    };

    fetchWinnerData();
  }, [id]);

  const handleCopy = async (value: string, field: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const truncateHash = (hash: string) => {
    if (hash.length <= 20) return hash;
    return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
  };

  const formatWalletAddress = (address: string) => {
    if (!address || !address.startsWith("0x")) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  return (
    <div className="max-w-7xl mx-auto bg-[#1D1D1D] rounded-2xl px-3 py-4">
      <div className="flex xl:flex-row flex-col lg:gap-8 gap-4 relative overflow-hidden">
        <div className="bg-[#111111] rounded-2xl w-full relative">
          {/* Mobile countdown - on top of image */}
          <div className="xl:hidden absolute top-4 left-0 right-0">
            <div className="flex flex-col items-center justify-center">
              <Countdown
                endDate={end_date || draw_date || created_at}
                isEnded={true}
              />
            </div>
          </div>
          <img
            src={image_url || monkeyNft}
            alt={`${title} - Competition image`}
            className="xl:w-auto w-full"
          />
          {/* Desktop countdown - below image */}
          <div className="xl:flex hidden flex-col items-center justify-center mt-5 xl:pb-0 pb-8">
            <p className="sequel-95 uppercase text-white mb-4 sm:text-3xl text-2xl">
              Finish Date
            </p>
            <Countdown
              endDate={end_date || draw_date || created_at}
              isEnded={true}
            />
          </div>
        </div>
        <img
          src={individualLogoToken}
          alt="Prize token logo"
          className="absolute md:block hidden w-96 xl:-right-5 xl:-top-8 bottom-0 right-0"
        />

        <div className="w-full lg:mt-5">
          <h1 className="sequel-95 lg:text-4xl sm:text-3xl text-2xl sm:text-left text-center text-white">
            {title}
          </h1>
          <p className="text-white sequel-45 text-sm sm:mt-4 mt-3 leading-loose sm:text-left text-center">
            {description || "Competition has ended."}
          </p>

          {/* Winner & VRF Info Card - Integrated in Hero */}
          <div className="bg-[#141414] rounded-xl p-4 mt-4 relative">
            {/* Determine if we should show winner info or drawing state */}
            {winnerData?.winnerAddress || winnerData?.winningTicket ? (
              <>
                {/* Winner Announced Section */}
                <div className="flex items-center gap-2 mb-4">
                  <Trophy className="w-6 h-6 text-[#DDE404]" />
                  <p className="sequel-75 uppercase text-[#DDE404] md:text-xl text-lg">
                    🎉 Winner Announced
                  </p>
                </div>

                {/* Winner Details Grid */}
                <div className="space-y-3 mb-4">
                  {/* Username if available */}
                  {winnerData.winnerUsername && (
                    <div className="flex items-center justify-between bg-[#1A1A1A] rounded-lg p-3 hover:bg-[#222222] transition-colors">
                      <span className="sequel-45 text-white/60 text-sm flex items-center gap-2">
                        <Trophy size={14} className="text-[#DDE404]" />
                        Winner
                      </span>
                      <span className="sequel-75 text-white text-sm">
                        {winnerData.winnerUsername}
                      </span>
                    </div>
                  )}

                  {/* Wallet Address - Always show if we have it */}
                  {winnerData.winnerAddress && (
                    <div className="flex items-center justify-between bg-[#1A1A1A] rounded-lg p-3 hover:bg-[#222222] transition-colors">
                      <span className="sequel-45 text-white/60 text-sm">
                        {winnerData.winnerUsername
                          ? "Wallet Address"
                          : "Winner Address"}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="sequel-75 text-white text-sm font-mono">
                          {formatWalletAddress(winnerData.winnerAddress)}
                        </span>
                        <button
                          onClick={() =>
                            handleCopy(winnerData.winnerAddress!, "wallet")
                          }
                          className="text-white/40 hover:text-[#DDE404] transition-colors"
                          title="Copy wallet address"
                        >
                          {copiedField === "wallet" ? (
                            <CopyCheck size={14} className="text-[#DDE404]" />
                          ) : (
                            <Copy size={14} />
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Winning Ticket Number */}
                  {winnerData.winningTicket !== null && (
                    <div className="flex items-center justify-between bg-[#1A1A1A] rounded-lg p-3 hover:bg-[#222222] transition-colors">
                      <span className="sequel-45 text-white/60 text-sm flex items-center gap-2">
                        <Ticket size={14} />
                        Winning Ticket
                      </span>
                      <span className="sequel-95 text-[#DDE404] text-lg">
                        #{winnerData.winningTicket}
                      </span>
                    </div>
                  )}
                </div>

                {/* VRF Verification Section - Prominent */}
                {(winnerData.vrfTxHash || winnerData.vrfSeed) && (
                  <div className="border-t border-[#2A2A2A] pt-4 mt-4">
                    <div className="flex items-center gap-2 mb-3">
                      <ShieldCheck className="w-5 h-5 text-[#10B981]" />
                      <p className="sequel-75 text-[#10B981] text-sm uppercase">
                        ✓ Provably Fair Draw
                      </p>
                    </div>

                    {/* VRF Transaction Hash */}
                    {winnerData.vrfTxHash && (
                      <div className="bg-[#0A2818] border border-[#10B981]/20 rounded-lg p-3 mb-2">
                        <div className="flex items-center justify-between mb-2">
                          <span className="sequel-45 text-[#10B981]/80 text-xs">
                            VRF Transaction Hash
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <a
                            href={`https://basescan.org/tx/${winnerData.vrfTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="sequel-45 text-[#10B981] hover:text-[#10B981]/80 text-xs font-mono flex items-center gap-1 transition-colors"
                          >
                            {truncateHash(winnerData.vrfTxHash)}
                            <ExternalLink size={12} />
                          </a>
                          <button
                            onClick={() =>
                              handleCopy(winnerData.vrfTxHash!, "vrf")
                            }
                            className="text-[#10B981]/60 hover:text-[#10B981] transition-colors"
                            title="Copy VRF transaction hash"
                          >
                            {copiedField === "vrf" ? (
                              <CopyCheck size={14} className="text-[#10B981]" />
                            ) : (
                              <Copy size={14} />
                            )}
                          </button>
                        </div>
                        <p className="sequel-45 text-[#10B981]/60 text-xs mt-2">
                          Verify this draw on the blockchain →
                        </p>
                      </div>
                    )}

                    {/* Verification Formula */}
                    {winnerData.vrfSeed &&
                      winnerData.ticketsSold > 0 &&
                      winnerData.winningTicket !== null && (
                        <div className="bg-[#1A1A1A] rounded-lg p-3">
                          <p className="sequel-45 text-white/60 text-xs mb-2 flex items-center gap-1">
                            <ShieldCheck size={12} />
                            Verification Formula
                          </p>
                          <code className="sequel-45 text-[#DDE404] text-xs block break-all">
                            keccak256(VRF_SEED) % {winnerData.ticketsSold} + 1 =
                            #{winnerData.winningTicket}
                          </code>
                          <p className="sequel-45 text-white/40 text-xs mt-2">
                            Anyone can verify this result using the VRF seed
                          </p>
                        </div>
                      )}
                  </div>
                )}
              </>
            ) : (
              <>
                {/* Drawing in Progress State */}
                <div className="text-center py-6">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#DDE404]/10 mb-4">
                    <div className="animate-spin">
                      <ShieldCheck className="w-8 h-8 text-[#DDE404]" />
                    </div>
                  </div>
                  <p className="sequel-75 uppercase text-white md:text-xl text-lg mb-2">
                    Drawing Winner
                  </p>
                  <p className="sequel-45 text-white/60 text-sm max-w-md mx-auto">
                    The VRF (Verifiable Random Function) draw is in progress.
                    Winner information will appear here once the blockchain
                    confirms the selection.
                  </p>
                  <div className="mt-6 pt-4 border-t border-[#2A2A2A]">
                    <p className="sequel-45 text-white/40 text-xs">
                      This process is provably fair and verifiable on the
                      blockchain
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FinishedCompetitionHeroSection;
