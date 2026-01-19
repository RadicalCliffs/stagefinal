import { Link } from "react-router";
import Countdown from "../../Countdown";
import { monkeyNftV3 } from "../../../assets/images";
import { ChevronRight, Clock, Zap } from "lucide-react";

interface EntriesCardProps {
  variant?: "compact" | "detailed";
  showButton?: boolean;
  showCountDown?: boolean;
  activeTab?: string;
  status?: "live" | "completed" | "drawn" | "pending";
  title?:string;
  description?:string
  isPromoCard?:boolean
  endDate?: string;
  competitionId?: string;
  // Rich entry data
  ticketNumbers?: string;
  amountSpent?: string;
  purchaseDate?: string;
  transactionHash?: string;
  competitionImage?: string;
  prizeValue?: string;
  numberOfTickets?: number;
  isWinner?: boolean;
  // Pending reservation props
  isPending?: boolean;
  expiresAt?: string;
  // Instant win props
  isInstantWin?: boolean;
}

const EntriesCard = ({
  variant = "compact",
  showButton = true,
  showCountDown = true,
  activeTab = "live",
  status = "live",
  title = 'Competition',
  description = "Enter our competition for a chance to win amazing prizes!",
  isPromoCard = false,
  endDate,
  competitionId,
  // Rich entry data
  ticketNumbers,
  amountSpent,
  purchaseDate,
  transactionHash: _transactionHash,
  competitionImage,
  prizeValue: _prizeValue,
  numberOfTickets,
  isWinner = false,
  // Pending reservation props
  isPending = false,
  expiresAt,
  // Instant win props
  isInstantWin = false
}: EntriesCardProps) => {
  const isDetailed = variant === "detailed";
  // 'completed' and 'drawn' both indicate finished competitions
  const isFinished = activeTab === "finished" || status === "drawn" || status === "completed";

  // Colors: pending = amber, finished winner = yellow, finished loss = pink, live = yellow
  const borderColor = isPending
    ? "border-amber-500"
    : isFinished
      ? isWinner
        ? "border-[#DDE404]"
        : "border-[#EF008F]"
      : "border-[#DDE404]";

  const background = isPending
    ? "bg-amber-500"
    : isFinished
      ? isWinner
        ? "bg-[#DDE404]"
        : "bg-[#EF008F]"
      : "bg-[#DDE404]";

  const showBanner = (isFinished || isPending) && variant === "compact";

  // Format expiration time for pending reservations
  const formatExpirationTime = (expiresAtStr: string | undefined) => {
    if (!expiresAtStr) return null;
    const expiresDate = new Date(expiresAtStr);
    const now = new Date();
    const diffMs = expiresDate.getTime() - now.getTime();

    if (diffMs <= 0) return 'Expired';

    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMinutes / 60);
    const remainingMinutes = diffMinutes % 60;

    if (diffHours > 0) {
      return `${diffHours}h ${remainingMinutes}m`;
    }
    return `${diffMinutes}m`;
  };

  return (
    <div className={`border relative ${borderColor} py-4 sm:py-5 px-3 sm:px-4 rounded-md bg-[#1A1A1A]`}>
      <div
        className={`flex ${
          isDetailed
            ? "lg:flex-row flex-col gap-8"
            : "flex-row items-start sm:items-center gap-3 sm:gap-4"
        }`}
      >
        {/* Winner/Loss/Pending Banner */}
        {showBanner && (
          <span
            className={`${background} absolute right-0 top-0 w-fit text-center uppercase text-black rounded-bl-sm text-[10px] sm:text-xs sequel-95 py-1.5 sm:py-2 px-2 sm:px-3`}
          >
            {isPending ? "Pending" : isWinner ? "Winner!" : "Loss"}
          </span>
        )}

        {/* Instant Win Badge */}
        {isInstantWin && !showBanner && (
          <span
            className="absolute right-0 top-0 w-fit text-center uppercase bg-[#DDE404] text-black rounded-bl-sm text-[10px] sm:text-xs sequel-95 py-1.5 sm:py-2 px-2 sm:px-3 flex items-center gap-1"
          >
            <Zap size={12} className="inline" />
            Instant
          </span>
        )}

        {/* Image */}
        <div className={`${isDetailed ? "w-full" : "w-16 h-16 sm:w-24 sm:h-24 md:w-32 md:h-24 flex-shrink-0 overflow-hidden rounded-sm"}`}>
          <img
            src={competitionImage || monkeyNftV3}
            alt={title || "competition"}
            className={`${isDetailed ? "lg:rounded-sm rounded-2xl" : "w-full h-full object-cover"}`}
          />
        </div>

        {/* Text Content */}
        <div
          className={`text-white ${
            isDetailed ? "w-full lg:text-left text-center" : "flex-1 min-w-0"
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0 pr-2">
              <h2
                className={`sequel-95 uppercase ${
                  isDetailed ? "sm:text-4xl text-3xl" : "text-sm sm:text-base md:text-lg lg:text-xl line-clamp-1"
                }`}
              >
                {title}
              </h2>
              <div
                className={`bg-[#EF008F] mt-2 ${
                  isDetailed ? "lg:w-6/12 h-[4px]" : "w-full max-w-[80px] sm:max-w-[120px] h-[2px] sm:h-[3px]"
                }`}
              ></div>
              <p
                className={`sequel-45 mt-2 text-white/80 leading-relaxed ${
                  isDetailed ? "" : "text-[10px] sm:text-xs line-clamp-2"
                }`}
              >
                {description}
              </p>

              {/* Rich Entry Data - Only show for compact variant */}
              {!isDetailed && (ticketNumbers || amountSpent || purchaseDate || isPending || isInstantWin) && (
                <div className="mt-3 space-y-1.5">
                  {/* Instant Win Indicator */}
                  {isInstantWin && (
                    <div className="flex items-center text-[#DDE404] mb-2">
                      <Zap className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                      <span className="text-[10px] sm:text-xs font-medium sequel-45">
                        Instant Win Competition
                      </span>
                    </div>
                  )}

                  {/* Expiration Time - Only for pending reservations */}
                  {isPending && expiresAt && (
                    <div className="flex items-center text-amber-500 mb-2">
                      <Clock className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                      <span className="text-[10px] sm:text-xs font-medium sequel-45">
                        Expires in {formatExpirationTime(expiresAt)}
                      </span>
                    </div>
                  )}

                  {/* Ticket Count and Numbers */}
                  {numberOfTickets !== undefined && numberOfTickets > 0 && (
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-[#DDE404] sequel-45 text-[10px] sm:text-xs whitespace-nowrap">Tickets:</span>
                      <span className="text-white sequel-45 text-[10px] sm:text-xs">{numberOfTickets}</span>
                      {ticketNumbers && (
                        <span className="text-white/60 sequel-45 text-[10px] sm:text-xs">
                          ({ticketNumbers.split(',').map(t => parseInt(t.trim(), 10)).filter(n => !isNaN(n)).sort((a, b) => a - b).slice(0, 3).join(', ')}
                          {ticketNumbers.split(',').length > 3 && '...'})
                        </span>
                      )}
                    </div>
                  )}

                  {/* Amount Spent - hide for pending */}
                  {amountSpent && !isPending && (
                    <div className="flex items-center gap-x-2">
                      <span className="text-[#DDE404] sequel-45 text-[10px] sm:text-xs whitespace-nowrap">Spent:</span>
                      <span className="text-white sequel-45 text-[10px] sm:text-xs">${amountSpent}</span>
                    </div>
                  )}

                  {/* Purchase Date - show as "Reserved" for pending */}
                  {purchaseDate && (
                    <div className="flex items-center gap-x-2">
                      <span className="text-[#DDE404] sequel-45 text-[10px] sm:text-xs whitespace-nowrap">{isPending ? 'Reserved:' : 'Date:'}</span>
                      <span className="text-white sequel-45 text-[10px] sm:text-xs">
                        {new Date(purchaseDate).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric'
                        })}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Chevron (only compact) */}
            {!isDetailed && (
              <div
                className={`flex-shrink-0 ${background} w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center rounded-md`}
              >
                <ChevronRight color="#393939" size={14} className="sm:w-[18px] sm:h-[18px]" />
              </div>
            )}
          </div>

          {/* Countdown - only show for live competitions (not pending or finished) */}
          {showCountDown && !isFinished && !isPending && (
            <div className="mt-6">
              <p className="sequel-95 uppercase text-white text-xl mb-3 tracking-widest">
                Time Remaining!
              </p>
              <div className="lg:block flex justify-center">
                <Countdown endDate={endDate} />
              </div>
            </div>
          )}

          {/* Ended status - show for finished competitions */}
          {showCountDown && isFinished && !isPending && (
            <div className="mt-6">
              <p className="sequel-95 uppercase text-white text-xl mb-3 tracking-widest">
                ENDED
              </p>
            </div>
          )}

          {/* Awaiting Payment status - show for pending reservations */}
          {showCountDown && isPending && (
            <div className="mt-6">
              <p className="sequel-95 uppercase text-amber-500 text-xl mb-3 tracking-widest">
                AWAITING PAYMENT
              </p>
            </div>
          )}

          {/* Button */}
          {showButton && (
            <Link
              to={competitionId ? `/competitions/${competitionId}` : "/competitions"}
              className="uppercase sequel-75 block text-center text-lg bg-[#DDE404] text-[#000000] w-full rounded-lg py-3 mt-8"
            >
              View Competition
            </Link>
          )}
        </div>
      </div>
      {
        isPromoCard && <div className="mt-7 flex flex-col sm:flex-row justify-between gap-3 sm:gap-4">
        <input className="bg-white/25 text-black sm:text-base text-sm w-full rounded-md sequel-45 px-3 sm:pl-4 py-2.5 sm:py-3 placeholder:text-white/70" placeholder="Enter Promotional Code..."/>
        <button className="sequel-95 bg-[#DDE404] sm:text-base text-sm cursor-pointer text-[#000] uppercase px-4 py-2.5 sm:py-3 rounded-md flex-shrink-0">Enter</button>
      </div>
      }

    </div>
  );
};

export default EntriesCard;
