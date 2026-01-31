import { Clock } from "lucide-react";
import type { CompetitionCardProps } from "../models/models";
import CompetitionCountdown from "./CompetitionCountdown";
import { bitcoinV2, nft, instantWinBannerNew } from "../assets/images";
import { Link, useNavigate } from "react-router";
import { useState } from "react";
import { ProvablyFairBadge } from "./ProvablyFairBadge";

const LiveCompetitionCard: React.FC<CompetitionCardProps> = ({
  image,
  title,
  price,
  timeRemaining,
  entriesSold,
  ticketsSold,
  totalTickets,
  progressPercent = 10,
  onEnter,
  isCompetitionFinished = false,
  isSoldOut = false,
  className = "",
  endDate,
  id,
  isLastChanceCompetition,
  isInstantWin = false,
  onchainCompetitionId,
}) => {
  const [imgError, setImgError] = useState(false);
  const navigate = useNavigate();
  // A sold out competition should also be treated as finished
  const effectivelyFinished = isCompetitionFinished || isSoldOut;

  // Handle card click - navigate to competition page
  const handleCardClick = (e: React.MouseEvent) => {
    // Don't navigate if clicking on the Enter Now button (it has its own handler)
    const target = e.target as HTMLElement;
    if (target.closest('a') || target.closest('button')) {
      return;
    }
    if (id) {
      navigate(`/competitions/${id}`);
    }
  };
  const ActiveCompetition = ({
    price,
    entriesSold,
    ticketsSold,
    totalTickets,
    progressPercent,
    onEnter,
  }: Pick<
    CompetitionCardProps,
    "price" | "onEnter" | "progressPercent" | "entriesSold" | "ticketsSold" | "totalTickets"
  >) => (
    <div>
      <p className="sequel-45 md:text-xs text-[11px] uppercase text-center text-white font-semibold md:mb-3 mb-2">
        {ticketsSold !== undefined && ticketsSold >= 0 && totalTickets !== undefined && totalTickets > 0
          ? `${ticketsSold} / ${totalTickets} Tickets Sold`
          : `${entriesSold}% Entries Sold`}
      </p>

      {/* Progress bar - fills from left to right as entries are sold */}
      <div className="progress overflow-hidden rounded-full md:h-[10px] h-[8px] w-11/12 mx-auto mb-4 bg-[#1A1A1A]">
        <div
          style={{ width: `${Math.max(progressPercent ?? 10, 10)}%` }}
          className="progress-bar progress-bar-success progress-bar-striped active h-full"
        ></div>
      </div>

      <div className="md:relative flex md:flex-row flex-col bg-[#161616] items-center md:rounded-xl rounded-md md:justify-start justify-between overflow-visible">
        <p className="text-[#dde404] md:pl-4 md:pt-2 md:pb-2.5 pt-2.5 pb-2 sequel-75 text-lg md:min-w-5/12 max-w-5/12">
          ${price}
        </p>
        <Link
          to={`/competitions/${id}`}
          onClick={onEnter}
          className="bg-[#DDE404] block border border-white text-center hover:bg-[#DDE404] sm:hover:scale-105 cursor-pointer sequel-95 md:pt-3 md:pb-3 custom-box-shadow pt-2.5 pb-2 uppercase md:text-sm text-[0.88rem] px-2 md:rounded-xl rounded-md w-full max-[400px]:text-[0.75rem]"
        >
          Enter Now
        </Link>
      </div>
    </div>
  );

  const FinishedCompetition = ({
    onEnter,
    isSoldOut,
  }: Pick<CompetitionCardProps, "onEnter"> & { isSoldOut?: boolean }) => (
    <div className="md:mt-3 mt-0">
      <button
        className={`sequel-95 text-white uppercase md:pt-[13px] md:pb-3.5 pt-2.5 pb-2 md:text-xl text-xs md:rounded-xl rounded-md w-full ${
          isSoldOut
            ? 'bg-gradient-to-r from-red-600 via-white via-red-600 to-white bg-[length:20px_100%] animate-pulse'
            : 'bg-[#161616] opacity-60'
        }`}
        style={isSoldOut ? {
          background: 'repeating-linear-gradient(45deg, #dc2626, #dc2626 10px, #ffffff 10px, #ffffff 20px)',
          color: '#dc2626',
          fontWeight: 'bold',
          textShadow: '1px 1px 0 #fff, -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff'
        } : undefined}
      >
        {isSoldOut ? 'SOLD OUT' : 'Finished'}
      </button>
      <button
        onClick={onEnter}
        className="sequel-75 md:mt-2 mt-1 cursor-pointer sm:hover:scale-105 transition-all bg-white text-[#030303] sm:uppercase capitalize md:pt-2 md:pb-2.5 pt-2.5 pb-2 md:rounded-xl rounded-md w-full md:text-xs text-xs flex items-center justify-center"
      >
        Click for details
      </button>
    </div>
  );

  return (
    <div
      onClick={handleCardClick}
      className={`md:rounded-3xl rounded-2xl border-[3px] border-white w-full bg-[#343434] pb-3 relative flex flex-col h-full cursor-pointer hover:border-[#DDE404] transition-colors ${className}`}
    >
      {/* Timer Badge */}
      <div
        className={`flex left-1/2 -translate-x-1/2 justify-center items-center md:-top-[15px] -top-[14px] gap-3 md:w-11/12 w-[95%] absolute z-10 rounded-3xl ${
          isSoldOut ? "bg-[#EF008F]" : isCompetitionFinished ? "bg-[#EF008F]" : isLastChanceCompetition ? "bg-[#DDE404]" : "bg-[#FFFFFF]"
        }`}
      >
        {isSoldOut ? (
          <span className="text-white sm:pt-1 sm:pb-1.5 pt-1.5 pb-1 uppercase sequel-95 md:text-sm text-xs text-center px-2">
            Sold Out
          </span>
        ) : isCompetitionFinished ? (
          <span className="text-[#1A1A1A] sm:pt-1 sm:pb-1.5 pt-1.5 pb-1  uppercase sequel-95 md:text-sm text-xs text-center px-2">
            {/* <span className="sm:block hidden">Competition</span> */}
            Finished
          </span>
        ) : (
          <>
            <Clock color={isLastChanceCompetition ? '#000' : '#FF3500'} className="md:block hidden" size={20} />
            {endDate ? (
              <CompetitionCountdown endDate={endDate} format="badge" />
            ) : (
              <span className="sequel-75 md:text-sm text-xs sm:pt-[0.2rem] sm:pb-1.5 pt-1.5 pb-1 ">
                {timeRemaining}
              </span>
            )}
            <Clock color={isLastChanceCompetition ? '#000' : '#FF3500'} className="md:block hidden" size={20} />
          </>
        )}
      </div>

      {/* NFT Image */}
      <div className="w-full aspect-[1/0.65] overflow-hidden relative">
        <img
          src={imgError ? bitcoinV2 : (image || bitcoinV2)}
          alt={title}
          className="w-full h-full object-cover md:rounded-[1.4rem] rounded-xl"
          onError={() => setImgError(true)}
        />
        {/* Provably Fair Badge - shown for VRF-enabled competitions */}
        {onchainCompetitionId && (
          <div className="absolute top-2 right-2 z-10">
            <ProvablyFairBadge onchainCompetitionId={onchainCompetitionId} size="sm" />
          </div>
        )}
        {/* Instant Win Banner */}
        {isInstantWin && !isCompetitionFinished && (
          <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center px-2">
            <img
              src={instantWinBannerNew}
              alt="Instant Win"
              className="w-11/12 object-contain rounded-t-lg"
            />
          </div>
        )}
      </div>

      {/* Card Content */}
      <div className=" md:px-4 px-2 rounded-2xl flex-1 flex flex-col min-h-0 mt-3">
        <h1 className="text-[#231717] md:rounded-xl rounded-md md:px-4 px-3 md:py-2 py-3 md:text-sm text-xs uppercase bg-white sequel-95 text-center flex items-center justify-center h-[70px] leading-tight">
          {title}
        </h1>

        <div className="flex-1 flex flex-col justify-end md:mt-4 mt-3">
          {effectivelyFinished ? (
            <FinishedCompetition onEnter={onEnter} isSoldOut={isSoldOut} />
          ) : (
            <ActiveCompetition
              price={price}
              entriesSold={entriesSold}
              ticketsSold={ticketsSold}
              totalTickets={totalTickets}
              progressPercent={progressPercent}
              onEnter={onEnter}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default LiveCompetitionCard;
