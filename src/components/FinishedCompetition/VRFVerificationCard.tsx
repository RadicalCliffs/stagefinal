import { useState } from "react";
import { ShieldCheck, ExternalLink, CheckCircle, Copy, CopyCheck } from "lucide-react";
import { handleCopy, VRF_CONTRACT_ADDRESS, BASE_EXPLORER_URL } from "../../utils/util";

interface VRFVerificationCardProps {
  vrfSeed: string | null;
  ticketsSold: number;
  winningTicketNumber: number | null;
}

/**
 * Calculate winning ticket from VRF seed for verification
 * Formula: (VRF_SEED % tickets_sold) + 1 = winning_ticket
 */
const calculateWinningTicket = (vrfSeed: string, ticketCount: number): number => {
  try {
    // Handle both hex and decimal seed formats
    const seedValue = vrfSeed.startsWith('0x')
      ? BigInt(vrfSeed)
      : BigInt(vrfSeed);
    return Number(seedValue % BigInt(ticketCount)) + 1;
  } catch {
    return 0;
  }
};

const VRFVerificationCard: React.FC<VRFVerificationCardProps> = ({
  vrfSeed,
  ticketsSold,
  winningTicketNumber,
}) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Don't render if no VRF seed available
  if (!vrfSeed || ticketsSold <= 0) {
    return null;
  }

  const verifiedWinningTicket = calculateWinningTicket(vrfSeed, ticketsSold);
  const isVerificationMatch = winningTicketNumber !== null && verifiedWinningTicket === winningTicketNumber;

  // Truncate seed for display but keep full value for copy
  const seedDisplay = vrfSeed.length > 30
    ? `${vrfSeed.slice(0, 15)}...${vrfSeed.slice(-15)}`
    : vrfSeed;

  return (
    <div className="bg-[#191919] max-w-7xl mx-auto rounded-2xl lg:px-14 px-6 lg:py-10 py-6 relative overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <ShieldCheck size={28} className="text-[#DDE404]" />
        <h3 className="sequel-95 text-white text-xl lg:text-2xl uppercase">On-Chain Verification</h3>
      </div>

      <p className="sequel-45 text-white/60 text-sm mb-6">
        This competition uses Chainlink VRF (Verifiable Random Function) for provably fair winner selection on the Base blockchain.
      </p>

      {/* VRF Seed Section */}
      <div className="space-y-4 mb-6">
        <div className="bg-[#2A2A2A] rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <p className="sequel-75 text-[#DDE404] text-sm mb-1">VRF Random Seed</p>
              <p className="sequel-45 text-white font-mono text-sm break-all">{seedDisplay}</p>
            </div>
            <div
              className="ml-4 cursor-pointer hover:scale-110 transition-transform shrink-0"
              onClick={() => handleCopy(0, vrfSeed, setCopiedIndex)}
            >
              {copiedIndex === 0 ? (
                <CopyCheck size={20} className="text-[#DDE404]" />
              ) : (
                <Copy size={20} className="text-white/60" />
              )}
            </div>
          </div>
        </div>

        {/* Verification Formula */}
        <div className="bg-[#2A2A2A] rounded-xl p-4">
          <p className="sequel-75 text-[#DDE404] text-sm mb-2">Verification Formula</p>
          <div className="bg-[#1A1A1A] rounded-lg p-3">
            <code className="sequel-45 text-yellow-400 text-sm block">
              (VRF_SEED % {ticketsSold}) + 1 = Ticket #{verifiedWinningTicket}
            </code>
          </div>
        </div>

        {/* VRF Contract Link */}
        <div className="bg-[#2A2A2A] rounded-xl p-4">
          <p className="sequel-75 text-[#DDE404] text-sm mb-2">VRF Contract (Base)</p>
          <a
            href={`${BASE_EXPLORER_URL}/address/${VRF_CONTRACT_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            className="sequel-45 text-blue-400 hover:underline font-mono text-sm flex items-center gap-2"
          >
            {VRF_CONTRACT_ADDRESS}
            <ExternalLink size={14} />
          </a>
        </div>
      </div>

      {/* Verification Match Confirmation */}
      {winningTicketNumber !== null && (
        <div className={`rounded-xl p-4 flex items-center gap-3 ${
          isVerificationMatch
            ? 'bg-green-900/30 border border-green-500'
            : 'bg-red-900/30 border border-red-500'
        }`}>
          <CheckCircle size={24} className={isVerificationMatch ? 'text-green-400' : 'text-red-400'} />
          <div>
            <p className={`sequel-75 text-sm ${isVerificationMatch ? 'text-green-400' : 'text-red-400'}`}>
              {isVerificationMatch ? 'Winner Verified' : 'Verification Mismatch'}
            </p>
            <p className="sequel-45 text-white/80 text-sm">
              {isVerificationMatch
                ? `Ticket #${winningTicketNumber} matches on-chain calculation`
                : `Expected ticket #${verifiedWinningTicket}, but winner has ticket #${winningTicketNumber}`
              }
            </p>
          </div>
        </div>
      )}

      {/* Footer Info */}
      <div className="mt-6 pt-4 border-t border-[#404040]">
        <p className="sequel-45 text-white/40 text-xs">
          Verify the winner yourself by checking the VRF seed on{' '}
          <a
            href="https://docs.chain.link/vrf"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:underline"
          >
            Chainlink VRF docs
          </a>
        </p>
      </div>
    </div>
  );
};

export default VRFVerificationCard;
