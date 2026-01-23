import { useState, useEffect, useMemo } from "react";
import { X, Trophy, Wallet, CheckCircle, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "../../lib/supabase";
import Loader from "../Loader";

interface WinnersModalProps {
  isOpen: boolean;
  onClose: () => void;
  competitionUid: string;
  competitionId?: string;
}

interface WinnerEntry {
  ticketNumber: number;
  prize: string;
  priority: number;
  isClaimed: boolean;
  winnerAddress?: string;
  claimedAt?: string;
}

// UUID validation regex (RFC 4122)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Prize tier labels
const PRIZE_LABELS: Record<number, string> = {
  1: 'Grand Prize',
  2: 'Major Prize',
  3: 'Jackpot',
};

const WinnersModal: React.FC<WinnersModalProps> = ({
  isOpen,
  onClose,
  competitionUid,
  competitionId,
}) => {
  const [winners, setWinners] = useState<WinnerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['major', 'minor']));

  // Fetch all winners from database
  useEffect(() => {
    if (!isOpen) return;

    const fetchWinners = async () => {
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
        const { data, error } = await supabase
          .from('Prize_Instantprizes')
          .select('winningTicket, prize, priority, winningWalletAddress, claimed_at')
          .eq('competitionId', lookupId)
          .order('priority', { ascending: true })
          .order('winningTicket', { ascending: true });

        if (!error && data) {
          const winnerEntries: WinnerEntry[] = data.map(item => ({
            ticketNumber: item.winningTicket || 0,
            prize: item.prize || (item.priority != null ? PRIZE_LABELS[item.priority] : undefined) || 'Prize',
            priority: item.priority || 99,
            isClaimed: !!item.winningWalletAddress,
            winnerAddress: item.winningWalletAddress || undefined,
            claimedAt: item.claimed_at || undefined,
          }));
          setWinners(winnerEntries);
        }
      } catch (err) {
        console.error('Error fetching winners:', err);
      }
      setLoading(false);
    };

    fetchWinners();
  }, [isOpen, competitionUid, competitionId]);

  // Categorize winners
  const majorWinners = useMemo(() =>
    winners.filter(w => w.priority >= 1 && w.priority <= 3),
    [winners]
  );

  const minorWinners = useMemo(() =>
    winners.filter(w => w.priority >= 4),
    [winners]
  );

  // Stats
  const majorClaimed = majorWinners.filter(w => w.isClaimed).length;
  const minorClaimed = minorWinners.filter(w => w.isClaimed).length;

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const formatAddress = (address?: string) => {
    if (!address) return 'Unknown';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden bg-[#1E1E1E] rounded-2xl border border-[#404040] mx-4">
        {/* Header */}
        <div className="sticky top-0 bg-[#1E1E1E] border-b border-[#404040] p-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <Trophy size={24} className="text-[#DDE404]" />
            <h2 className="text-white sequel-95 text-xl">ALL WINNERS</h2>
          </div>
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white transition-colors p-1"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(90vh-120px)] p-4">
          {loading ? (
            <div className="py-12">
              <Loader />
            </div>
          ) : winners.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-white/60 sequel-45">No winners yet</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-3 mb-6">
                <div className="bg-[#2A2A2A] rounded-lg p-3 text-center">
                  <p className="text-[#DDE404] sequel-95 text-2xl">{winners.length}</p>
                  <p className="text-white/60 sequel-45 text-xs">Total Winners</p>
                </div>
                <div className="bg-[#2A2A2A] rounded-lg p-3 text-center">
                  <p className="text-green-400 sequel-95 text-2xl">{majorClaimed + minorClaimed}</p>
                  <p className="text-white/60 sequel-45 text-xs">Claimed</p>
                </div>
                <div className="bg-[#2A2A2A] rounded-lg p-3 text-center">
                  <p className="text-white/50 sequel-95 text-2xl">{winners.length - majorClaimed - minorClaimed}</p>
                  <p className="text-white/60 sequel-45 text-xs">Available</p>
                </div>
              </div>

              {/* Major Prizes Section */}
              <div className="border border-[#404040] rounded-xl overflow-hidden">
                <button
                  onClick={() => toggleSection('major')}
                  className="w-full flex items-center justify-between p-4 bg-[#2A2A2A] hover:bg-[#333333] transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Trophy size={20} className="text-[#DDE404]" />
                    <span className="text-white sequel-95">MAJOR PRIZES ({majorClaimed}/{majorWinners.length})</span>
                  </div>
                  {expandedSections.has('major') ? (
                    <ChevronUp size={20} className="text-white/60" />
                  ) : (
                    <ChevronDown size={20} className="text-white/60" />
                  )}
                </button>

                {expandedSections.has('major') && (
                  <div className="p-4 space-y-2">
                    {majorWinners.map((winner, index) => (
                      <div
                        key={index}
                        className={`flex items-center justify-between p-3 rounded-lg ${
                          winner.isClaimed ? 'bg-[#404040]/50' : 'bg-[#DDE404]/10'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className={`sequel-95 text-lg ${
                            winner.isClaimed ? 'text-white/50' : 'text-[#DDE404]'
                          }`}>
                            #{winner.ticketNumber}
                          </span>
                          <span className="text-white/80 sequel-45 text-sm">
                            {winner.prize}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {winner.isClaimed ? (
                            <>
                              <CheckCircle size={16} className="text-green-400" />
                              <span className="text-green-400 sequel-45 text-sm">
                                {formatAddress(winner.winnerAddress)}
                              </span>
                            </>
                          ) : (
                            <>
                              <Clock size={16} className="text-[#DDE404]" />
                              <span className="text-[#DDE404] sequel-45 text-sm">Available</span>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Minor Prizes Section */}
              <div className="border border-[#404040] rounded-xl overflow-hidden">
                <button
                  onClick={() => toggleSection('minor')}
                  className="w-full flex items-center justify-between p-4 bg-[#2A2A2A] hover:bg-[#333333] transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Wallet size={20} className="text-green-400" />
                    <span className="text-white sequel-95">WALLET CREDITS ({minorClaimed}/{minorWinners.length})</span>
                  </div>
                  {expandedSections.has('minor') ? (
                    <ChevronUp size={20} className="text-white/60" />
                  ) : (
                    <ChevronDown size={20} className="text-white/60" />
                  )}
                </button>

                {expandedSections.has('minor') && (
                  <div className="p-4">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[300px] overflow-y-auto">
                      {minorWinners.map((winner, index) => (
                        <div
                          key={index}
                          className={`flex items-center justify-between p-2 rounded-lg text-sm ${
                            winner.isClaimed ? 'bg-[#404040]/50' : 'bg-green-500/10'
                          }`}
                        >
                          <span className={`sequel-75 ${
                            winner.isClaimed ? 'text-white/50 line-through' : 'text-white'
                          }`}>
                            #{winner.ticketNumber}
                          </span>
                          <span className={`sequel-45 text-xs ${
                            winner.isClaimed ? 'text-green-400/50' : 'text-green-400'
                          }`}>
                            {winner.prize}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-[#1E1E1E] border-t border-[#404040] p-4">
          <button
            onClick={onClose}
            className="w-full py-3 bg-[#DDE404] text-[#1A1A1A] rounded-lg sequel-75 hover:bg-[#DDE404]/90 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default WinnersModal;
