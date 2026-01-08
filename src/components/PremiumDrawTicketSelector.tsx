import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { useAuthUser } from "../contexts/AuthContext";
import { Minus, Plus } from "lucide-react";
import CaptchaModal from "./CaptchaModal";
import UserInfoModal from "./UserInfoModal";
import VRFChargeMeter from "./VRFChargeMeter";
import type { UserInfo } from "./UserInfoModal";
import { database } from "../lib/database";

// Lazy load PaymentModal - only loaded when user initiates payment
const PaymentModal = lazy(() => import("./PaymentModal"));

interface PremiumDrawTicketSelectorProps {
  competitionId: string;
  ticketPrice: number;
  totalTickets: number;
  ticketsSold?: number;
  maxTicketsPerUser?: number;
}

const PremiumDrawTicketSelector: React.FC<PremiumDrawTicketSelectorProps> = ({
  competitionId,
  ticketPrice,
  totalTickets,
  ticketsSold = 0,
  maxTicketsPerUser = 100,
}) => {
  const { baseUser } = useAuthUser();
  const [ticketCount, setTicketCount] = useState(1);
  const [selectedTickets, setSelectedTickets] = useState<number[]>([]);
  // Use count-based availability instead of fetching all ticket numbers
  const [availableCount, setAvailableCount] = useState<number>(totalTickets - ticketsSold);
  const [showCaptchaModal, setShowCaptchaModal] = useState(false);
  const [showUserInfoModal, setShowUserInfoModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [userInfo, setUserInfo] = useState<UserInfo | undefined>();
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reserving, setReserving] = useState(false);
  const [reservationError, setReservationError] = useState<string | null>(null);

  const remainingTickets = Math.max(0, totalTickets - ticketsSold);
  const maxSelectableTickets = Math.min(maxTicketsPerUser, remainingTickets, availableCount || remainingTickets);

  const totalAmount = ticketCount * ticketPrice;

  // Fetch available ticket count only (more efficient than fetching all ticket numbers)
  const fetchAvailableCount = useCallback(async () => {
    setLoading(true);
    try {
      // Use count-based query - doesn't transfer full ticket array to client
      const result = await database.getAvailableTicketCount(competitionId);
      if (result) {
        setAvailableCount(result.available_count);
      } else {
        // Fallback to computed value
        setAvailableCount(Math.max(0, totalTickets - ticketsSold));
      }
    } catch (error) {
      console.error('Error fetching available ticket count:', error);
      // Use default remaining calculation on error
      setAvailableCount(Math.max(0, totalTickets - ticketsSold));
    } finally {
      setLoading(false);
    }
  }, [competitionId, totalTickets, ticketsSold]);

  useEffect(() => {
    fetchAvailableCount();
  }, [fetchAvailableCount]);

  // No client-side lucky dip generation needed - server handles random selection
  // The handleLuckyDip function now just triggers the reservation flow

  // Adjust ticket count
  const incrementCount = () => {
    if (ticketCount < maxSelectableTickets) {
      setTicketCount(ticketCount + 1);
      // Clear any previously selected tickets when count changes
      // Server will select new tickets during reservation
      setSelectedTickets([]);
    }
  };

  const decrementCount = () => {
    if (ticketCount > 1) {
      setTicketCount(ticketCount - 1);
      // Clear any previously selected tickets when count changes
      setSelectedTickets([]);
    }
  };

  // Reserve tickets before payment using atomic server-side allocation
  const reserveTickets = async (): Promise<string | null> => {
    if (!baseUser?.id) {
      setReservationError("Please log in to reserve tickets");
      return null;
    }

    setReserving(true);
    setReservationError(null);

    try {
      // Use atomic RPC function for server-side random selection + reservation
      // This ensures fair randomness and prevents race conditions
      const response = await database.allocateLuckyDipTickets(
        competitionId,
        baseUser.id,
        ticketCount,
        ticketPrice,
        15, // holdMinutes
        crypto.randomUUID() // sessionId for idempotency
      );

      if (!response.success) {
        // Check for availability error
        if (response.available_count !== undefined) {
          throw new Error(`Only ${response.available_count} tickets available`);
        }
        throw new Error(response.error || 'Failed to reserve tickets');
      }

      // Update state with server-selected tickets
      setSelectedTickets(response.ticket_numbers || []);
      setReservationId(response.reservation_id || null);

      console.log('[Lucky Dip] Atomic reservation successful:', {
        reservationId: response.reservation_id,
        ticketCount: response.ticket_count,
      });

      return response.reservation_id || null;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to reserve tickets';
      setReservationError(errorMessage);
      // Refresh availability count on error
      fetchAvailableCount();
      return null;
    } finally {
      setReserving(false);
    }
  };

  // Handle checkout - directly proceeds to captcha/reservation flow
  const handleCheckout = async () => {
    setShowCaptchaModal(true);
  };

  // After captcha success
  const handleCaptchaSuccess = async () => {
    setShowCaptchaModal(false);
    const resId = await reserveTickets();
    if (resId) {
      setShowUserInfoModal(true);
    }
  };

  return (
    <div className="space-y-6">
      {/* Ticket Count Selector */}
      <div className="bg-[#1A1A1A] border border-[#DDE404]/20 rounded-xl p-4">
        <p className="sequel-75 text-white text-sm mb-3">Select Number of Entries</p>
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={decrementCount}
            disabled={ticketCount <= 1}
            className="w-12 h-12 rounded-lg bg-[#2A2A2A] text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#3A3A3A] transition-colors"
          >
            <Minus size={20} />
          </button>
          <div className="text-center min-w-[80px]">
            <span className="sequel-95 text-[#DDE404] text-4xl">{ticketCount}</span>
            <p className="sequel-45 text-white/50 text-xs mt-1">entries</p>
          </div>
          <button
            onClick={incrementCount}
            disabled={ticketCount >= maxSelectableTickets}
            className="w-12 h-12 rounded-lg bg-[#2A2A2A] text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#3A3A3A] transition-colors"
          >
            <Plus size={20} />
          </button>
        </div>
      </div>

      {/* VRF Charge Meter */}
      <VRFChargeMeter currentAmount={totalAmount} className="px-1" />

      {/* Selected Tickets Display - only shown after server returns allocation */}
      {selectedTickets.length > 0 && (
        <div className="bg-[#2A2A2A] rounded-lg p-4">
          <p className="text-white/60 sequel-45 text-sm mb-2">Your Reserved Tickets:</p>
          <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto custom-scrollbar">
            {selectedTickets.sort((a, b) => a - b).map(ticket => (
              <span
                key={ticket}
                className="bg-[#DDE404] text-[#1A1A1A] sequel-75 text-sm px-3 py-1 rounded-md"
              >
                {ticket}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Total and Checkout */}
      <div className="bg-[#1A1A1A] border-2 border-[#DDE404] rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-white/60 sequel-45 text-sm">{ticketCount} × ${ticketPrice.toFixed(2)}</p>
            <p className="text-[#DDE404] sequel-95 text-2xl">${totalAmount.toFixed(2)}</p>
          </div>
          <button
            onClick={handleCheckout}
            disabled={reserving || loading || availableCount === 0}
            className="bg-[#DDE404] hover:bg-[#DDE404]/90 disabled:bg-[#494949] disabled:cursor-not-allowed text-black sequel-95 text-lg px-8 py-4 rounded-xl transition-all"
          >
            {reserving ? 'Reserving...' : 'Checkout'}
          </button>
        </div>

        {reservationError && (
          <p className="text-red-400 text-xs sequel-45 text-center">{reservationError}</p>
        )}
      </div>

      <p className="sequel-45 text-white/40 text-xs text-center">
        {loading ? 'Loading availability...' : `${availableCount} tickets available`}
      </p>

      {/* Modals */}
      <CaptchaModal
        isOpen={showCaptchaModal}
        onClose={() => setShowCaptchaModal(false)}
        onSuccess={handleCaptchaSuccess}
      />

      <UserInfoModal
        isOpen={showUserInfoModal}
        onClose={() => setShowUserInfoModal(false)}
        ticketCount={ticketCount}
        totalAmount={totalAmount}
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
            competitionId={competitionId}
            ticketPrice={ticketPrice}
            userInfo={userInfo}
            selectedTickets={selectedTickets}
            reservationId={reservationId}
            maxAvailableTickets={availableCount}
            onPaymentSuccess={() => {
              fetchAvailableCount();
              setSelectedTickets([]);
              setTicketCount(1);
              setReservationId(null);
            }}
          />
        </Suspense>
      )}
    </div>
  );
};

export default PremiumDrawTicketSelector;
