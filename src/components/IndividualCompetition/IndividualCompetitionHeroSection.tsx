import { useState, useEffect, useCallback, lazy, Suspense } from "react";
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
import { database } from "../../lib/database";
import { supabase } from "../../lib/supabase";
import { useAuthUser } from "../../contexts/AuthContext";
import { omnipotentData } from "../../lib/omnipotent-data-service";
import { ticketReservationLogger, requestTracker, showDebugHintOnError } from "../../lib/debug-console";
import { canEnterCompetition } from "../CompetitionStatusIndicator";
import { reserveTicketsWithRedundancy } from "../../lib/reserve-tickets-redundant";

// Lazy load PaymentModal - only loaded when user initiates payment
const PaymentModal = lazy(() => import("../PaymentModal"));

/**
 * Helper function to determine when to show the "Tickets temporarily unavailable" banner.
 * 
 * The banner should only show when tickets are genuinely unavailable to the user,
 * not just because an authoritative RPC failed while fallback data shows availability.
 * 
 * @param params.availableCount - The computed available count (uses fallback when authoritative fails)
 * @param params.isSoldOut - Whether the competition is sold out
 * @param params.availabilityError - Error from authoritative availability fetch
 * @param params.isAuthoritative - Whether availability data is from authoritative source
 * @returns true if the "temporarily unavailable" banner should be shown
 * 
 * @example
 * // Case 1: RPC succeeds with 0 available - SHOW banner
 * shouldShowUnavailableBanner({ availableCount: 0, isSoldOut: false, availabilityError: null, isAuthoritative: true })
 * // => true
 * 
 * @example
 * // Case 2: RPC fails but fallback shows 2000 available - DON'T show banner
 * shouldShowUnavailableBanner({ availableCount: 2000, isSoldOut: false, availabilityError: "HTTP 400", isAuthoritative: false })
 * // => false
 * 
 * @example
 * // Case 3: Competition sold out - DON'T show unavailable banner (sold out banner shows instead)
 * shouldShowUnavailableBanner({ availableCount: 0, isSoldOut: true, availabilityError: null, isAuthoritative: true })
 * // => false
 */
