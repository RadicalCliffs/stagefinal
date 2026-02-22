import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState, useCallback } from "react";

interface TicketGridProps {
  start: number;
  end: number;
  availableTickets?: number[];
  selectedTickets: number[];
  ownedTickets?: number[]; // User's already purchased tickets
  onSelect: (ticket: number) => void;
  maxSelectableCount?: number; // Hard limit on how many tickets can be selected
}

const TicketGrid: React.FC<TicketGridProps> = ({
  start,
  end,
  availableTickets = [],
  selectedTickets,
  ownedTickets = [],
  onSelect,
  maxSelectableCount,
}) => {
  // Debug: Log received props
  console.log('[TicketGrid] Props received:', {
    start,
    end,
    availableTicketsCount: availableTickets.length,
    selectedTicketsCount: selectedTickets.length,
    ownedTicketsCount: ownedTickets.length,
    first5Available: availableTickets.slice(0, 5)
  });

  // Pagination
  const itemsPerPage = 100;
  const totalTickets = end - start + 1;
  const totalPages = Math.ceil(totalTickets / itemsPerPage);
  const [currentPage, setCurrentPage] = useState(1);

  const startIndex = (currentPage - 1) * itemsPerPage + start;
  const endIndex = Math.min(startIndex + itemsPerPage - 1, end);
  const visibleTickets = Array.from(
    { length: endIndex - startIndex + 1 },
    (_, i) => startIndex + i
  );

  const handlePrev = () => {
    if (currentPage > 1) setCurrentPage((p) => p - 1);
  };

  const handleNext = () => {
    if (currentPage < totalPages) setCurrentPage((p) => p + 1);
  };

  // Calculate stats for current view
  const availableInView = visibleTickets.filter(t => availableTickets.includes(t)).length;
  const selectedInView = visibleTickets.filter(t => selectedTickets.includes(t)).length;
  const ownedInView = visibleTickets.filter(t => ownedTickets.includes(t)).length;

  // Enhanced click handler with mobile touch support
  const handleTicketClick = useCallback((num: number, isDisabled: boolean) => {
    if (!isDisabled) {
      onSelect(num);
    }
  }, [onSelect]);

  return (
    <div className="space-y-6">
      {/* Header with stats and pagination */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
        {/* Stats */}
        <div className="flex items-center gap-4 text-sm">
          <span className="text-white/60 sequel-45">
            <span className="text-green-400 sequel-75">{availableInView}</span> available
          </span>
          <span className="text-white/60 sequel-45">
            <span className="text-[#DDE404] sequel-75">{selectedInView}</span> selected
          </span>
          {ownedInView > 0 && (
            <span className="text-white/60 sequel-45">
              <span className="text-emerald-400 sequel-75">{ownedInView}</span> owned
            </span>
          )}
        </div>

        {/* Pagination controls */}
        <div className="flex items-center gap-4">
          <ChevronLeft
            size={24}
            className={`cursor-pointer text-white ${
              currentPage === 1
                ? "opacity-40 pointer-events-none"
                : "hover:scale-110 hover:text-[#DDE404]"
            }`}
            onClick={handlePrev}
          />
          <span className="uppercase sequel-45 text-white/70 text-sm">
            Page {currentPage} of {totalPages}
          </span>
          <ChevronRight
            size={24}
            className={`cursor-pointer text-white ${
              currentPage === totalPages
                ? "opacity-40 pointer-events-none"
                : "hover:scale-110 hover:text-[#DDE404]"
            }`}
            onClick={handleNext}
          />
        </div>
      </div>

      {/* Ticket Grid - Fixed mobile touch handling */}
      <div className="grid grid-cols-5 sm:grid-cols-7 md:grid-cols-10 gap-2 sm:gap-3 select-none">
        {visibleTickets.map((num) => {
          const isAvailable = availableTickets.includes(num);
          const isSelected = selectedTickets.includes(num);
          const isOwned = ownedTickets.includes(num);
          // Check if max selection limit reached (can still deselect)
          const atMaxLimit = maxSelectableCount !== undefined &&
            selectedTickets.length >= maxSelectableCount &&
            !isSelected;
          // A ticket is disabled if it's unavailable, owned, OR if we've hit the max limit and this ticket isn't already selected
          const isDisabled = !isAvailable || isOwned || atMaxLimit;

          // Consistent styling with other ticket grids
          let bgClass = "bg-[#404040] text-[#DDE404] border border-[#DDE404]/50 hover:border-[#DDE404]";
          if (isOwned) {
            // Owned tickets get a distinct green style
            bgClass = "bg-emerald-900/50 cursor-default text-emerald-300 border border-emerald-500/50";
          } else if (!isAvailable) {
            bgClass = "bg-[#2A2A2A] cursor-not-allowed text-[#606060] border border-transparent";
          } else if (isSelected) {
            bgClass = "bg-[#DDE404] text-[#1A1A1A] border border-[#DDE404] shadow-lg shadow-[#DDE404]/20";
          } else if (atMaxLimit) {
            bgClass = "bg-[#404040] cursor-not-allowed text-[#606060] border border-[#606060] opacity-50";
          }

          return (
            <button
              key={num}
              type="button"
              onClick={() => handleTicketClick(num, isDisabled)}
              onTouchEnd={(e) => {
                // Prevent double-firing on mobile (touch + click)
                e.preventDefault();
                handleTicketClick(num, isDisabled);
              }}
              disabled={isDisabled}
              className={`relative rounded-lg py-3 sm:py-4 text-center transition-all duration-150 sequel-75 text-sm sm:text-base touch-manipulation ${bgClass} ${
                !isDisabled ? 'cursor-pointer active:scale-95 sm:hover:scale-105' : ''
              }`}
              title={isOwned ? `Ticket ${num} - You own this ticket` : atMaxLimit ? "Maximum tickets selected" : !isAvailable ? "Ticket unavailable" : isSelected ? `Deselect ticket ${num}` : `Select ticket ${num}`}
              aria-pressed={isSelected}
              aria-disabled={isDisabled}
            >
              {num}
              {isOwned && (
                <div className="absolute top-0.5 right-0.5 w-2 h-2 bg-emerald-400 rounded-full"></div>
              )}
              {!isAvailable && !isOwned && (
                <div className="absolute w-6/12 bg-white/20 h-px left-1/2 top-1/2 -translate-y-1/2 -rotate-12 -translate-x-1/2"></div>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-4 sm:gap-6 pt-2 border-t border-white/10">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-[#404040] border border-[#DDE404]/50"></div>
          <span className="text-white/60 sequel-45 text-xs">Available</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-[#DDE404]"></div>
          <span className="text-white/60 sequel-45 text-xs">Selected</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-emerald-900/50 border border-emerald-500/50 relative">
            <div className="absolute top-0 right-0 w-1.5 h-1.5 bg-emerald-400 rounded-full"></div>
          </div>
          <span className="text-white/60 sequel-45 text-xs">Owned</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-[#2A2A2A]"></div>
          <span className="text-white/60 sequel-45 text-xs">Unavailable</span>
        </div>
      </div>
    </div>
  );
};

export default TicketGrid;
