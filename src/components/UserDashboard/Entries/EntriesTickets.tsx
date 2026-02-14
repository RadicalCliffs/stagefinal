import { ChevronLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { Link } from 'react-router';
import { useState } from 'react';

interface EntryData {
  id: string;
  purchase_date?: string | null;
  amount_spent?: string | number | null;
  ticket_numbers?: string | null;
  number_of_tickets?: number | null;
  transaction_hash?: string | null;
}

interface EntriesTicketsProps {
  ticketNumbers?: string;
  numberOfTickets?: number;
  amountSpent?: string;
  purchaseDate?: string;
  transactionHash?: string;
  individualEntries?: EntryData[];
}

const EntriesTickets = ({ 
  ticketNumbers, 
  numberOfTickets, 
  amountSpent, 
  purchaseDate, 
  transactionHash,
  individualEntries
}: EntriesTicketsProps) => {
  const [showAllPurchases, setShowAllPurchases] = useState(false);
  const [expandedPurchases, setExpandedPurchases] = useState<Set<number>>(new Set());
  
  // Parse ticket numbers from comma-separated string and sort numerically
  const tickets = ticketNumbers
    ? ticketNumbers.split(',').map(t => t.trim()).filter(t => t).sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    : [];
  
  // Format ticket numbers as comma-separated string for display
  const ticketNumbersFormatted = tickets.join(', ');

  // Toggle expanded state for a purchase
  const togglePurchase = (index: number) => {
    setExpandedPurchases(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  // If no tickets, show a placeholder message
  if (tickets.length === 0) {
    return (
      <div>
        <div className="bg-[#DDE404] h-0.5 w-full mt-8"></div>
        <div className="mt-7">
          <p className="sequel-45 text-white/60">Ticket Number(s)</p>
          <div className="mt-5 text-white/50 sequel-45 text-center py-8">
            No ticket numbers available
          </div>
          <Link to={'/dashboard/entries'} className="border border-[#DDE404] rounded-md py-3 px-3 mt-8 cursor-pointer hover:scale-105 transition-all flex w-fit items-center lg:mx-0 mx-auto">
            <ChevronLeft color="#DDE404" size={18} />
            <span className="sequel-45 text-white text-sm uppercase ml-1 sm:pb-[3.5px] sm:pt-0 pt-1">
              Back
            </span>
          </Link>
        </div>
      </div>
    );
  }

  // If we have individual entries, show them grouped by purchase
  if (individualEntries && individualEntries.length > 1) {
    // Sort by purchase date descending
    const sortedEntries = [...individualEntries].sort(
      (a, b) =>
        new Date(b.purchase_date || 0).getTime() -
        new Date(a.purchase_date || 0).getTime()
    );

    // Determine how many to show (4 max initially)
    const MAX_VISIBLE = 4;
    const visibleEntries = showAllPurchases ? sortedEntries : sortedEntries.slice(0, MAX_VISIBLE);
    const hasMore = sortedEntries.length > MAX_VISIBLE;

    return (
      <div>
        <div className="bg-[#DDE404] h-0.5 w-full mt-8"></div>
        <div className="mt-7">
          <div className="flex items-center justify-between mb-5">
            <p className="sequel-45 text-white/60">Tickets by Purchase</p>
            <span className="sequel-45 text-[#DDE404] text-sm">
              {numberOfTickets} {numberOfTickets === 1 ? 'ticket' : 'tickets'} - {sortedEntries.length} {sortedEntries.length === 1 ? 'purchase' : 'purchases'}
            </span>
          </div>

          {/* List of purchases */}
          <div className="space-y-4">
            {visibleEntries.map((entry, index) => {
              const entryTickets = entry.ticket_numbers
                ? entry.ticket_numbers.split(',').map(t => t.trim()).filter(t => t).sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
                : [];
              const isExpanded = expandedPurchases.has(index);
              const displayTickets = isExpanded ? entryTickets : entryTickets.slice(0, 4);
              const hasMoreTickets = entryTickets.length > 4;

              return (
                <div key={entry.id} className="bg-[#1a1a1a] rounded-lg p-4">
                  {/* Purchase header */}
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="text-white sequel-45 text-sm">
                        Purchase {index + 1}
                      </div>
                      <div className="text-white/60 sequel-45 text-xs mt-1">
                        {entry.purchase_date
                          ? new Date(entry.purchase_date).toLocaleString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "Date unknown"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[#DDE404] sequel-45 text-sm">
                        ${typeof entry.amount_spent === 'number' 
                          ? entry.amount_spent.toFixed(2)
                          : entry.amount_spent || '0.00'}
                      </div>
                      <div className="text-white/60 sequel-45 text-xs mt-1">
                        {entry.number_of_tickets} {entry.number_of_tickets === 1 ? 'ticket' : 'tickets'}
                      </div>
                    </div>
                  </div>

                  {/* Tickets grid */}
                  {entryTickets.length > 0 && (
                    <div>
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                        {displayTickets.map((ticket) => (
                          <div
                            key={`${entry.id}-${ticket}`}
                            className="bg-[#393939] text-xs text-white text-center sequel-45 rounded-sm py-2 px-1"
                          >
                            <span>{ticket}</span>
                          </div>
                        ))}
                      </div>

                      {/* Show more/less button for tickets */}
                      {hasMoreTickets && (
                        <button
                          onClick={() => togglePurchase(index)}
                          className="mt-2 text-[#DDE404] sequel-45 text-xs hover:underline flex items-center gap-1"
                        >
                          {isExpanded ? (
                            <>
                              <ChevronUp size={14} />
                              <span>Show less</span>
                            </>
                          ) : (
                            <>
                              <ChevronDown size={14} />
                              <span>Show {entryTickets.length - 4} more tickets</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Show more/less purchases button */}
          {hasMore && (
            <button
              onClick={() => setShowAllPurchases(!showAllPurchases)}
              className="mt-4 w-full bg-[#1a1a1a] text-[#DDE404] sequel-45 text-sm py-3 rounded-lg hover:bg-[#252525] transition-colors flex items-center justify-center gap-2"
            >
              {showAllPurchases ? (
                <>
                  <ChevronUp size={16} />
                  <span>Show less</span>
                </>
              ) : (
                <>
                  <ChevronDown size={16} />
                  <span>Show {sortedEntries.length - MAX_VISIBLE} more purchases</span>
                </>
              )}
            </button>
          )}

          <Link to={'/dashboard/entries'} className="border border-[#DDE404] rounded-md py-3 px-3 mt-8 cursor-pointer hover:scale-105 transition-all flex w-fit items-center lg:mx-0 mx-auto">
            <ChevronLeft color="#DDE404" size={18} />
            <span className="sequel-45 text-white text-sm uppercase ml-1 sm:pb-[3.5px] sm:pt-0 pt-1">
              Back
            </span>
          </Link>
        </div>
      </div>
    );
  }

  // Fallback: Show all tickets in a grid (original behavior for single purchase or no individual entries data)
  return (
    <div>
      <div className="bg-[#DDE404] h-0.5 w-full mt-8"></div>
      <div className="mt-7">
        <div className="flex items-center justify-between mb-5">
          <p className="sequel-45 text-white/60">Ticket Number(s)</p>
          {numberOfTickets && (
            <span className="sequel-45 text-[#DDE404] text-sm">
              {numberOfTickets} {numberOfTickets === 1 ? 'ticket' : 'tickets'}
            </span>
          )}
        </div>

        <div className="grid xl:grid-cols-10 lg:grid-cols-7 md:grid-cols-5 grid-cols-3 gap-x-2 gap-y-4">
          {tickets.map((ticket) => (
            <div
              key={ticket}
              className="bg-[#393939] sm:text-sm text-xs text-white text-center sequel-45 rounded-sm py-3 px-2 w-full"
            >
              <span>{ticket}</span>
            </div>
          ))}
        </div>

        {/* Payment Information Section */}
        {(amountSpent || purchaseDate || transactionHash) && (
          <>
            <div className="bg-[#DDE404] h-0.5 w-full mt-8"></div>
            <div className="mt-7">
              <p className="sequel-45 text-white/60 mb-5">Payment Information</p>
              <div className="space-y-3">
                {amountSpent && (
                  <div className="flex items-start justify-between">
                    <span className="text-[#DDE404] sequel-45 text-sm">Amount Spent:</span>
                    <span className="text-white sequel-45 text-sm">${amountSpent}</span>
                  </div>
                )}
                {purchaseDate && (
                  <div className="flex items-start justify-between">
                    <span className="text-[#DDE404] sequel-45 text-sm">Purchase Date:</span>
                    <span className="text-white sequel-45 text-sm">
                      {new Date(purchaseDate).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true
                      })}
                    </span>
                  </div>
                )}
                {numberOfTickets && (
                  <div className="flex items-start justify-between">
                    <span className="text-[#DDE404] sequel-45 text-sm">Tickets Purchased:</span>
                    <span className="text-white sequel-45 text-sm">
                      {numberOfTickets} {numberOfTickets === 1 ? 'ticket' : 'tickets'}
                    </span>
                  </div>
                )}
                {ticketNumbers && (
                  <div className="flex items-start justify-between">
                    <span className="text-[#DDE404] sequel-45 text-sm">Ticket Numbers:</span>
                    <span className="text-white sequel-45 text-sm text-right max-w-[60%]">
                      {ticketNumbersFormatted}
                    </span>
                  </div>
                )}
                {transactionHash && transactionHash !== 'no-hash' && (
                  <div className="flex items-start justify-between">
                    <span className="text-[#DDE404] sequel-45 text-sm">Transaction:</span>
                    <a 
                      href={`https://basescan.org/tx/${transactionHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white sequel-45 text-sm hover:text-[#DDE404] transition-colors underline max-w-[60%] break-all"
                    >
                      {transactionHash.slice(0, 10)}...{transactionHash.slice(-8)}
                    </a>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        <Link to={'/dashboard/entries'} className="border border-[#DDE404] rounded-md py-3 px-3 mt-8 cursor-pointer hover:scale-105 transition-all flex w-fit items-center lg:mx-0 mx-auto">
          <ChevronLeft color="#DDE404" size={18} />
          <span className="sequel-45 text-white text-sm uppercase ml-1 sm:pb-[3.5px] sm:pt-0 pt-1">
            Back
          </span>
        </Link>
      </div>
    </div>
  );
};

export default EntriesTickets;
