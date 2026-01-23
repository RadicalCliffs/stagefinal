/**
 * TicketPicker Component
 *
 * A React component for manually selecting specific ticket numbers in REGULAR competitions.
 * This feature is only available for REGULAR competition types - INSTANT_WIN competitions
 * must use Lucky Dip.
 *
 * Features:
 * - Grid-based ticket selection interface
 * - Real-time availability checking
 * - Batch purchase of selected tickets
 * - Shows which tickets are already sold
 * - Maximum tickets per transaction enforcement
 *
 * Usage:
 * ```tsx
 * <TicketPicker
 *   competitionId={0}
 *   onSuccess={(result) => console.log(result.ticketNumbers)}
 * />
 * ```
 */

import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import type { Hash } from 'viem';
import { useAuthUser } from '../../contexts/AuthContext';
import {
  getCompetitionDetails,
  getTicketOwner,
  useCompetitionEvents,
  type CompetitionDetails,
  type PurchaseResult
} from '../../lib/luckyDip';
import type { TicketsPurchasedEvent } from '../../lib/competitionEvents';
import { supabase } from '../../lib/supabase';
import { reserveTicketsWithRedundancy } from '../../lib/reserve-tickets-redundant';
import { parseReservationErrorAsync, getUserFriendlyErrorMessage, SupabaseFunctionError } from '../../lib/error-handler';
import CaptchaModal from '../CaptchaModal';
import UserInfoModal from '../UserInfoModal';
import type { UserInfo } from '../UserInfoModal';

// Lazy load PaymentModal - only loaded when user initiates payment
const PaymentModal = lazy(() => import('../PaymentModal'));

// Constants
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const DEFAULT_TICKET_PRICE = 1;

interface TicketPickerProps {
  /** The on-chain competition ID from the smart contract */
  competitionId: number;
  /** Callback fired after successful purchase with ticket numbers and tx hash */
  onSuccess?: (result: PurchaseResult) => void;
  /** Optional callback for error handling */
  onError?: (error: Error) => void;
  /** Optional custom class name for the container */
  className?: string;
  /** Number of tickets to show per page */
  ticketsPerPage?: number;
}

interface SuccessState {
  tickets: number[];
  txHash: string;
}

