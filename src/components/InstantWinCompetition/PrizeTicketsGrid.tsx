import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PrizesDetailsProps } from "../../models/models";

const PrizesDetails: React.FC<PrizesDetailsProps> = ({
  tickets,
  itemsPerPage = 10,
}) => {
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.ceil(tickets.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentTickets = tickets.slice(startIndex, startIndex + itemsPerPage);

  const handlePrev = () => {
    if (currentPage > 1) setCurrentPage((p) => p - 1);
  };

  const handleNext = () => {
    if (currentPage < totalPages) setCurrentPage((p) => p + 1);
  };

  // Show claimed/remaining stats
  const claimedCount = tickets.filter(t => t.isWinner).length;
  const remainingCount = tickets.length - claimedCount;

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

      {/* Ticket grid - consistent with other grids */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4 pb-4">
        {currentTickets.map((ticket) => (
          <div
            key={ticket.id}
            className={`relative rounded-lg py-4 sm:py-5 text-center transition-all duration-200 ${
              ticket.isWinner
                ? "bg-[#404040] cursor-not-allowed"
                : "bg-[#DDE404] hover:scale-105"
            }`}
            title={ticket.isWinner ? "This ticket has been claimed" : `Ticket #${ticket.number} - Available`}
          >
            <span className={`sequel-75 text-base sm:text-lg ${
              ticket.isWinner ? "text-[#606060] line-through" : "text-[#1A1A1A]"
            }`}>
              {ticket.number}
            </span>
            {ticket.isWinner && (
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
              // Show pages around current page
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
                  onClick={() => setCurrentPage(pageNum)}
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

export default PrizesDetails;
