import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { ChevronLeft, ChevronRight } from "lucide-react";
import PrizesHeader from "./PrizesHeader";
import Loader from "../Loader";

interface MinorPrizesSectionProps {
  competitionUid: string;
  competitionId?: string;
  totalEntries: number;
}

interface MinorPrizeEntry {
  id: string;
  entryNumber: number;
  prizeValue: number; // $2, $3, or $5
  isClaimed: boolean;
  winnerAddress?: string;
  prizeName: string;
  prizeUrl: string;
}

// UUID validation regex (RFC 4122)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Fixed configuration for minor prizes (50 total)
// 20x $2 credit, 20x $3 credit, 10x $5 credit
const MINOR_PRIZE_CONFIG = {
  TOTAL_PRIZES: 50,
  $2_COUNT: 20,
  $3_COUNT: 20,
  $5_COUNT: 10,
};
const ENTRIES_PER_PAGE = 25;
const MIN_PRIORITY_FOR_MINOR = 4; // Priority 4+ are minor prizes

// Default prize image for minor prizes (wallet credits)
const MINOR_PRIZE_IMAGE = 'https://mthwfldcjvpxjtmrqkqm.supabase.co/storage/v1/object/public/Competition%20Images/Competition%20Images/wallet-credit-prize.png';

// Minor prize value patterns (site credits)
const MINOR_PRIZE_PATTERNS = [
  { pattern: /^\$?2\s*(TICKETS?|SITE\s*CREDIT|CREDIT)?$/i, value: 2 },
  { pattern: /^\$?3\s*(TICKETS?|SITE\s*CREDIT|CREDIT)?$/i, value: 3 },
  { pattern: /^\$?5\s*(TICKETS?|SITE\s*CREDIT|CREDIT)?$/i, value: 5 },
];

// Helper to extract dollar value from prize name
const extractPrizeValue = (prizeName: string): number | null => {
  for (const { pattern, value } of MINOR_PRIZE_PATTERNS) {
    if (pattern.test(prizeName)) {
      return value;
    }
  }
  // Default to $2 if pattern not matched but it's a minor prize
  return 2;
};