export default function TicketPicker({
  competitionId,
  onSuccess,
  onError,
  className = '',
  ticketsPerPage = 100
}: TicketPickerProps) {
  const { authenticated, ready, login, baseUser } = useAuthUser();

  const [selectedTickets, setSelectedTickets] = useState<Set<number>>(new Set());
  const [soldTickets, setSoldTickets] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadingSold, setLoadingSold] = useState(true);
  const [competition, setCompetition] = useState<CompetitionDetails | null>(null);
  const [competitionLoading, setCompetitionLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  
  // Modal states
  const [showCaptchaModal, setShowCaptchaModal] = useState(false);
  const [showUserInfoModal, setShowUserInfoModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [userInfo, setUserInfo] = useState<UserInfo | undefined>();
  
  // Reservation states
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [reserving, setReserving] = useState(false);
  const [reservationError, setReservationError] = useState<string | null>(null);
  const [reservationSuccess, setReservationSuccess] = useState<string | null>(null);
  
  // Database competition ID (mapped from on-chain ID)
  const [dbCompetitionId, setDbCompetitionId] = useState<string | null>(null);
  const [ticketPrice, setTicketPrice] = useState<number>(DEFAULT_TICKET_PRICE);

  // Load competition details from smart contract and map to database ID
  const loadCompetition = useCallback(async () => {
    try {
      const details = await getCompetitionDetails(competitionId);
      setCompetition(details);
      
      // Map on-chain competition ID to database competition ID
      const { data: dbCompetition, error: dbError } = await supabase
        .from('competitions')
        .select('id, ticket_price')
        .eq('onchain_competition_id', competitionId)
        .maybeSingle();
      
      if (dbError) {
        console.error('Error loading database competition:', dbError);
      } else if (dbCompetition) {
        setDbCompetitionId(dbCompetition.id);
        setTicketPrice(Number(dbCompetition.ticket_price) || DEFAULT_TICKET_PRICE);
      } else {
        console.warn(`No database competition found for on-chain ID ${competitionId}`);
      }
      
      setCompetitionLoading(false);
    } catch (err) {
      console.error('Error loading competition:', err);
      setCompetitionLoading(false);
    }
  }, [competitionId]);

  // Load sold tickets for current page
  const loadSoldTickets = useCallback(async () => {
    if (!competition) return;

    setLoadingSold(true);
    const startTicket = currentPage * ticketsPerPage + 1;
    const endTicket = Math.min(startTicket + ticketsPerPage - 1, competition.totalTickets);

    const newSoldTickets = new Set<number>();

    // Check ownership in batches
    const batchSize = 20;
    for (let i = startTicket; i <= endTicket; i += batchSize) {
      const batch = [];
      for (let j = i; j < Math.min(i + batchSize, endTicket + 1); j++) {
        batch.push(j);
      }

      // Check all tickets in batch concurrently
      const results = await Promise.all(
        batch.map(async (ticketNum) => {
          try {
            const owner = await getTicketOwner(competitionId, ticketNum);
            return { ticketNum, sold: owner.toLowerCase() !== ZERO_ADDRESS.toLowerCase() };
          } catch {
            return { ticketNum, sold: false };
          }
        })
      );

      results.forEach(({ ticketNum, sold }) => {
        if (sold) {
          newSoldTickets.add(ticketNum);
        }
      });
    }

    setSoldTickets(newSoldTickets);
    setLoadingSold(false);
  }, [competition, competitionId, currentPage, ticketsPerPage]);

  useEffect(() => {
    loadCompetition();
  }, [loadCompetition]);

  useEffect(() => {
    if (competition) {
      loadSoldTickets();
    }
  }, [competition, loadSoldTickets]);

  // Subscribe to ticket purchase events
  useCompetitionEvents({
    onTicketsPurchased: (event: TicketsPurchasedEvent) => {
      // Add newly purchased tickets to sold set
      const newSold = new Set(soldTickets);
      // Generate ticket numbers from fromTicket to fromTicket + count
      const fromTicket = Number(event.fromTicket);
      const count = Number(event.count);
      for (let i = 0; i < count; i++) {
        newSold.add(fromTicket + i);
      }
      setSoldTickets(newSold);

      // Remove from selection if was selected
      const newSelected = new Set(selectedTickets);
      for (let i = 0; i < count; i++) {
        newSelected.delete(fromTicket + i);
      }
      setSelectedTickets(newSelected);

      // Refresh competition details
      loadCompetition();
    }
  }, competitionId);

  const handleTicketClick = (ticketNumber: number) => {
    if (soldTickets.has(ticketNumber)) return;

    const newSelected = new Set(selectedTickets);
    if (newSelected.has(ticketNumber)) {
      newSelected.delete(ticketNumber);
    } else {
      if (competition && newSelected.size >= competition.maxTicketsPerTx) {
        setError(`Maximum ${competition.maxTicketsPerTx} tickets per transaction`);
        return;
      }
      newSelected.add(ticketNumber);
    }
    setSelectedTickets(newSelected);
    setError(null);
    // Clear reservation when selection changes
    setReservationId(null);
    setReservationError(null);
    setReservationSuccess(null);
  };

  // Reserve tickets using database reservation system
  const reserveTickets = async (): Promise<string | null> => {
    if (!baseUser?.id) {
      setReservationError("Please log in to reserve tickets");
      return null;
    }

    if (!dbCompetitionId) {
      setReservationError("Competition not found in database. Please try again.");
      return null;
    }

    setReserving(true);
    setReservationError(null);
    setReservationSuccess(null);

    try {
      const ticketArray = Array.from(selectedTickets).sort((a, b) => a - b);

      // Reserve tickets using the reservation service
      const result = await reserveTicketsWithRedundancy({
        userId: baseUser.id,
        competitionId: dbCompetitionId,
        selectedTickets: ticketArray,
      });

      if (result.error) {
        const parsedError = await parseReservationErrorAsync(result.error);
        
        // Handle HTTP 409 with unavailable tickets - remove them from UI and refresh
        if (parsedError.statusCode === 409 && parsedError.unavailableTickets && parsedError.unavailableTickets.length > 0) {
          console.log("[TicketPicker] HTTP 409 - removing unavailable tickets:", parsedError.unavailableTickets);
          
          const unavailableTickets = parsedError.unavailableTickets;
          
          // Remove unavailable tickets from selection
          const newSelected = new Set(selectedTickets);
          unavailableTickets.forEach(t => newSelected.delete(t));
          setSelectedTickets(newSelected);
          
          // Immediately add unavailable tickets to sold tickets display
          setSoldTickets(prev => {
            const updated = new Set(prev);
            unavailableTickets.forEach(t => updated.add(t));
            return updated;
          });
          
          // Refresh sold tickets from server for consistency
          await loadSoldTickets();
          
          // Show specific error message for 409 conflicts
          setReservationError(parsedError.message);
          return null;
        }
        
        throw new SupabaseFunctionError(
          parsedError.message,
          parsedError.statusCode,
          result.error
        );
      }

      const response = result.data;
      
      // Only show success on HTTP 200 with success: true
      if (response?.success !== true) {
        throw new Error(response?.error || "Failed to reserve tickets");
      }

      const resId = response.reservationId || null;
      setReservationId(resId);
      setReservationSuccess("Tickets reserved! Complete payment within 15 minutes.");
      return resId;
    } catch (err) {
      console.error('Error reserving tickets:', err);
      let errorMessage = "Failed to reserve tickets";
      
      if (err instanceof Error) {
        errorMessage = err.message;
      } else {
        errorMessage = getUserFriendlyErrorMessage();
      }
      
      setReservationError(errorMessage);
      return null;
    } finally {
      setReserving(false);
    }
  };

  // Handle checkout button click - show captcha first
  const handleCheckout = async () => {
    setError(null);
    
    if (selectedTickets.size === 0) {
      setError("Please select at least one ticket");
      return;
    }

    // Check if user is authenticated
    if (!ready || !authenticated) {
      login();
      return;
    }

    if (!dbCompetitionId) {
      setError("Competition not found. Please refresh the page and try again.");
      return;
    }

    setShowCaptchaModal(true);
  };

  // After captcha success, reserve tickets then show payment modal directly
  const handleCaptchaSuccess = async () => {
    setShowCaptchaModal(false);

    // Reserve tickets before proceeding
    const resId = await reserveTickets();

    if (resId) {
      setShowPaymentModal(true);
    } else if (!reservationError) {
      console.warn('[TicketPicker] Reservation returned null without setting an error');
      setReservationError("Unable to reserve tickets. Please try again or contact support.");
    }
  };

  const handleBuy = handleCheckout; // Keep compatibility with old button name

  const totalCost = ticketPrice
    ? (ticketPrice * selectedTickets.size).toFixed(6)
    : '0';

  const totalPages = competition
    ? Math.ceil(competition.totalTickets / ticketsPerPage)
    : 1;

  // Generate ticket numbers for current page
  const pageTickets = useMemo(() => {
    if (!competition) return [];
    const start = currentPage * ticketsPerPage + 1;
    const end = Math.min(start + ticketsPerPage - 1, competition.totalTickets);
    const tickets = [];
    for (let i = start; i <= end; i++) {
      tickets.push(i);
    }
    return tickets;
  }, [competition, currentPage, ticketsPerPage]);

  const handleClearSelection = () => {
    setSelectedTickets(new Set());
  };

  // Check if this is an Instant Win competition
  if (competition && competition.isInstantWin) {
    return (
      <div className={`bg-white rounded-lg shadow-lg p-6 max-w-2xl w-full ${className}`}>
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-yellow-800 font-semibold">Manual Pick Not Available</p>
          <p className="text-yellow-700 text-sm mt-2">
            This is an Instant Win competition. Ticket numbers are randomly assigned
            using VRF to determine instant winners. Please use Lucky Dip to purchase tickets.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-lg shadow-lg p-6 max-w-2xl w-full ${className}`}>
      <h3 className="text-2xl font-bold mb-4 text-gray-800">
        Pick Your Numbers
      </h3>

      {competitionLoading ? (
        <div className="mb-4 p-4 bg-gray-50 rounded-lg animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
      ) : competition ? (
        <>
          <div className="mb-4 p-4 bg-blue-50 rounded-lg">
            <div className="flex justify-between mb-2">
              <span className="text-gray-600">Price per ticket:</span>
              <span className="font-semibold">${ticketPrice.toFixed(2)}</span>
            </div>
            <div className="flex justify-between mb-2">
              <span className="text-gray-600">Available tickets:</span>
              <span className="font-semibold text-green-600">{competition.available}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Max per transaction:</span>
              <span className="font-semibold">{competition.maxTicketsPerTx}</span>
            </div>
          </div>

          {/* Pagination */}
          <div className="flex justify-between items-center mb-4">
            <button
              onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
              disabled={currentPage === 0}
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 disabled:cursor-not-allowed rounded-lg"
            >
              ← Previous
            </button>
            <span className="text-gray-600">
              Page {currentPage + 1} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(Math.min(totalPages - 1, currentPage + 1))}
              disabled={currentPage >= totalPages - 1}
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 disabled:cursor-not-allowed rounded-lg"
            >
              Next →
            </button>
          </div>

          {/* Ticket Grid */}
          {loadingSold ? (
            <div className="grid grid-cols-10 gap-1 mb-4">
              {Array.from({ length: ticketsPerPage }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-square bg-gray-200 animate-pulse rounded"
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-10 gap-1 mb-4">
              {pageTickets.map((ticketNumber) => {
                const isSold = soldTickets.has(ticketNumber);
                const isSelected = selectedTickets.has(ticketNumber);

                return (
                  <button
                    key={ticketNumber}
                    onClick={() => handleTicketClick(ticketNumber)}
                    disabled={isSold || loading}
                    className={`
                      aspect-square text-xs font-medium rounded transition-all
                      ${isSold
                        ? 'bg-red-200 text-red-500 cursor-not-allowed'
                        : isSelected
                        ? 'bg-blue-600 text-white ring-2 ring-blue-400'
                        : 'bg-green-100 hover:bg-green-200 text-green-800'
                      }
                    `}
                    title={isSold ? 'Sold' : isSelected ? 'Selected' : 'Available'}
                  >
                    {ticketNumber}
                  </button>
                );
              })}
            </div>
          )}

          {/* Legend */}
          <div className="flex gap-4 mb-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-green-100 rounded"></div>
              <span>Available</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-blue-600 rounded"></div>
              <span>Selected</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-red-200 rounded"></div>
              <span>Sold</span>
            </div>
          </div>

          {/* Selection Summary */}
          <div className="mb-4 p-4 bg-gray-100 rounded-lg">
            <div className="flex justify-between items-center mb-2">
              <span className="text-gray-700">Selected tickets:</span>
              <span className="font-semibold">
                {selectedTickets.size} / {competition.maxTicketsPerTx}
              </span>
            </div>
            {selectedTickets.size > 0 && (
              <>
                <div className="text-sm text-gray-600 mb-2">
                  Numbers: {Array.from(selectedTickets).sort((a, b) => a - b).join(', ')}
                </div>
                <button
                  onClick={handleClearSelection}
                  className="text-blue-600 hover:text-blue-800 text-sm underline"
                >
                  Clear selection
                </button>
              </>
            )}
            <div className="flex justify-between items-center mt-3 pt-3 border-t border-gray-200">
              <span className="text-gray-700 font-medium">Total Cost:</span>
              <span className="text-2xl font-bold text-blue-600">${totalCost}</span>
            </div>
          </div>

          <button
            onClick={handleCheckout}
            disabled={reserving || selectedTickets.size === 0 || !competition.active || !dbCompetitionId}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg transition-colors duration-200 flex items-center justify-center"
          >
            {reserving ? (
              <>
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Reserving...
              </>
            ) : !authenticated ? (
              'Connect Wallet to Buy'
            ) : selectedTickets.size === 0 ? (
              'Select Tickets'
            ) : (
              'Checkout'
            )}
          </button>
        </>
      ) : (
        <div className="mb-4 p-4 bg-red-50 rounded-lg">
          <p className="text-red-600 text-sm">Could not load competition details</p>
        </div>
      )}

      {!competition?.active && competition && (
        <p className="text-red-600 text-sm mt-2 text-center">
          Competition is not active
        </p>
      )}

      {error && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}

      {reservationError && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-800 text-sm">{reservationError}</p>
        </div>
      )}

      {reservationSuccess && (
        <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-green-800 text-sm">{reservationSuccess}</p>
        </div>
      )}

      {success && (
        <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-green-800 font-semibold mb-2">Payment Successful!</p>
          <p className="text-sm text-gray-700 mb-2">
            Your ticket numbers: <strong>{success.tickets.join(', ')}</strong>
          </p>
        </div>
      )}

      {/* Captcha Modal */}
      <CaptchaModal
        isOpen={showCaptchaModal}
        onClose={() => setShowCaptchaModal(false)}
        onSuccess={handleCaptchaSuccess}
      />

      {/* User Info Modal */}
      <UserInfoModal
        isOpen={showUserInfoModal}
        onClose={() => setShowUserInfoModal(false)}
        ticketCount={selectedTickets.size}
        totalAmount={selectedTickets.size * ticketPrice}
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

      {/* Payment Modal */}
      {showPaymentModal && dbCompetitionId && (
        <Suspense fallback={null}>
          <PaymentModal
            isOpen={showPaymentModal}
            onOpen={() => setShowPaymentModal(true)}
            onClose={() => setShowPaymentModal(false)}
            ticketCount={selectedTickets.size}
            competitionId={dbCompetitionId}
            ticketPrice={ticketPrice}
            userInfo={userInfo}
            selectedTickets={Array.from(selectedTickets)}
            reservationId={reservationId}
            onPaymentSuccess={() => {
              // Capture ticket numbers before clearing
              const purchasedTickets = Array.from(selectedTickets);
              
              // Refresh sold tickets after successful payment
              loadSoldTickets();
              // Clear selection
              setSelectedTickets(new Set());
              setReservationId(null);
              setReservationSuccess(null);
              setReservationError(null);
              // Show success
              setSuccess({
                tickets: purchasedTickets,
                txHash: (reservationId || 'confirmed') as Hash
              });
              // Call parent callback if provided
              if (onSuccess) {
                onSuccess({
                  ticketNumbers: purchasedTickets,
                  txHash: (reservationId || 'confirmed') as Hash,
                  totalPaid: '0',
                  buyerAddress: '0x0',
                  instantWins: []
                });
              }
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
