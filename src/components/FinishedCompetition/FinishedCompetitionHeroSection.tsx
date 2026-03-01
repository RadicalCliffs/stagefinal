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
            "winner_address, outcomes_vrf_seed, tickets_sold, vrf_pregenerated_tx_hash",
          )
          .eq("id", id)
          .maybeSingle()) as any;

        let result: WinnerData = {
          winnerAddress: compData?.winner_address || null,
          winnerUsername: null,
          winningTicket: null,
          vrfTxHash: compData?.vrf_pregenerated_tx_hash || null,
          vrfSeed: compData?.outcomes_vrf_seed || null,
          ticketsSold: compData?.tickets_sold || 0,
        };

        // Fetch from competition_winners for more details
        const { data: winnerRow } = (await supabase
          .from("competition_winners")
          .select(
            "wallet_address, username, winner, ticket_number, winningticketnumber, tx_hash, txhash, vrf_tx_hash, rngtrxhash",
          )
          .eq("competition_id", id)
          .eq("is_winner", true)
          .maybeSingle()) as any;

        if (winnerRow) {
          result = {
            ...result,
            winnerAddress: result.winnerAddress || winnerRow.wallet_address,
            winnerUsername: winnerRow.username || winnerRow.winner || null,
            winningTicket:
              winnerRow.ticket_number || winnerRow.winningticketnumber || null,
            vrfTxHash:
              result.vrfTxHash ||
              winnerRow.tx_hash ||
              winnerRow.txhash ||
              winnerRow.vrf_tx_hash ||
              winnerRow.rngtrxhash ||
              null,
          };
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
            {/* Winner Section */}
            {winnerData &&
            (winnerData.winnerUsername ||
              winnerData.winnerAddress ||
              winnerData.winningTicket) ? (
              <>
                <div className="flex items-center gap-2 mb-4">
                  <Trophy className="w-6 h-6 text-[#DDE404]" />
                  <p className="sequel-75 uppercase text-[#DDE404] md:text-xl text-lg">
                    Winner Announced
                  </p>
                </div>

                {/* Winner Details Grid */}
                <div className="space-y-3 mb-4">
                  {winnerData.winnerUsername && (
                    <div className="flex items-center justify-between bg-[#1A1A1A] rounded-lg p-3">
                      <span className="sequel-45 text-white/60 text-sm">
                        Winner
                      </span>
                      <span className="sequel-75 text-white text-sm">
                        {winnerData.winnerUsername}
                      </span>
                    </div>
                  )}
                  {winnerData.winnerAddress && (
                    <div className="flex items-center justify-between bg-[#1A1A1A] rounded-lg p-3">
                      <span className="sequel-45 text-white/60 text-sm">
                        Wallet
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
                  {winnerData.winningTicket && (
                    <div className="flex items-center justify-between bg-[#1A1A1A] rounded-lg p-3">
                      <span className="sequel-45 text-white/60 text-sm flex items-center gap-1">
                        <Ticket size={14} />
                        Winning Ticket
                      </span>
                      <span className="sequel-95 text-[#DDE404] text-lg">
                        #{winnerData.winningTicket}
                      </span>
                    </div>
                  )}
                </div>

                {/* VRF Verification Section */}
                {winnerData.vrfTxHash && (
                  <div className="border-t border-[#2A2A2A] pt-4 mt-4">
                    <div className="flex items-center gap-2 mb-3">
                      <ShieldCheck className="w-5 h-5 text-[#DDE404]" />
                      <p className="sequel-75 text-[#DDE404] text-sm uppercase">
                        VRF Verification
                      </p>
                    </div>
                    <div className="bg-[#1A1A1A] rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <span className="sequel-45 text-white/60 text-xs">
                          Transaction Hash
                        </span>
                        <div className="flex items-center gap-2">
                          <a
                            href={`https://basescan.org/tx/${winnerData.vrfTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="sequel-45 text-blue-400 hover:text-blue-300 text-xs font-mono flex items-center gap-1"
                          >
                            {truncateHash(winnerData.vrfTxHash)}
                            <ExternalLink size={12} />
                          </a>
                          <button
                            onClick={() =>
                              handleCopy(winnerData.vrfTxHash!, "vrf")
                            }
                            className="text-white/40 hover:text-[#DDE404] transition-colors"
                          >
                            {copiedField === "vrf" ? (
                              <CopyCheck size={14} className="text-[#DDE404]" />
                            ) : (
                              <Copy size={14} />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                    {winnerData.vrfSeed && winnerData.ticketsSold > 0 && (
                      <div className="bg-[#1A1A1A] rounded-lg p-3 mt-2">
                        <p className="sequel-45 text-white/60 text-xs mb-1">
                          Verification Formula
                        </p>
                        <code className="sequel-45 text-yellow-400 text-xs block">
                          (VRF_SEED % {winnerData.ticketsSold}) + 1 = #
                          {winnerData.winningTicket || "?"}
                        </code>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="sequel-75 uppercase text-white md:text-xl text-lg mb-4">
                  Competition Status
                </p>
                <button className="uppercase sequel-95 sm:text-2xl text-xl pointer-events-none bg-[#414141] text-[#1F1F1F] w-full rounded-xl py-3">
                  {winnerData === null ? "Loading..." : "Drawing Winner..."}
                </button>
                <div className="mt-4 border-t border-[#2A2A2A] pt-4">
                  <p className="sequel-45 text-white/60 text-sm text-center">
                    Winner selection in progress. Results will appear here once
                    VRF completes.
                  </p>
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
