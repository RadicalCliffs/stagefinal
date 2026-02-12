import { useState, useEffect, lazy, Suspense } from "react";
import ReactRangeSliderInput from "react-range-slider-input";
import { heroSectionImage, individualLogoToken} from "../../assets/images";
import Countdown from "../Countdown";
import "react-range-slider-input/dist/style.css";
import { MinusIcon, PlusIcon } from "lucide-react";
import IndividualCompetitionHeroCardsInfo from "./IndividualCompetitionHeroCardsInfo";
import TrustPilotReviewSection from "../TrustPilotReviewSection";
import CaptchaModal from "../CaptchaModal";
import UserInfoModal from "../UserInfoModal";
import type { UserInfo } from "../UserInfoModal";
import type {CompetitionWrapper } from "../../models/models";
import { supabase } from "../../lib/supabase";
import { useAuthUser } from "../../contexts/AuthContext";
import { ticketReservationLogger, requestTracker, showDebugHintOnError } from "../../lib/debug-console";
import { canEnterCompetition } from "../CompetitionStatusIndicator";

// Lazy load PaymentModal - only loaded when user initiates payment
const PaymentModal = lazy(() => import("../PaymentModal"));

const IndividualCompetitionHeroSection = ({competition, onEntriesRefresh}: {competition: CompetitionWrapper['competition'], onEntriesRefresh?: () => void}) => {
  const { baseUser } = useAuthUser();

  // Default to 1 ticket for better UX (users can adjust as needed)
  const INITIAL_TICKET_COUNT = 1;
  const [ticketCount, setTicketCount] = useState(INITIAL_TICKET_COUNT);
  const [showCaptchaModal, setShowCaptchaModal] = useState(false);
  const [showUserInfoModal, setShowUserInfoModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [userInfo, setUserInfo] = useState<UserInfo | undefined>();
  // Lucky dip reservation state
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [reservedTickets, setReservedTickets] = useState<number[]>([]);
  const [reserving, setReserving] = useState(false);
  const [reservationError, setReservationError] = useState<string | null>(null);

  // USE COMPETITION DATA DIRECTLY (same as main page)
  // The main page shows correct count using competition.tickets_sold
  const soldCount = competition?.tickets_sold || 0;
  const totalTickets = competition?.total_tickets || 0;
  const availableCount = Math.max(0, totalTickets - soldCount);
  
  // No more complex RPC calls - use competition data directly like main page
  const isSoldOut = totalTickets > 0 && soldCount >= totalTickets;

  // Set up real-time subscription for competition status
  useEffect(() => {
    if (competition?.id) {
      // Real-time subscription for competition status changes (e.g., when drawn)
      const statusChannel = supabase
        .channel(`competition-status-hero-${competition.id}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'competitions',
            filter: `id=eq.${competition.id}`
          },
          (payload: any) => {
            const newStatus = payload.new?.status;
            console.log('Competition status changed to:', newStatus);
            // Reload page when competition is drawn or completed to show winner
            if (newStatus === 'drawn' || newStatus === 'completed' || newStatus === 'drawing') {
              window.location.reload();
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(statusChannel);
      };
    }
  }, [competition?.id]);

  const handleIncrement = () => {
    // Limit to available tickets and 999 per transaction
    const maxAllowed = Math.min(availableCount, 999);
    if (ticketCount < maxAllowed) {
      setTicketCount(ticketCount + 1);
    }
  };

  const handleDecrement = () => {
    // Allow going down to 0 (validation happens on "Enter Now")
    if (ticketCount > 0) {
      setTicketCount(ticketCount - 1);
    }
  };

  const handleEnterNow = () => {
    // Safety check: don't allow entry for non-active competitions
    if (!canEnterCompetition(competition.status)) {
      console.warn('Entry blocked: Competition status is not active:', competition.status);
      return;
    }
    // Ensure at least 1 ticket is selected
    if (ticketCount === 0) {
      alert("Please select at least 1 ticket to enter.");
      return;
    }
    setShowCaptchaModal(true);
  };

  const handleSliderChange = (values: number[]) => {
    const newCount = values[1];
    setTicketCount(newCount);
    // Clear previous reservation when ticket count changes
    if (newCount !== ticketCount) {
      setReservationId(null);
      setReservedTickets([]);
      setReservationError(null);
    }
  };

  // Reserve random tickets for lucky dip before payment
  // This uses server-side allocation via lucky-dip-reserve edge function
  const reserveLuckyDipTickets = async (): Promise<boolean> => {
    if (!baseUser?.id || !competition?.id || ticketCount <= 0) {
      ticketReservationLogger.warn('Pre-validation failed', {
        hasUser: !!baseUser?.id,
        hasCompetition: !!competition?.id,
        ticketCount
      });
      setReservationError("Please login and select tickets first");
      return false;
    }

    setReserving(true);
    setReservationError(null);

    const reservationStartTime = Date.now();

    ticketReservationLogger.group(`Lucky Dip Reservation - ${ticketCount} tickets`);
    ticketReservationLogger.info('Starting server-side Lucky Dip reservation', {
      userId: baseUser.id.substring(0, 10) + '...',
      competitionId: competition.id.substring(0, 8) + '...',
      ticketCount,
      totalTickets: competition.total_tickets
    });

    try {
      ticketReservationLogger.info('Invoking lucky-dip-reserve edge function', {
        ticketCount
      });

      const edgeFunctionStartTime = Date.now();
      
      const { data, error } = await supabase.functions.invoke('lucky-dip-reserve', {
        body: {
          userId: baseUser.id,
          competitionId: competition.id,
          count: ticketCount,
          ticketPrice: Number(competition.ticket_price) || 1,
          holdMinutes: 15
        }
      });

      const edgeFunctionDuration = Date.now() - edgeFunctionStartTime;

      if (error) {
        ticketReservationLogger.edgeFunctionError('lucky-dip-reserve', error, 1, 1);
        showDebugHintOnError();

        requestTracker.addRequest({
          timestamp: Date.now(),
          endpoint: 'edge:lucky-dip-reserve',
          method: 'EDGE_FUNCTION',
          success: false,
          error: error.message || 'Reservation failed',
          errorCode: 'INVOKE_ERROR',
          duration: edgeFunctionDuration
        });

        setReservationError("Could not reserve tickets. Please try again.");
        setReserving(false);
        ticketReservationLogger.groupEnd();
        return false;
      }

      if (!data || data.success !== true) {
        const errorMsg = data?.error || "Failed to reserve tickets";
        ticketReservationLogger.warn('Application-level error', {
          error: errorMsg,
          response: data
        });

        requestTracker.addRequest({
          timestamp: Date.now(),
          endpoint: 'edge:lucky-dip-reserve',
          method: 'EDGE_FUNCTION',
          success: false,
          error: errorMsg,
          errorCode: data?.errorCode || 'APP_ERROR',
          duration: edgeFunctionDuration
        });

        setReservationError(errorMsg);
        setReserving(false);
        ticketReservationLogger.groupEnd();
        return false;
      }

      const reservedTicketNumbers = data.ticketNumbers || [];
      const ticketCountReserved = data.ticketCount || reservedTicketNumbers.length;

      ticketReservationLogger.success('Server-side Lucky Dip reservation successful', {
        ticketCountReserved,
        reservationId: data.reservationId || '(none)',
        algorithm: data.algorithm || 'server-side-atomic-random',
        totalDuration: Date.now() - reservationStartTime
      });

      requestTracker.addRequest({
        timestamp: Date.now(),
        endpoint: 'edge:lucky-dip-reserve',
        method: 'EDGE_FUNCTION',
        success: true,
        duration: edgeFunctionDuration
      });

      setReservationId(data.reservationId || null);
      setReservedTickets(reservedTicketNumbers);
      setReserving(false);
      ticketReservationLogger.groupEnd();
      return true;

    } catch (err) {
      ticketReservationLogger.error('Exception during Lucky Dip reservation', err);
      showDebugHintOnError();

      requestTracker.addRequest({
        timestamp: Date.now(),
        endpoint: 'edge:lucky-dip-reserve',
        method: 'EDGE_FUNCTION',
        success: false,
        error: err instanceof Error ? err.message : 'Unknown exception',
        errorCode: 'EXCEPTION',
        duration: Date.now() - reservationStartTime
      });

      setReservationError(err instanceof Error ? err.message : "Failed to reserve tickets");
      setReserving(false);
      ticketReservationLogger.groupEnd();
      return false;
    }
  };

  // Check if competition accepts entries (only active competitions)
  const isEntryAllowed = canEnterCompetition(competition.status);
  
  // Slider and buttons should be disabled only when tickets are unavailable
  const isSelectionDisabled = isSoldOut || availableCount === 0;

  // Debug logging
  console.log('[HeroSection] Ticket availability:', {
    soldCount,
    totalTickets,
    availableCount,
    isSoldOut,
    isEntryAllowed,
    competitionStatus: competition.status
  });

  const progressPercent = totalTickets > 0
    ? Math.max(10, Math.min(100, (soldCount / totalTickets) * 100))
    : 10;

  return (
    <div className="max-w-7xl mx-auto bg-[#1D1D1D] rounded-2xl px-3 py-4 ">
      <div className="flex xl:flex-row flex-col lg:gap-8 gap-4 relative overflow-hidden">
        <div className="bg-[#111111] rounded-2xl w-full relative">
          {/* Mobile countdown - on top of image */}
          <div className="xl:hidden absolute top-4 left-0 right-0 z-10">
            <div className="flex flex-col items-center justify-center">
              <Countdown endDate={competition.end_date || competition.draw_date || competition.created_at} isEnded={isSoldOut || !isEntryAllowed} />
            </div>
          </div>
          <img src={competition.image_url || heroSectionImage} alt="hero-section" className="xl:w-auto w-full" />
          {/* Desktop countdown - below image */}
          <div className="xl:flex hidden flex-col items-center justify-center mt-5 xl:pb-0 pb-8">
            <p className="sequel-95 uppercase text-white mb-4 sm:text-3xl text-2xl">
              Time Remaining!
            </p>
            <Countdown endDate={competition.end_date || competition.draw_date || competition.created_at} isEnded={isSoldOut || !isEntryAllowed} />
          </div>
        </div>
        <img
          src={individualLogoToken}
          alt="token-logo"
          className="absolute md:block hidden w-96 xl:-right-5 xl:-top-8 bottom-0 right-0"
        />

        <div className="w-full lg:mt-5">
          <h1 className="sequel-95 lg:text-4xl sm:text-3xl text-2xl sm:text-left text-center text-white">
            {competition.title}
          </h1>
          <p className="text-white sequel-45 text-sm sm:mt-4 mt-3 leading-loose sm:text-left text-center">
            {competition.description || 'Ape into this competition for an amazing prize!'}
          </p>
          <div className="bg-[#141414] rounded-xl p-4 mt-4 relative">
            <p className="sequel-75 uppercase text-white md:text-xl text-lg">
              {competition?.is_instant_win ? 'Lucky Dips (Random Selection)' : 'Ticket Selection'}
            </p>

            <div className="mt-3">
              <div className=" flex justify-between mb-3">
                <span className="sequel-45 text-white md:text-lg">0</span>
                <span className="sequel-45 text-white md:text-lg">{Math.min(availableCount, 999)}</span>
              </div>
              
              {/* Show clear message when slider is disabled */}
              {isSoldOut && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-3">
                  <p className="text-red-400 text-sm sequel-45 text-center">
                    Competition is sold out - no tickets available
                  </p>
                </div>
              )}
              {!isEntryAllowed && !isSoldOut && availableCount > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 mb-3">
                  <p className="text-amber-400 text-sm sequel-45 text-center">
                    ⚠️ Competition is not currently accepting entries (status: {competition.status})
                  </p>
                </div>
              )}
              {availableCount > 999 && (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-2 mb-3">
                  <p className="text-blue-400 text-sm sequel-45 text-center">
                    Maximum 999 tickets per purchase. You can make multiple purchases for more tickets.
                  </p>
                </div>
              )}
              
              <ReactRangeSliderInput
                className="single-thumb"
                value={[0, ticketCount]}
                onInput={handleSliderChange}
                min={0}
                max={Math.min(Math.max(availableCount, 1), 999)}
                step={1}
                thumbsDisabled={[true, false]}
                rangeSlideDisabled={false}
                disabled={isSelectionDisabled}
                id="individual-competition-range-slider"
              />
            </div>

            {/* Cost display */}
            <div className="mt-3 flex justify-between items-center">
              <div>
                <p className="sequel-45 text-white/60 text-sm">Total Cost:</p>
                <p className="sequel-75 text-white text-lg">
                  ${(ticketCount * (Number(competition?.ticket_price) || 1)).toFixed(2)}
                </p>
              </div>
            </div>
            <div className="mt-4 flex  justify-between items-center">
              <div className="flex items-center gap-3">
                <div 
                  onClick={isSelectionDisabled ? undefined : handleDecrement} 
                  className={`${isSelectionDisabled ? 'bg-[#494949] cursor-not-allowed' : 'bg-[#DDE404] cursor-pointer hover:bg-[#DDE404]/90'} w-9 h-9 flex justify-center items-center rounded-full`}
                >
                  <MinusIcon color={isSelectionDisabled ? "#888888" : "#000000"} />
                </div>
              </div>
              <div>
                <p className="uppercase sequel-75 text-white md:text-lg">
                  Lucky Dips:{" "}
                  <span className="sequel-75 text-[#DDE404]">{ticketCount}</span>
                </p>
              </div>
              <div className="flex items-center gap-3 ">
                <div 
                  onClick={isSelectionDisabled ? undefined : handleIncrement} 
                  className={`${isSelectionDisabled ? 'bg-[#494949] cursor-not-allowed' : 'bg-[#DDE404] cursor-pointer hover:bg-[#DDE404]/90'} w-9 h-9 flex justify-center items-center rounded-full`}
                >
                  <PlusIcon color={isSelectionDisabled ? "#888888" : "#000000"} />
                </div>
              </div>
            </div>
          </div>
          <div className="flex md:flex-row flex-col mt-3 gap-3 items-start relative">
            <div className="w-full">
              <p className="sequel-75 text-white text-center text-xs mb-2">
                {soldCount}/{totalTickets} tickets sold ({availableCount} left)
              </p>
              <div className="">
                <div className="progress overflow-hidden rounded-xl h-[30px] w-full z-10 relative">
                  <div
                    className="progress-bar progress-bar-success progress-bar-striped active"
                    style={{ width: `${progressPercent}%` }}
                  ></div>
                </div>
                <p className="text-white/60 md:block hidden  border border-[#4e4e4e] px-2 pt-4 pb-3 relative -top-3 z-[1] rounded-b-xl border-t-0 text-xs sequel-45 text-center">
                  Prize: {competition.prize_value || "1 BTC"}
                </p>
              </div>
            </div>
            <div className="w-full md:max-w-full max-w-sm mx-auto border border-white rounded-xl">
              {!isEntryAllowed ? (
                <>
                  <button
                    disabled
                    className="sequel-95 uppercase cursor-not-allowed text-base rounded-t-xl bg-[#494949] text-white/50 py-2 w-full"
                  >
                    Competition Ended
                  </button>
                  <p className="sequel-45 py-3 bg-[#1D1D1D] rounded-b-xl text-center text-white/60 text-xs uppercase">
                    This competition is no longer accepting entries
                  </p>
                </>
              ) : isSoldOut ? (
                <>
                  <button
                    disabled
                    className="sequel-95 uppercase cursor-not-allowed text-base rounded-t-xl bg-[#EF008F] text-white py-2 w-full"
                  >
                    Sold Out
                  </button>
                  <p className="sequel-45 py-3 bg-[#1D1D1D] rounded-b-xl text-center text-white/60 text-xs uppercase">
                    All tickets have been sold
                  </p>
                </>
              ) : (
                <>
                  <button
                    onClick={handleEnterNow}
                    disabled={ticketCount === 0}
                    className={`sequel-95 uppercase text-base rounded-t-xl py-2 w-full transition-all ${
                      ticketCount === 0
                        ? 'cursor-not-allowed bg-[#494949] text-white/50'
                        : 'cursor-pointer hover:bg-[#DDE404]/90 bg-[#DDE404]'
                    }`}
                  >
                    {ticketCount === 0 ? 'Select Tickets' : 'Enter Now'}
                  </button>
                  <a
                    href="/terms-and-conditions#3-11"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="sequel-45 py-3 bg-[#1D1D1D] rounded-b-xl underline text-center block text-white/60 text-xs uppercase hover:text-white/80 transition-colors"
                  >
                    Click for free entry details
                  </a>
                </>
              )}
            </div>
          </div>

          {/* Reservation status indicators */}
          {reserving && (
            <div className="mt-3 bg-blue-500/10 border border-blue-500/30 rounded-lg px-4 py-2">
              <p className="text-blue-400 text-xs sequel-45 text-center flex items-center justify-center gap-2">
                <span className="animate-spin">&#8987;</span> Reserving your tickets...
              </p>
            </div>
          )}
          {reservationError && !reserving && (
            <div className="mt-3 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2">
              <p className="text-red-400 text-xs sequel-45 text-center">
                {reservationError}
              </p>
            </div>
          )}
        </div>
      </div>
      <div className="mt-8 xl:px-8 md:px-4 px-0">
        <IndividualCompetitionHeroCardsInfo />
        <div className="mt-8">
          <TrustPilotReviewSection />
        </div>
      </div>

      <CaptchaModal
        isOpen={showCaptchaModal}
        onClose={() => setShowCaptchaModal(false)}
        onSuccess={async () => {
          setShowCaptchaModal(false);
          const success = await reserveLuckyDipTickets();
          if (success) {
            setShowUserInfoModal(true);
          }
        }}
      />

      <UserInfoModal
        isOpen={showUserInfoModal}
        onClose={() => setShowUserInfoModal(false)}
        ticketCount={ticketCount}
        totalAmount={ticketCount * (Number(competition?.ticket_price) || 1)}
        savedInfo={userInfo}
        onPayWithCrypto={(info) => {
          setUserInfo(info);
          setShowUserInfoModal(false);
          setShowPaymentModal(true);
        }}
        onPayWithCard={(info) => {
          setUserInfo(info);
          setShowUserInfoModal(false);
          setShowPaymentModal(true);
        }}
      />

      {showPaymentModal && (
        <Suspense fallback={null}>
          <PaymentModal
            isOpen={showPaymentModal}
            onOpen={() => setShowPaymentModal(true)}
            onClose={() => setShowPaymentModal(false)}
            ticketCount={ticketCount}
            competitionId={competition?.id}
            ticketPrice={Number(competition?.ticket_price) || 1}
            userInfo={userInfo}
            selectedTickets={reservedTickets}
            reservationId={reservationId}
            onPaymentSuccess={() => {
              setReservationId(null);
              setReservedTickets([]);
              setTicketCount(0);
              onEntriesRefresh?.();
            }}
            maxAvailableTickets={availableCount}
          />
        </Suspense>
      )}
    </div>
  );
};

export default IndividualCompetitionHeroSection;
