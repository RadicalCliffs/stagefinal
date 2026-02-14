import { ChevronLeft } from 'lucide-react';
import { Link } from 'react-router';

interface EntriesTicketsProps {
  ticketNumbers?: string;
  numberOfTickets?: number;
  amountSpent?: string;
  purchaseDate?: string;
  transactionHash?: string;
}

const EntriesTickets = ({ ticketNumbers, numberOfTickets, amountSpent, purchaseDate, transactionHash }: EntriesTicketsProps) => {
  // Parse ticket numbers from comma-separated string and sort numerically
  const tickets = ticketNumbers
    ? ticketNumbers.split(',').map(t => t.trim()).filter(t => t).sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    : [];
  
  // Format ticket numbers as comma-separated string for display
  const ticketNumbersFormatted = tickets.join(', ');

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
          {tickets.map((ticket, i) => (
            <div
              key={i}
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
