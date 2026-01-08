import { useState, useEffect, useMemo } from "react";
import { ChevronLeft, ChevronRight, Trophy, Wallet, CheckCircle } from "lucide-react";
import { supabase } from "../../lib/supabase";
import Loader from "../Loader";
import { winningTicket, pendingWinningTicket } from "../../assets/images";

interface WinningTicketsDisplayProps {
  competitionUid: string;
  competitionId?: string;
  totalTickets?: number;
}

interface WinningTicketData {
  ticketNumber: number;
  prize: string;
  priority: number;
  isClaimed: boolean;
  prizeValue?: number;
}

// UUID validation regex (RFC 4122)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Fixed prize structure: 3 major + 50 minor = 53 total winning tickets
const TOTAL_MAJOR_PRIZES = 3;
const TOTAL_MINOR_PRIZES = 50;
const TOTAL_WINNING_TICKETS = TOTAL_MAJOR_PRIZES + TOTAL_MINOR_PRIZES;

// Tickets per page for pagination (5 columns)
const TICKETS_PER_PAGE = 25;

const WinningTicketsDisplay: React.FC<WinningTicketsDisplayProps> = ({
  competitionUid,
  competitionId,
  totalTickets: _totalTickets = 1000
}) => {
  const [winningTickets, setWinningTickets] = useState<WinningTicketData[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);

  // Fetch all winning tickets from database
  useEffect(() => {
    const fetchWinningTickets = async () => {
      // Determine the best identifier to use
      let lookupId = competitionUid;
      if (!competitionUid || competitionUid.trim() === '' || !UUID_REGEX.test(competitionUid)) {
        if (competitionId && UUID_REGEX.test(competitionId)) {
          lookupId = competitionId;
        } else if (competitionId && competitionId.trim() !== '') {
          lookupId = competitionId;
        } else {
          setLoading(false);
          return;
        }
      }

      setLoading(true);
      try {
        // Fetch all winning tickets (all priorities)
        const { data, error } = await supabase
          .from('Prize_Instantprizes')
          .select('winningTicket, prize, priority, winningWalletAddress')
          .eq('competitionId', lookupId)
          .order('priority', { ascending: true })
          .order('winningTicket', { ascending: true });

        if (!error && data) {
          const tickets: WinningTicketData[] = data.map(item => ({
            ticketNumber: item.winningTicket || 0,
            prize: item.prize || 'Prize',
            priority: item.priority || 99,
            isClaimed: !!item.winningWalletAddress,
          }));
          setWinningTickets(tickets);
        }
      } catch (err) {
        console.error('Error fetching winning tickets:', err);
      }
      setLoading(false);
    };

    fetchWinningTickets();
  }, [competitionUid, competitionId]);

  // Categorize tickets
  const majorPrizeTickets = useMemo(() =>
    winningTickets.filter(t => t.priority >= 1 && t.priority <= 3),
    [winningTickets]
  );

  const minorPrizeTickets = useMemo(() =>
    winningTickets.filter(t => t.priority >= 4),
    [winningTickets]
  );

  // Stats
  const claimedMajor = majorPrizeTickets.filter(t => t.isClaimed).length;
  const claimedMinor = minorPrizeTickets.filter(t => t.isClaimed).length;
  const totalClaimed = claimedMajor + claimedMinor;

  if (loading) {
    return (
      <div className="py-8">
        <Loader />
      </div>
    );
  }

  if (winningTickets.length === 0) {
    return (
      <div className="max-w-4xl mx-auto text-center py-8">
        <p className="text-white/60 sequel-45">
          Winning tickets will be displayed once the competition is ready.
        </p>
        <p className="text-white/40 sequel-45 text-sm mt-2">
          {TOTAL_WINNING_TICKETS} winning tickets ({TOTAL_MAJOR_PRIZES} major prizes + {TOTAL_MINOR_PRIZES} minor prizes)
        </p>
      </div>
    );
  }

  // Pagination for all tickets
  const totalPages = Math.ceil(winningTickets.length / TICKETS_PER_PAGE);
  const startIndex = (currentPage - 1) * TICKETS_PER_PAGE;
  const endIndex = startIndex + TICKETS_PER_PAGE;
  const currentTickets = winningTickets.slice(startIndex, endIndex);

  // Generate page numbers to display
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    if (totalPages <= 5) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('...');
      for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
        if (!pages.includes(i)) pages.push(i);
      }
      if (currentPage < totalPages - 2) pages.push('...');
      if (!pages.includes(totalPages)) pages.push(totalPages);
    }
    return pages;
  };

  return (
    <div className="max-w-4xl mx-auto mb-8">
      {/* Header with prize breakdown */}
      <div className="text-center mb-6">
        <h3 className="text-white sequel-95 text-lg mb-2">ALL WINNING TICKETS</h3>
        <p className="text-white/60 sequel-45 text-sm">
          {winningTickets.length} winning tickets displayed upfront
        </p>
      </div>

      {/* Prize category legend */}
      <div className="flex flex-wrap justify-center gap-4 mb-6">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#DDE404]/10 rounded-lg">
          <Trophy size={16} className="text-[#DDE404]" />
          <span className="text-[#DDE404] sequel-45 text-sm">
            Major: {claimedMajor}/{majorPrizeTickets.length}
          </span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 rounded-lg">
          <Wallet size={16} className="text-green-400" />
          <span className="text-green-400 sequel-45 text-sm">
            Credits: {claimedMinor}/{minorPrizeTickets.length}
          </span>
        </div>
      </div>

      {/* Ticket Grid - 5 columns */}
      <div className="grid grid-cols-5 gap-3 sm:gap-4">
        {currentTickets.map((ticket) => {
          const isMajorPrize = ticket.priority >= 1 && ticket.priority <= 3;

          return (
            <div
              key={ticket.ticketNumber}
              className={`relative transition-all duration-200 ${
                ticket.isClaimed
                  ? "cursor-not-allowed opacity-75"
                  : "hover:scale-105 hover:-translate-y-1"
              }`}
              title={
                ticket.isClaimed
                  ? `Ticket #${ticket.ticketNumber} - ${ticket.prize} (CLAIMED)`
                  : `Ticket #${ticket.ticketNumber} - ${ticket.prize}`
              }
            >
              {/* Ticket Image Background */}
              <img
                src={ticket.isClaimed ? winningTicket : pendingWinningTicket}
                alt={ticket.isClaimed ? "Claimed ticket" : "Available ticket"}
                className="w-full h-auto"
                draggable={false}
              />
              {/* Ticket Number Overlay */}
              <div className="absolute inset-0 flex items-center">
                <span className={`sequel-95 text-sm sm:text-base md:text-lg lg:text-xl pl-[8%] ${
                  ticket.isClaimed ? "text-white/50" : "text-white"
                }`}>
                  {ticket.ticketNumber}
                </span>
              </div>
              {/* Prize type indicator */}
              {isMajorPrize && (
                <div className="absolute -top-1 -right-1 w-5 h-5 bg-[#DDE404] rounded-full flex items-center justify-center">
                  <Trophy size={12} className="text-[#1A1A1A]" />
                </div>
              )}
              {ticket.isClaimed && (
                <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                  <CheckCircle size={12} className="text-white" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="text-[#DDE404] hover:text-[#DDE404]/80 disabled:text-white/30 disabled:cursor-not-allowed transition-colors p-1"
          >
            <ChevronLeft size={20} />
          </button>

          <div className="flex items-center gap-1">
            {getPageNumbers().map((page, index) => (
              typeof page === 'number' ? (
                <button
                  key={index}
                  onClick={() => setCurrentPage(page)}
                  className={`w-8 h-8 flex items-center justify-center sequel-75 text-sm transition-colors ${
                    currentPage === page
                      ? 'text-[#DDE404]'
                      : 'text-white/60 hover:text-white'
                  }`}
                >
                  {page}
                </button>
              ) : (
                <span key={index} className="text-white/40 px-1">...</span>
              )
            ))}
          </div>

          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="text-[#DDE404] hover:text-[#DDE404]/80 disabled:text-white/30 disabled:cursor-not-allowed transition-colors p-1"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      )}

      {/* Stats Footer */}
      <div className="flex justify-center gap-6 sm:gap-10 mt-6 text-center">
        <div>
          <p className="text-[#DDE404] sequel-95 text-xl sm:text-2xl">{winningTickets.length}</p>
          <p className="text-white/60 sequel-45 text-xs uppercase">Total Winners</p>
        </div>
        <div>
          <p className="text-green-400 sequel-95 text-xl sm:text-2xl">{winningTickets.length - totalClaimed}</p>
          <p className="text-white/60 sequel-45 text-xs uppercase">Available</p>
        </div>
        <div>
          <p className="text-white/50 sequel-95 text-xl sm:text-2xl">{totalClaimed}</p>
          <p className="text-white/60 sequel-45 text-xs uppercase">Claimed</p>
        </div>
      </div>
    </div>
  );
};

export default WinningTicketsDisplay;
