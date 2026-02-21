import { ChevronLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { Link } from 'react-router';
import { useState } from 'react';
import type { PurchaseGroup } from '../../../lib/purchase-dashboard';

interface EntryData {
  id: string;
  purchase_date?: string | null;
  amount_spent?: string | number | null;
  ticket_numbers?: string | null;
  number_of_tickets?: number | null;
  transaction_hash?: string | null;
}

interface PurchaseGroupEvent {
  source_table: 'tickets' | 'joincompetition';
  source_row_id: string;
  amount: number;
  occurred_at: string;
  purchase_key: string | null;
}

interface EntriesTicketsProps {
  ticketNumbers?: string;
  numberOfTickets?: number;
  amountSpent?: string;
  purchaseDate?: string;
  transactionHash?: string;
  individualEntries?: EntryData[];
  purchaseGroups?: Array<PurchaseGroup & { competition_title: string | null }>;
}

const EntriesTickets = ({
  ticketNumbers,
  numberOfTickets,
  amountSpent,
  purchaseDate,
  transactionHash,
  individualEntries,
  purchaseGroups
}: EntriesTicketsProps) => {
  const [showAllTickets, setShowAllTickets] = useState(false);
  const [expandedTransactions, setExpandedTransactions] = useState<Set<string>>(new Set());
  const [showAllTransactionTickets, setShowAllTransactionTickets] = useState(false);

  // Parse ticket numbers from comma-separated string
  const tickets = ticketNumbers
    ? ticketNumbers.split(',').map(t => t.trim()).filter(t => t)
    : [];

  // Format a date as M/D/YY
  const formatDateShort = (dateStr: string | null | undefined): string => {
    if (!dateStr) return 'Unknown date';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: '2-digit',
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

  // Determine how many tickets to show in the full grid (collapse if many)
  const MAX_TICKETS_VISIBLE = 20;
  const visibleTickets = showAllTickets ? tickets : tickets.slice(0, MAX_TICKETS_VISIBLE);
  const hasMoreTickets = tickets.length > MAX_TICKETS_VISIBLE;
  const MAX_TRANSACTION_TICKETS_VISIBLE = 50;

  const toggleTransactionTickets = (transactionId: string) => {
    setExpandedTransactions(prev => {
      const next = new Set(prev);
      if (next.has(transactionId)) {
        next.delete(transactionId);
      } else {
        next.add(transactionId);
      }
      return next;
    });
  };

  // Sort individual entries by purchase date (most recent first) for the breakdown
  // FILTER OUT invalid entries with no ticket numbers
  const sortedEntries = individualEntries
    ? [...individualEntries]
        .filter(entry => {
          // Must have valid ticket_numbers
          const tickets = entry.ticket_numbers;
          if (!tickets || tickets.trim() === '' || tickets === '0') return false;
          // Parse and verify at least one valid ticket number > 0
          const ticketArray = tickets.split(',').map(t => parseInt(t.trim())).filter(t => !isNaN(t) && t > 0);
          return ticketArray.length > 0;
        })
        .sort(
          (a, b) =>
            new Date(b.purchase_date || 0).getTime() -
            new Date(a.purchase_date || 0).getTime()
        )
    : [];

  // Use purchase groups if available, otherwise fall back to individual entries
  const displayGroups = purchaseGroups && purchaseGroups.length > 0
    ? purchaseGroups
    : null;

  // Format date and time for purchase groups
  const formatDateTime = (dateStr: string | null | undefined): string => {
    if (!dateStr) return 'Unknown';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div>
      {/* All Ticket Numbers Grid */}
      <div className="bg-[#DDE404] h-0.5 w-full mt-8"></div>
      <div className="mt-7">
        <div className="flex items-center justify-between mb-5">
          <p className="sequel-45 text-white/60">Ticket Number(s)</p>
          <span className="sequel-45 text-[#DDE404] text-sm">
            {numberOfTickets || tickets.length} {(numberOfTickets || tickets.length) === 1 ? 'ticket' : 'tickets'}
          </span>
        </div>

        <div className="grid xl:grid-cols-10 lg:grid-cols-7 md:grid-cols-5 grid-cols-3 gap-x-2 gap-y-4">
          {visibleTickets.map((ticket) => (
            <div
              key={ticket}
              className="bg-[#393939] sm:text-sm text-xs text-white text-center sequel-45 rounded-sm py-3 px-2 w-full"
            >
              <span>{ticket}</span>
            </div>
          ))}
        </div>

        {hasMoreTickets && (
          <button
            onClick={() => setShowAllTickets(!showAllTickets)}
            className="mt-4 w-full bg-[#1a1a1a] text-[#DDE404] sequel-45 text-sm py-3 rounded-lg hover:bg-[#252525] transition-colors flex items-center justify-center gap-2"
          >
            {showAllTickets ? (
              <>
                <ChevronUp size={16} />
                <span>Show less</span>
              </>
            ) : (
              <>
                <ChevronDown size={16} />
                <span>Show all {tickets.length} tickets</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Purchase Breakdown Section - shows grouped purchases or individual entries */}
      <div className="bg-[#DDE404] h-0.5 w-full mt-8"></div>
      <div className="mt-7">
        <div className="flex items-center justify-between mb-5">
          <p className="sequel-45 text-white/60">Purchase Breakdown</p>
          {displayGroups ? (
            <span className="sequel-45 text-[#DDE404] text-sm">
              {displayGroups.length} {displayGroups.length === 1 ? 'session' : 'sessions'}
            </span>
          ) : sortedEntries.length > 0 ? (
            <span className="sequel-45 text-[#DDE404] text-sm">
              {sortedEntries.length} {sortedEntries.length === 1 ? 'purchase' : 'purchases'}
            </span>
          ) : null}
        </div>

        {displayGroups ? (
          /* Show purchase groups - each group represents a purchase session (5-min window) */
          <div className="space-y-4">
            {displayGroups.map((group, groupIndex) => {
              const groupId = `group-${group.purchase_group_number}`;
              const isExpanded = expandedTransactions.has(groupId);

              return (
                <div
                  key={groupId}
                  className="bg-[#1a1a1a] rounded-lg p-4 border border-[#2a2a2a]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-[#DDE404] sequel-45 text-sm">
                        {formatDateTime(group.group_start_at)}
                        {group.group_start_at !== group.group_end_at && (
                          <> — {formatDateTime(group.group_end_at)}</>
                        )}
                      </span>
                      <span className="text-white/50 sequel-45 text-xs">
                        Session #{group.purchase_group_number}
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="text-[#DDE404] sequel-45 text-sm">
                        ${group.total_amount.toFixed(2)}
                      </div>
                      <span className="text-white/50 sequel-45 text-xs">
                        {group.events_in_group} {group.events_in_group === 1 ? 'transaction' : 'transactions'}
                      </span>
                    </div>
                  </div>

                  {/* Show individual events in this group */}
                  {group.events && group.events.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-[#2a2a2a]">
                      <button
                        onClick={() => toggleTransactionTickets(groupId)}
                        className="w-full text-left flex items-center justify-between text-white/70 sequel-45 text-xs hover:text-[#DDE404] transition-colors"
                      >
                        <span>
                          {isExpanded ? 'Hide' : 'Show'} transaction details
                        </span>
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                      
                      {isExpanded && (
                        <div className="mt-3 space-y-2">
                          {group.events.map((event: PurchaseGroupEvent, eventIndex: number) => (
                            <div
                              key={`${groupId}-event-${eventIndex}`}
                              className="bg-[#252525] rounded p-3 text-xs"
                            >
                              <div className="flex justify-between items-center">
                                <span className="text-white/70 sequel-45">
                                  {event.source_table === 'tickets' ? '🎟️ Ticket' : '🎫 Entry'}
                                </span>
                                <span className="text-[#DDE404] sequel-45">
                                  ${event.amount.toFixed(2)}
                                </span>
                              </div>
                              <div className="text-white/50 sequel-45 mt-1">
                                {formatDateTime(event.occurred_at)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : sortedEntries.length > 0 ? (
          /* Fallback to individual entries when purchase groups not available */
          <div className="space-y-3">
            {sortedEntries.map((entry, index) => {
              const transactionId = entry.id || `transaction-${index}`;
              const isExpanded = expandedTransactions.has(transactionId);
              const entryTickets = entry.ticket_numbers
                ? entry.ticket_numbers.split(',').map(t => t.trim()).filter(t => t)
                : [];
              const visibleEntryTickets = isExpanded ? entryTickets : entryTickets.slice(0, MAX_TRANSACTION_TICKETS_VISIBLE);
              const hasMoreEntryTickets = entryTickets.length > MAX_TRANSACTION_TICKETS_VISIBLE;
              const amountStr = typeof entry.amount_spent === 'number'
                ? `$${entry.amount_spent.toFixed(2)}`
                : entry.amount_spent ? `$${entry.amount_spent}` : null;

              return (
                <div
                  key={`${transactionId}-${index}`}
                  className="bg-[#1a1a1a] rounded-lg p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-3">
                      <span className="text-[#DDE404] sequel-45 text-sm">
                        {formatDateShort(entry.purchase_date)}
                      </span>
                      {amountStr && (
                        <span className="text-white/50 sequel-45 text-xs">
                          {amountStr}
                        </span>
                      )}
                    </div>
                    <span className="text-white/50 sequel-45 text-xs">
                      {entry.number_of_tickets || entryTickets.length} {(entry.number_of_tickets || entryTickets.length) === 1 ? 'ticket' : 'tickets'}
                    </span>
                  </div>
                  {entryTickets.length > 0 && (
                    <>
                      <p className="text-white sequel-45 text-sm leading-relaxed">
                        {visibleEntryTickets.join(', ')}
                      </p>
                      {hasMoreEntryTickets && (
                        <button
                          onClick={() => toggleTransactionTickets(transactionId)}
                          className="mt-3 w-full bg-[#1a1a1a] text-[#DDE404] sequel-45 text-sm py-2 rounded-lg hover:bg-[#252525] transition-colors flex items-center justify-center gap-2 border border-[#2a2a2a]"
                        >
                          {isExpanded ? (
                            <>
                              <ChevronUp size={16} />
                              <span>Show less</span>
                            </>
                          ) : (
                            <>
                              <ChevronDown size={16} />
                              <span>See more</span>
                            </>
                          )}
                        </button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* Fallback when no individual entry data: show single purchase info */
          <div className="bg-[#1a1a1a] rounded-lg p-4">
            <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-3">
                <span className="text-[#DDE404] sequel-45 text-sm">
                  {purchaseDate ? formatDateShort(purchaseDate) : 'Unknown date'}
                </span>
                {amountSpent && (
                  <span className="text-white/50 sequel-45 text-xs">
                    ${amountSpent}
                  </span>
                )}
              </div>
              <span className="text-white/50 sequel-45 text-xs">
                {numberOfTickets || tickets.length} {(numberOfTickets || tickets.length) === 1 ? 'ticket' : 'tickets'}
              </span>
            </div>
            <p className="text-white sequel-45 text-sm leading-relaxed">
              {(showAllTransactionTickets ? tickets : tickets.slice(0, MAX_TRANSACTION_TICKETS_VISIBLE)).join(', ')}
            </p>
            {tickets.length > MAX_TRANSACTION_TICKETS_VISIBLE && (
              <button
                onClick={() => setShowAllTransactionTickets(!showAllTransactionTickets)}
                className="mt-3 w-full bg-[#1a1a1a] text-[#DDE404] sequel-45 text-sm py-2 rounded-lg hover:bg-[#252525] transition-colors flex items-center justify-center gap-2 border border-[#2a2a2a]"
              >
                {showAllTransactionTickets ? (
                  <>
                    <ChevronUp size={16} />
                    <span>Show less</span>
                  </>
                ) : (
                  <>
                    <ChevronDown size={16} />
                    <span>See more</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Transaction link if available */}
      {transactionHash && transactionHash !== 'no-hash' && (
        <>
          <div className="bg-[#DDE404] h-0.5 w-full mt-8"></div>
          <div className="mt-7">
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
  );
};

export default EntriesTickets;
