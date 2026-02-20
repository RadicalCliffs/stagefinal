import { useState, useEffect } from "react";
import { ShieldCheck, ExternalLink, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { VRFRNG } from "../../lib/rng-utils";

interface VRFVerificationSectionProps {
  competitionUid: string;
  competitionId?: string;
  totalTickets: number;
}

interface VRFData {
  vrfSeed: string | null;
  seedGeneratedAt: string | null;
  verified: boolean | null;
}

// UUID validation regex (RFC 4122)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Total winning tickets: 3 major + 50 minor = 53
const TOTAL_WINNING_TICKETS = 53;

const VRFVerificationSection: React.FC<VRFVerificationSectionProps> = ({
  competitionUid,
  competitionId,
  totalTickets,
}) => {
  const [vrfData, setVrfData] = useState<VRFData | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<boolean | null>(null);
  const [winningTickets, setWinningTickets] = useState<number[]>([]);

  // Fetch VRF data from competition
  useEffect(() => {
    const fetchVRFData = async () => {
      let lookupId = competitionUid;
      if (!competitionUid || !UUID_REGEX.test(competitionUid)) {
        if (competitionId && (UUID_REGEX.test(competitionId) || competitionId.trim() !== '')) {
          lookupId = competitionId;
        } else {
          setLoading(false);
          return;
        }
      }

      setLoading(true);
      try {
        // Fetch competition VRF data - try by id first, then fallback to uid
        let compData = null;
        let compError = null;

        // First try looking up by id (primary key)
        // Use updated schema fields: outcomes_vrf_seed, randomness_verified_at, vrf_verified
        const { data: byId, error: byIdError } = await supabase
          .from('competitions')
          .select('outcomes_vrf_seed, randomness_verified_at, vrf_verified')
          .eq('id', lookupId)
          .maybeSingle() as any;

        if (byId) {
          compData = byId;
        } else {
          // Fallback to uid lookup if id lookup fails
          const { data: byUid, error: byUidError } = await supabase
            .from('competitions')
            .select('outcomes_vrf_seed, randomness_verified_at, vrf_verified')
            .eq('uid', lookupId)
            .maybeSingle() as any;
          compData = byUid;
          compError = byUidError;
        }

        if (!compError && compData) {
          setVrfData({
            vrfSeed: compData.outcomes_vrf_seed,
            seedGeneratedAt: compData.randomness_verified_at,
            verified: compData.vrf_verified,
          });
        }

        // Fetch winning tickets for verification
        const { data: ticketData, error: ticketError } = await supabase
          .from('Prize_Instantprizes')
          .select('winningTicket')
          .eq('competitionId', lookupId)
          .order('winningTicket', { ascending: true } as any);

        if (!ticketError && ticketData) {
          setWinningTickets(ticketData.map(t => t.winningTicket).filter(Boolean));
        }
      } catch (err) {
        console.error('Error fetching VRF data:', err);
      }
      setLoading(false);
    };

    fetchVRFData();
  }, [competitionUid, competitionId]);

  // Verify VRF outcomes locally
  const handleVerify = async () => {
    if (!vrfData?.vrfSeed || winningTickets.length === 0) return;

    setVerifying(true);
    try {
      // Use the VRFRNG to verify the winning tickets match the seed
      const isValid = VRFRNG.verifyWinningTickets(
        vrfData.vrfSeed,
        totalTickets,
        TOTAL_WINNING_TICKETS,
        winningTickets
      );
      setVerificationResult(isValid);
    } catch (err) {
      console.error('Verification error:', err);
      setVerificationResult(false);
    }
    setVerifying(false);
  };

  if (loading) {
    return null;
  }

  // Don't show if no VRF seed
  if (!vrfData?.vrfSeed) {
    return null;
  }

  const seedDisplay = vrfData.vrfSeed.length > 20
    ? `${vrfData.vrfSeed.slice(0, 10)}...${vrfData.vrfSeed.slice(-10)}`
    : vrfData.vrfSeed;

  return (
    <div className="max-w-4xl mx-auto mb-8">
      <div className="bg-[#2A2A2A] border border-[#404040] rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <ShieldCheck size={24} className="text-[#DDE404]" />
          <h3 className="text-white sequel-95 text-lg">VRF VERIFICATION</h3>
        </div>

        <p className="text-white/60 sequel-45 text-sm mb-4">
          This competition uses Chainlink VRF for provably fair winner selection.
          Verify that the winning tickets were generated correctly from the VRF seed.
        </p>

        {/* VRF Seed Display */}
        <div className="bg-[#1A1A1A] rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/40 sequel-45 text-xs uppercase mb-1">VRF Seed</p>
              <p className="text-white/80 sequel-75 text-sm font-mono">{seedDisplay}</p>
            </div>
            {vrfData.seedGeneratedAt && (
              <div className="text-right">
                <p className="text-white/40 sequel-45 text-xs uppercase mb-1">Generated</p>
                <p className="text-white/60 sequel-45 text-sm">
                  {new Date(vrfData.seedGeneratedAt).toLocaleDateString()}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Verification Status */}
        <div className="flex flex-wrap items-center gap-4">
          {/* Verify Button */}
          <button
            onClick={handleVerify}
            disabled={verifying || !vrfData.vrfSeed}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg sequel-75 text-sm transition-all ${
              verifying
                ? 'bg-[#404040] text-white/50 cursor-wait'
                : 'bg-[#DDE404] text-[#1A1A1A] hover:bg-[#DDE404]/90'
            }`}
          >
            {verifying ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Verifying...
              </>
            ) : (
              <>
                <ShieldCheck size={16} />
                Verify Outcomes
              </>
            )}
          </button>

          {/* Verification Result */}
          {verificationResult !== null && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
              verificationResult
                ? 'bg-green-500/20 text-green-400'
                : 'bg-red-500/20 text-red-400'
            }`}>
              {verificationResult ? (
                <>
                  <CheckCircle size={16} />
                  <span className="sequel-45 text-sm">Verified! Outcomes match VRF seed</span>
                </>
              ) : (
                <>
                  <XCircle size={16} />
                  <span className="sequel-45 text-sm">Verification failed</span>
                </>
              )}
            </div>
          )}

          {/* Pre-verified indicator */}
          {vrfData.verified && verificationResult === null && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 text-green-400">
              <CheckCircle size={16} />
              <span className="sequel-45 text-sm">Pre-verified by system</span>
            </div>
          )}
        </div>

        {/* Info text */}
        <p className="text-white/40 sequel-45 text-xs mt-4">
          {winningTickets.length} winning tickets • Fisher-Yates shuffle algorithm • xorshift128+ PRNG
        </p>
      </div>
    </div>
  );
};

export default VRFVerificationSection;