// Inner component for the ticket grid (used as details prop for PrizesHeader)
interface MinorPrizesTicketGridProps {
  entries: MinorPrizeEntry[];
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

const MinorPrizesTicketGrid: React.FC<MinorPrizesTicketGridProps> = ({
  entries,
  currentPage,
  totalPages,
  onPageChange,
}) => {
  const handlePrev = () => {
    if (currentPage > 1) onPageChange(currentPage - 1);
  };

  const handleNext = () => {
    if (currentPage < totalPages) onPageChange(currentPage + 1);
  };

  // Stats for this page
  const claimedCount = entries.filter(e => e.isClaimed).length;
  const remainingCount = entries.length - claimedCount;

  return (
    <div className="w-full">
      {/* Stats row */}
      <div className="flex justify-center gap-6 mb-6">
        <div className="text-center">
          <span className="text-green-400 sequel-75 text-lg">{remainingCount}</span>
          <span className="text-white/60 sequel-45 text-sm ml-2">Available</span>
        </div>
        <div className="text-center">
          <span className="text-white/50 sequel-75 text-lg">{claimedCount}</span>
          <span className="text-white/60 sequel-45 text-sm ml-2">Claimed</span>
        </div>
      </div>

      {/* Ticket grid - consistent design */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4 pb-4">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={`relative rounded-lg py-4 sm:py-5 text-center transition-all duration-200 ${
              entry.isClaimed
                ? "bg-[#404040] cursor-not-allowed"
                : "bg-[#DDE404] hover:scale-105"
            }`}
            title={entry.isClaimed ? "This entry has been claimed" : `Entry #${entry.entryNumber} - $${entry.prizeValue} wallet credit`}
          >
            <span className={`sequel-75 text-base sm:text-lg ${
              entry.isClaimed ? "text-[#606060] line-through" : "text-[#1A1A1A]"
            }`}>
              {entry.entryNumber}
            </span>
            {/* Prize value badge */}
            <span className={`absolute -top-2 -right-2 text-xs px-2 py-0.5 rounded-full sequel-75 ${
              entry.isClaimed
                ? "bg-[#606060] text-white/50"
                : "bg-green-500 text-white"
            }`}>
              ${entry.prizeValue}
            </span>
            {entry.isClaimed && (
              <div className="absolute w-8/12 bg-white/30 h-[1px] left-1/2 top-1/2 -translate-y-1/2 -rotate-12 -translate-x-1/2"></div>
            )}
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-4 sm:gap-6 mt-6 pb-3">
          <ChevronLeft
            size={24}
            className={`text-white cursor-pointer transition ${
              currentPage === 1 ? "opacity-40 pointer-events-none" : "hover:scale-110"
            }`}
            onClick={handlePrev}
          />
          <div className="flex items-center gap-2 sm:gap-3 text-white sequel-45 text-sm sm:text-base">
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              let pageNum = i + 1;
              if (totalPages > 5) {
                if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => onPageChange(pageNum)}
                  className={`px-3 sm:px-4 py-1 rounded-md cursor-pointer transition ${
                    currentPage === pageNum
                      ? "bg-[#DDE404] text-[#232323]"
                      : "hover:bg-[#DDE404] hover:text-[#232323]"
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
          </div>
          <ChevronRight
            size={24}
            className={`text-white cursor-pointer transition ${
              currentPage === totalPages
                ? "opacity-40 pointer-events-none"
                : "hover:scale-110"
            }`}
            onClick={handleNext}
          />
        </div>
      )}
    </div>
  );
};

const MinorPrizesSection: React.FC<MinorPrizesSectionProps> = ({
  competitionUid,
  competitionId,
  totalEntries: _totalEntries,
}) => {
  const [minorPrizes, setMinorPrizes] = useState<MinorPrizeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);

  // Fetch minor prizes from database (priority >= 4)
  useEffect(() => {
    const fetchMinorPrizes = async () => {
      // Determine the best identifier to use
      // Try competitionUid first if it's a valid UUID, otherwise use competitionId
      let lookupId = competitionUid;
      if (!competitionUid || competitionUid.trim() === '' || !UUID_REGEX.test(competitionUid)) {
        // Fall back to competitionId if uid is not a valid UUID
        if (competitionId && UUID_REGEX.test(competitionId)) {
          lookupId = competitionId;
        } else if (competitionId && competitionId.trim() !== '') {
          // Use competitionId even if not UUID format - the database might have entries matching it
          lookupId = competitionId;
        } else {
          setMinorPrizes([]);
          setLoading(false);
          return;
        }
      }

      setLoading(true);
      try {
        // Fetch all instant win prizes with priority >= 4 (minor prizes)
        const { data, error } = await supabase
          .from('Prize_Instantprizes')
          .select('*')
          .eq('competitionId', lookupId)
          .gte('priority', MIN_PRIORITY_FOR_MINOR)
          .order('winningTicket', { ascending: true }) as { data: any[]; error: any };

        if (!error && data) {
          // Map database entries to MinorPrizeEntry
          const minorPrizeEntries: MinorPrizeEntry[] = data.map(prize => ({
            id: prize.UID,
            entryNumber: prize.winningTicket || 0,
            prizeValue: extractPrizeValue(prize.prize || '') || 2,
            isClaimed: !!prize.winningWalletAddress,
            winnerAddress: prize.winningWalletAddress || undefined,
            prizeName: prize.prize || '',
            prizeUrl: prize.url || '',
          }));

          setMinorPrizes(minorPrizeEntries);
        }
      } catch (err) {
        console.error('Error fetching minor prizes:', err);
      }
      setLoading(false);
    };

    fetchMinorPrizes();
  }, [competitionUid, competitionId]);

  // Pagination calculations
  const totalPages = Math.ceil(minorPrizes.length / ENTRIES_PER_PAGE);
  const startIndex = (currentPage - 1) * ENTRIES_PER_PAGE;
  const currentEntries = minorPrizes.slice(startIndex, startIndex + ENTRIES_PER_PAGE);

  // Stats for header
  const claimedCount = minorPrizes.filter(p => p.isClaimed).length;

  // Group by prize value for display
  const prizeBreakdown = {
    $2: minorPrizes.filter(p => p.prizeValue === 2).length,
    $3: minorPrizes.filter(p => p.prizeValue === 3).length,
    $5: minorPrizes.filter(p => p.prizeValue === 5).length,
  };

  if (loading) {
    return (
      <div className="py-12">
        <Loader />
      </div>
    );
  }

  // Show message if no minor prizes yet
  if (minorPrizes.length === 0) {
    return (
      <div className="max-w-5xl mx-auto text-center py-8">
        <p className="text-white/60 sequel-45">
          Minor prizes (wallet credits) will be revealed once the competition is ready.
        </p>
        <p className="text-white/40 sequel-45 text-sm mt-2">
          Expected: {MINOR_PRIZE_CONFIG.$2_COUNT}x $2 + {MINOR_PRIZE_CONFIG.$3_COUNT}x $3 + {MINOR_PRIZE_CONFIG.$5_COUNT}x $5 = {MINOR_PRIZE_CONFIG.TOTAL_PRIZES} prizes
        </p>
      </div>
    );
  }

  // Build description showing prize breakdown
  const prizeDescription = minorPrizes.length > 0
    ? `${prizeBreakdown.$2}x $2 • ${prizeBreakdown.$3}x $3 • ${prizeBreakdown.$5}x $5`
    : `${MINOR_PRIZE_CONFIG.$2_COUNT}x $2 • ${MINOR_PRIZE_CONFIG.$3_COUNT}x $3 • ${MINOR_PRIZE_CONFIG.$5_COUNT}x $5`;

  return (
    <PrizesHeader
      image={MINOR_PRIZE_IMAGE}
      title="Wallet Credits"
      toBeWon={`${claimedCount}/${minorPrizes.length}`}
      details={
        <div className="w-full">
          {/* Prize breakdown badge */}
          <div className="flex justify-center mb-4">
            <span className="text-[#DDE404] sequel-45 text-sm px-3 py-1 bg-[#DDE404]/10 rounded-full">
              {prizeDescription}
            </span>
          </div>

          <MinorPrizesTicketGrid
            entries={currentEntries}
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
        </div>
      }
    />
  );
};

export default MinorPrizesSection;