export function shouldShowUnavailableBanner(params: {
  availableCount: number;
  isSoldOut: boolean;
  availabilityError: string | null;
  isAuthoritative: boolean;
}): boolean {
  const { availableCount, isSoldOut, availabilityError, isAuthoritative } = params;
  
  // Never show unavailable banner if sold out (sold out banner takes precedence)
  if (isSoldOut) {
    return false;
  }
  
  // Show banner only when the COMPUTED availableCount is 0
  // This uses fallback when authoritative fails, so we only show the banner
  // when tickets are truly unavailable according to best available data
  return availableCount === 0 && availabilityError !== null;
}

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

  // CONSOLIDATED: Use omnipotentData as single source of truth for availability
  // Removed duplicate useAuthoritativeAvailability system
  const [availability, setAvailability] = useState({
    total_tickets: competition?.total_tickets || 0,
    sold_count: 0,
    pending_count: 0,
    available_count: competition?.total_tickets || 0,
    isAuthoritative: false,
  });
  const [availabilityLoading, setAvailabilityLoading] = useState(true);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);

  // Fetch availability using omnipotentData
  const refreshAvailability = useCallback(async () => {
    if (!competition?.id) return;
    
    setAvailabilityLoading(true);
    try {
      const unavailable = await omnipotentData.getUnavailableTickets(competition.id);
      const totalTickets = competition.total_tickets || 0;
      const availableCount = totalTickets - unavailable.length;
      
      setAvailability({
        total_tickets: totalTickets,
        sold_count: unavailable.length,
        pending_count: 0,
        available_count: availableCount,
        isAuthoritative: true,
      });
      setAvailabilityError(null);
    } catch (err) {
      console.error('[HeroSection] Failed to fetch availability:', err);
      setAvailabilityError(err instanceof Error ? err.message : 'Failed to fetch availability');
    } finally {
      setAvailabilityLoading(false);
    }
  }, [competition?.id, competition?.total_tickets]);

  // Initial fetch and periodic refresh
  useEffect(() => {
    refreshAvailability();
    
    // Refresh every 5 seconds to stay in sync
    const interval = setInterval(refreshAvailability, 5000);
    return () => clearInterval(interval);
  }, [refreshAvailability]);

  // Set up real-time subscription for competition status (availability is now handled by useAuthoritativeAvailability)
  useEffect(() => {
    if (competition?.id) {
      // Real-time subscription for competition status changes (e.g., when drawn)
      // Note: Ticket availability is now handled by useAuthoritativeAvailability hook
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
          (payload) => {
            const newStatus = (payload.new as any)?.status;
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

  // Cap ticket count if availability decreases (e.g., someone else bought tickets)
  useEffect(() => {
    if (availability.isAuthoritative && ticketCount > availability.available_count) {
      setTicketCount(Math.max(0, availability.available_count));
    }
  }, [availability, ticketCount]);

  const handleIncrement = () => {
    // Limit to available tickets - use fallback if not authoritative to prevent 0 max
    // Note: Fallback calculation is also used below in availableCount computation
    const fallbackMax = Math.max(0, (competition.total_tickets || 0) - (competition.tickets_sold || 0));
    const maxAllowed = availability.isAuthoritative 
      ? availability.available_count
      : fallbackMax;
    
    if (ticketCount < maxAllowed) {
      const newCount = ticketCount + 1;
      const adjustedCount = handleMinimumPurchaseCheck(newCount);
      setTicketCount(adjustedCount);
    }
  };

  const handleDecrement = () => {
    // Allow going down to 0 (validation happens on "Enter Now")
    if (ticketCount > 0) {
      const newCount = ticketCount - 1;
      setTicketCount(newCount);
    }
  };

  const handleMinimumPurchaseCheck = (newCount: number) => {
    // No minimum purchase requirement - just return the count
    return newCount;
  };

  const validateMinimumPurchase = () => {
    // No minimum purchase requirement - always valid as long as at least 1 ticket
    return true;
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
    if (validateMinimumPurchase()) {
      setShowCaptchaModal(true);
    }
  };

  const handleSliderChange = (values: number[]) => {
    const newCount = handleMinimumPurchaseCheck(values[1]);
    setTicketCount(newCount);
    // Clear previous reservation when ticket count changes
    if (newCount !== ticketCount) {
      setReservationId(null);
      setReservedTickets([]);
      setReservationError(null);
    }
  };

  // Reserve random tickets for lucky dip before payment
  // This ensures tickets are held atomically and prevents overselling
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
    ticketReservationLogger.info('Starting reservation', {
      userId: baseUser.id.substring(0, 10) + '...',
      competitionId: competition.id.substring(0, 8) + '...',
      ticketCount,
      totalTickets: competition.total_tickets
    });

    try {
      ticketReservationLogger.info('Fetching available tickets');

      // Fetch unavailable tickets directly using RPC
      const { data: unavailableData, error: unavailableError } = await supabase
        .rpc('get_unavailable_tickets', { p_competition_id: competition.id });

      if (unavailableError) {
        throw unavailableError;
      }

      const unavailableSet = new Set<number>(unavailableData || []);
      const availableTickets: number[] = [];
      for (let i = 1; i <= (competition.total_tickets || 0); i++) {
        if (!unavailableSet.has(i)) {
          availableTickets.push(i);
        }
      }

      ticketReservationLogger.debug('Available tickets fetched', {
        availableCount: availableTickets.length,
        requestedCount: ticketCount
      });

      if (availableTickets.length < ticketCount) {
        ticketReservationLogger.warn('Insufficient tickets available', {
          available: availableTickets.length,
          requested: ticketCount
        });
        setReservationError(`Only ${availableTickets.length} tickets available. Please reduce your selection.`);
        setReserving(false);
        ticketReservationLogger.groupEnd();
        return false;
      }

      // Pick random tickets from available pool
      const shuffled = [...availableTickets].sort(() => Math.random() - 0.5);
      const selectedTickets = shuffled.slice(0, ticketCount);

      ticketReservationLogger.info('Invoking reserve_tickets edge function', {
        ticketPreview: selectedTickets.slice(0, 5).join(', ') + (selectedTickets.length > 5 ? '...' : ''),
        totalSelected: selectedTickets.length
      });

      // Reserve them atomically using the reserve_tickets function
      const edgeFunctionStartTime = Date.now();

      const result = await reserveTicketsWithRedundancy({
        userId: baseUser.id,
        competitionId: competition.id,
        selectedTickets: selectedTickets,
      });

      const edgeFunctionDuration = Date.now() - edgeFunctionStartTime;

      // Handle function invocation errors
      if (result.error) {
        ticketReservationLogger.edgeFunctionError('reserve_tickets', result.error, 1, 1);
        showDebugHintOnError();

        requestTracker.addRequest({
          timestamp: Date.now(),
          endpoint: 'edge:reserve_tickets',
          method: 'EDGE_FUNCTION',
          success: false,
          error: result.error.message || 'Reservation failed',
          errorCode: 'INVOKE_ERROR',
          duration: edgeFunctionDuration
        });

        setReservationError("Could not reserve tickets. Please try again.");
        setReserving(false);
        ticketReservationLogger.groupEnd();
        return false;
      }

      const response = result.data;

      // Only show success on HTTP 200 with success: true
      if (response?.success !== true) {
        const errorMsg = response?.error || "Failed to reserve tickets";
        ticketReservationLogger.warn('Application-level error', {
          error: errorMsg,
          response
        });

        requestTracker.addRequest({
          timestamp: Date.now(),
          endpoint: 'edge:reserve_tickets',
          method: 'EDGE_FUNCTION',
          success: false,
          error: errorMsg,
          errorCode: 'APP_ERROR',
          duration: edgeFunctionDuration
        });

        setReservationError(errorMsg);
        setReserving(false);
        ticketReservationLogger.groupEnd();
        return false;
      }

      // Success!
      // Handle both old response format (reservationId, ticketNumbers, ticketCount)
      // and new stub format (ok: true, reserved: [...], competition_id)
      const reservedTicketNumbers = response.reserved || response.ticketNumbers || selectedTickets;
      const ticketCountReserved = response.reserved?.length || response.ticketCount || selectedTickets.length;

      ticketReservationLogger.success('Reservation successful', {
        ticketCountReserved,
        reservationId: response.reservationId || '(none)',
        totalDuration: Date.now() - reservationStartTime
      });

      requestTracker.addRequest({
        timestamp: Date.now(),
        endpoint: 'edge:reserve_tickets',
        method: 'EDGE_FUNCTION',
        success: true,
        duration: edgeFunctionDuration
      });

      // Use the actual reservationId from response
      const actualReservationId = response.reservationId || null;
      setReservationId(actualReservationId);
      setReservedTickets(reservedTicketNumbers);
      setReserving(false);
      ticketReservationLogger.groupEnd();
      return true;

    } catch (err) {
      ticketReservationLogger.error('Exception during reservation', err);
      showDebugHintOnError();

      requestTracker.addRequest({
        timestamp: Date.now(),
        endpoint: 'edge:reserve_tickets',
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

  // Use authoritative availability data with conservative fallback when non-authoritative
  // This ensures a single source of truth while preventing 0/0 display during loading
  const soldCount = availability.isAuthoritative 
    ? availability.sold_count 
    : (competition.tickets_sold || 0);
  
  const totalTickets = availability.isAuthoritative 
    ? availability.total_tickets 
    : (competition.total_tickets || 0);
  
  // Helper: Calculate fallback available count from competition data
  const fallbackAvailableCount = Math.max(0, (competition.total_tickets || 0) - (competition.tickets_sold || 0));
  
  const availableCount = availability.isAuthoritative 
    ? availability.available_count 
    : fallbackAvailableCount;

  // Check if competition is sold out
  const isSoldOut = totalTickets > 0 && soldCount >= totalTickets;

  // Check if competition accepts entries (only active competitions)
  const isEntryAllowed = canEnterCompetition(competition.status);
  
  // Slider and buttons should be disabled only when tickets are unavailable
  const isSelectionDisabled = isSoldOut || availableCount === 0;
  
  // Determine if we should show the "temporarily unavailable" banner
  const showUnavailableBanner = shouldShowUnavailableBanner({
    availableCount,
    isSoldOut,
    availabilityError,
    isAuthoritative: availability.isAuthoritative,
  });

  // Enhanced debug logging to track availability logic
  console.log('[HeroSection] Ticket availability state:', {
    // Authoritative data
    isAuthoritative: availability.isAuthoritative,
    authoritativeAvailableCount: availability.available_count,
    authoritativeSoldCount: availability.sold_count,
    authoritativeTotalTickets: availability.total_tickets,
    
    // Fallback data
    fallbackAvailableCount,
    competitionTotalTickets: competition.total_tickets,
    competitionTicketsSold: competition.tickets_sold,
    
    // Computed values (uses fallback when not authoritative)
    soldCount,
    totalTickets,
    availableCount,
    pendingCount: availability.pending_count,
    
    // UI state
    isSoldOut,
    isSelectionDisabled,
    showUnavailableBanner,
    availabilityError,
    availabilityLoading,
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
                <span className="sequel-45 text-white md:text-lg">{availableCount}</span>
              </div>
              
              {/* Show clear message when slider is disabled */}
              {isSoldOut && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-3">
                  <p className="text-red-400 text-sm sequel-45 text-center">
                    Competition is sold out - no tickets available
                  </p>
                </div>
              )}
              {/* Show "temporarily unavailable" banner only when tickets are genuinely unavailable.
                  Uses computed availableCount which includes fallback, so banner won't show when
                  authoritative RPC fails but fallback indicates tickets remain. */}
              {showUnavailableBanner && (
                <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg px-3 py-2 mb-3">
                  <p className="text-orange-400 text-sm sequel-45 text-center">
                    Tickets temporarily unavailable - please refresh
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
              
              <ReactRangeSliderInput
                className="single-thumb"
                value={[0, ticketCount]}
                onInput={handleSliderChange}
                min={0}
                max={Math.max(availableCount, 1)}
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
          // Reserve tickets BEFORE showing user info modal
          // This ensures atomic ticket allocation for lucky dip
          const success = await reserveLuckyDipTickets();
          if (success) {
            setShowUserInfoModal(true);
          }
          // If reservation failed, error message is already set
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
          // Card payment now routes to the main payment modal which handles all payment methods
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
              // Clear reservation state on success
              setReservationId(null);
              setReservedTickets([]);
              setTicketCount(0);
              // Refresh ticket availability immediately to show newly purchased tickets as sold
              // This ensures UI reflects the updated state without requiring reload
              refreshAvailability();
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