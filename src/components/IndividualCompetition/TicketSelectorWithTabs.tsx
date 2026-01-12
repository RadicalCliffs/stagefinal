import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from "react";
import TicketGrid from "./TicketGrid";
import type { Options } from "../../models/models";
import FilterTabs from "../FilterButtons";
import { database } from "../../lib/database";
import Loader from "../Loader";
import CaptchaModal from "../CaptchaModal";
import UserInfoModal from "../UserInfoModal";
import type { UserInfo } from "../UserInfoModal";
import { supabase } from "../../lib/supabase";
import { useAuthUser } from "../../contexts/AuthContext";
import { getUserFriendlyErrorMessage, parseReservationErrorAsync, SupabaseFunctionError } from "../../lib/error-handler";
import { debounce } from "../../utils/util";
import { reserveTicketsWithRedundancy, parseReservationResponse } from "../../lib/reserve-tickets-redundant";

// Lazy load PaymentModal - only loaded when user initiates payment
const PaymentModal = lazy(() => import("../PaymentModal"));

interface TicketSelectorProps {
    competitionId: string;
    totalTickets: number;
    ticketPrice?: number;
    ticketsSold?: number;
}

const TicketSelector: React.FC<TicketSelectorProps> = ({ competitionId, totalTickets, ticketPrice: rawTicketPrice = 1, ticketsSold = 0 }) => {
    const { baseUser } = useAuthUser();

    // Ensure ticketPrice is a valid positive number (handles string coercion from database)
    const ticketPrice = Number(rawTicketPrice) || 1;

    // Calculate remaining tickets available for purchase
    const remainingTickets = Math.max(0, totalTickets - ticketsSold);

    const generateFilterOptions = (total: number): Options[] => {
        const options: Options[] = [];
        const rangeSize = 100;
        for (let i = 1; i <= total; i += rangeSize) {
            const end = Math.min(i + rangeSize - 1, total);
            options.push({
                key: `${i}-${end}`,
                label: `${i} - ${end}`
            });
        }
        return options;
    };


    const filterOptions = generateFilterOptions(totalTickets);
    const RANGES_PER_PAGE = 10;
    const totalRangePages = Math.ceil(filterOptions.length / RANGES_PER_PAGE);

    const [activeFilter, setActiveFilter] = useState(filterOptions[0]);
    const [currentRangePage, setCurrentRangePage] = useState(1);
    // Initialize selectedTickets from sessionStorage if available (for persistence)
    const [selectedTickets, setSelectedTickets] = useState<number[]>(() => {
        try {
            const stored = sessionStorage.getItem(`selectedTickets_${competitionId}`);
            if (!stored) return [];

            // Safely parse with error handling for corrupted sessionStorage data
            let parsed: unknown;
            try {
                parsed = JSON.parse(stored);
            } catch (parseError) {
                // Invalid JSON - clear corrupted data and return empty array
                console.warn('Invalid ticket selection data in sessionStorage, clearing:', parseError);
                sessionStorage.removeItem(`selectedTickets_${competitionId}`);
                return [];
            }

            // Validate the parsed result is an array of numbers
            if (!Array.isArray(parsed)) {
                console.warn('Ticket selection data is not an array, clearing');
                sessionStorage.removeItem(`selectedTickets_${competitionId}`);
                return [];
            }

            // Filter to only valid numbers
            return parsed.filter((item): item is number => typeof item === 'number' && !isNaN(item));
        } catch {
            return [];
        }
    });
    const [availableTickets, setAvailableTickets] = useState<number[]>([]);
    // User's already purchased/owned tickets for this competition
    const [ownedTickets, setOwnedTickets] = useState<number[]>([]);
    const [loading, setLoading] = useState(true);
    // Error state for failed data loading
    const [loadingError, setLoadingError] = useState<string | null>(null);
    const [showCaptchaModal, setShowCaptchaModal] = useState(false);
    const [showUserInfoModal, setShowUserInfoModal] = useState(false);
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [userInfo, setUserInfo] = useState<UserInfo | undefined>();
    const [reservationId, setReservationId] = useState<string | null>(null);
    const [reserving, setReserving] = useState(false);
    const [reservationError, setReservationError] = useState<string | null>(null);
    const [reservationSuccess, setReservationSuccess] = useState<string | null>(null);

    const startRangeIndex = (currentRangePage - 1) * RANGES_PER_PAGE;
    const endRangeIndex = Math.min(startRangeIndex + RANGES_PER_PAGE, filterOptions.length);
    const visibleRanges = filterOptions.slice(startRangeIndex, endRangeIndex);

    const handleRangePagePrev = () => {
        if (currentRangePage > 1) {
            setCurrentRangePage(currentRangePage - 1);
        }
    };

    const handleRangePageNext = () => {
        if (currentRangePage < totalRangePages) {
            setCurrentRangePage(currentRangePage + 1);
        }
    };

    // Track if this is the initial load vs a background refresh
    const [isInitialLoad, setIsInitialLoad] = useState(true);

    // Debug: Log available tickets state changes
    console.log('[TicketSelector] State:', {
        availableTicketsCount: availableTickets.length,
        loading,
        loadingError,
        isInitialLoad
    });

    // Create a debounced version of the refresh function for high traffic scenarios
    // This prevents excessive API calls when multiple rapid updates occur (e.g., rapid tab switches)
    const debouncedFetchRef = useRef<ReturnType<typeof debounce> | null>(null);

    const fetchAvailableTickets = useCallback(async (showLoadingState = true) => {
        console.log('[TicketSelector] fetchAvailableTickets called', { showLoadingState, isInitialLoad });
        // Only show loading spinner on initial load, not on background refreshes
        // This prevents the UI from flashing during realtime updates
        if (showLoadingState && isInitialLoad) {
            setLoading(true);
        }
        setLoadingError(null);
        try {
            // IMPORTANT: Always trust the RPC for availability - never rely on client-side checks
            // The database RPC enforces consistency and handles race conditions atomically
            const available = await database.getAvailableTicketsForCompetition(competitionId, totalTickets);
            console.log('[TicketSelector] Setting availableTickets:', { count: available.length, first5: available.slice(0, 5) });
            setAvailableTickets(available);
            if (isInitialLoad) {
                setIsInitialLoad(false);
            }
        } catch (err) {
            console.error('Error fetching available tickets:', err);
            // Only show error on initial load, silently fail on background refreshes
            if (isInitialLoad) {
                setLoadingError('Failed to load available tickets. Please try again.');
            }
        } finally {
            console.log('[TicketSelector] fetchAvailableTickets finally', { showLoadingState, isInitialLoad });
            if (showLoadingState && isInitialLoad) {
                setLoading(false);
            } else if (!isInitialLoad) {
                setLoading(false);
            }
        }
    }, [competitionId, totalTickets, isInitialLoad]);

    // Create debounced fetch function (debounce 300ms to prevent rapid calls during high traffic)
    useEffect(() => {
        debouncedFetchRef.current = debounce(() => {
            fetchAvailableTickets(false);
        }, 300);
    }, [fetchAvailableTickets]);

    // Debounced refresh for high traffic scenarios
    const debouncedRefresh = useCallback(() => {
        if (debouncedFetchRef.current) {
            debouncedFetchRef.current();
        }
    }, []);

    // Fetch user's already purchased tickets for this competition
    // Uses multiple identifier types to ensure we find all entries
    const fetchOwnedTickets = useCallback(async () => {
        if (!baseUser?.id) {
            setOwnedTickets([]);
            return;
        }
        try {
            // First try using the database RPC function for more reliable results
            const rpcResult = await database.getUserTicketsForCompetition(baseUser.id, competitionId);
            if (rpcResult && rpcResult.tickets && rpcResult.tickets.length > 0) {
                setOwnedTickets(rpcResult.tickets.sort((a, b) => a - b));
                return;
            }

            // Fallback: Query joincompetition directly for user's tickets in this competition
            // Use the resolved competition ID to avoid uuid/text type mismatch in OR queries
            // Since joincompetition.competitionid is TEXT, we use single eq filter with the resolved ID
            const resolvedCompetitionId = competitionId; // Already resolved by caller

            // Use separate queries for different user identifiers to ensure we find all entries
            const queries = [
                supabase
                    .from('joincompetition')
                    .select('ticketnumbers')
                    .eq('competitionid', resolvedCompetitionId)
                    .eq('walletaddress', baseUser.id),
                supabase
                    .from('joincompetition')
                    .select('ticketnumbers')
                    .eq('competitionid', resolvedCompetitionId)
                    .eq('privy_user_id', baseUser.id),
                supabase
                    .from('joincompetition')
                    .select('ticketnumbers')
                    .eq('competitionid', resolvedCompetitionId)
                    .eq('userid', baseUser.id)
            ];

            const results = await Promise.all(queries);

            // Parse ticket numbers from all entries across all queries
            const owned: number[] = [];
            results.forEach(({ data, error }) => {
                if (error) {
                    console.warn('Error fetching owned tickets (partial):', error.message);
                    return;
                }
                (data || []).forEach((entry: any) => {
                    if (entry.ticketnumbers) {
                        // Handle both string (comma-separated) and array formats
                        const tickets = typeof entry.ticketnumbers === 'string'
                            ? entry.ticketnumbers.split(',').map((t: string) => parseInt(t.trim(), 10)).filter((n: number) => !isNaN(n))
                            : Array.isArray(entry.ticketnumbers)
                                ? entry.ticketnumbers.map((t: any) => parseInt(t, 10)).filter((n: number) => !isNaN(n))
                                : [];
                        owned.push(...tickets);
                    }
                });
            });

            // Deduplicate and sort
            const uniqueOwned = [...new Set(owned)].sort((a, b) => a - b);
            setOwnedTickets(uniqueOwned);
        } catch (err) {
            console.error('Error fetching owned tickets:', err);
            setOwnedTickets([]);
        }
    }, [baseUser?.id, competitionId]);

    useEffect(() => {
        fetchAvailableTickets();
        fetchOwnedTickets();
    }, [fetchAvailableTickets, fetchOwnedTickets]);

    // Refresh availability on page focus (tab becomes visible)
    // This ensures users see fresh availability when returning to the page
    // Uses debounced refresh to prevent rapid calls during quick tab switches
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                // Use debounced refresh to prevent excessive API calls during high traffic
                debouncedRefresh();
            }
        };

        const handleWindowFocus = () => {
            // Use debounced refresh to prevent excessive API calls during high traffic
            debouncedRefresh();
        };

        // Listen for both visibility change and window focus for better coverage
        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('focus', handleWindowFocus);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('focus', handleWindowFocus);
        };
    }, [debouncedRefresh]);

    // Persist selected tickets to sessionStorage when they change
    useEffect(() => {
        try {
            if (selectedTickets.length > 0) {
                sessionStorage.setItem(`selectedTickets_${competitionId}`, JSON.stringify(selectedTickets));
            } else {
                sessionStorage.removeItem(`selectedTickets_${competitionId}`);
            }
        } catch (e) {
            // sessionStorage may not be available in some contexts
        }
    }, [selectedTickets, competitionId]);

    // Validate stored selections against current availability on load
    useEffect(() => {
        if (!loading && selectedTickets.length > 0 && availableTickets.length > 0) {
            // Remove any stored selections that are no longer available
            const stillAvailable = selectedTickets.filter(t => availableTickets.includes(t));
            if (stillAvailable.length !== selectedTickets.length) {
                setSelectedTickets(stillAvailable);
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading, availableTickets]); // Intentionally not including selectedTickets to avoid loops

    useEffect(() => {
        // Listen for realtime ticket updates (purchases or expiring reservations)
        // Use debounced refresh to prevent excessive API calls during high traffic
        const channel = supabase
            .channel(`tickets-${competitionId}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'joincompetition', filter: `competitionid=eq.${competitionId}` },
                () => {
                    // Use debounced soft refresh for realtime updates during high traffic
                    debouncedRefresh();
                    fetchOwnedTickets(); // Also refresh user's owned tickets
                }
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'pending_tickets', filter: `competition_id=eq.${competitionId}` },
                payload => {
                    // Reset stale reservations if they were confirmed/cancelled elsewhere
                    if (payload.new?.status && payload.new.status !== 'pending') {
                        setReservationId(null);
                        setReservationSuccess(null);
                    }
                    // Use debounced soft refresh for realtime updates during high traffic
                    debouncedRefresh();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [competitionId, debouncedRefresh, fetchOwnedTickets]);

    const [start, end] = activeFilter.key.split("-").map(Number);

    const handleTicketSelect = (ticket: number) => {
        setSelectedTickets((prev) => {
            // If already selected, allow deselection
            if (prev.includes(ticket)) {
                return prev.filter((t) => t !== ticket);
            }
            // Check if ticket is available
            if (!availableTickets.includes(ticket)) {
                return prev;
            }
            // Prevent selecting more tickets than are actually available
            // Use the real-time available count from state
            if (prev.length >= availableTickets.length) {
                return prev;
            }
            // Add to selection
            return [...prev, ticket];
        });
        // Clear any previous reservation when selection changes
        setReservationId(null);
        setReservationError(null);
        setReservationSuccess(null);
    };

    // Enhanced error clearing function
    const clearMessages = () => {
        setReservationError(null);
        setReservationSuccess(null);
    };

    // Reserve tickets using Base authentication - no automatic retries, let server decide availability
    const reserveTickets = async (): Promise<string | null> => {
        if (!baseUser?.id) {
            setReservationError("Please log in to reserve tickets");
            return null;
        }

        setReserving(true);
        clearMessages();

        try {
            // Make the reservation request - let the server decide availability
            let response: any;
            let error: any;

            try {
                console.log("[TicketSelector] Calling reserve_tickets endpoint");

                const result = await reserveTicketsWithRedundancy({
                    userId: baseUser.id,
                    competitionId: competitionId,
                    selectedTickets: selectedTickets,
                });

                response = result.data;
                error = result.error;

                if (error) {
                    console.log("[reserve_tickets] error:", error);
                }
            } catch (invokeError) {
                console.log("[reserve_tickets] caught exception:", invokeError);
                error = invokeError;
            }

            // Enhanced error handling for Supabase function responses
            if (error) {
                console.log("Function error details:", error);

                // Use the async parseReservationErrorAsync for better body parsing
                const parsedError = await parseReservationErrorAsync(error);

                // Handle HTTP 409 with unavailable tickets - remove them from UI and refresh
                if (parsedError.statusCode === 409 && parsedError.unavailableTickets && parsedError.unavailableTickets.length > 0) {
                    console.log("[TicketSelector] HTTP 409 - removing unavailable tickets:", parsedError.unavailableTickets);
                    
                    // Remove unavailable tickets from selection
                    setSelectedTickets(prev =>
                        prev.filter(t => !parsedError.unavailableTickets!.includes(t))
                    );
                    
                    // Refresh available tickets from server
                    const available = await database.getAvailableTicketsForCompetition(competitionId, totalTickets, baseUser.id);
                    setAvailableTickets(available);

                    // Show specific error message for 409 conflicts
                    setReservationError(parsedError.message);
                    return null;
                }

                throw new SupabaseFunctionError(
                    parsedError.message,
                    parsedError.statusCode,
                    error
                );
            }

            // Only show success on HTTP 200 with success: true
            if (response?.success !== true) {
                // Handle specific errors from the response
                if (response?.unavailableTickets?.length > 0) {
                    // Some tickets were taken - remove them from selection
                    setSelectedTickets(prev =>
                        prev.filter(t => !response.unavailableTickets.includes(t))
                    );
                    // Refresh available tickets
                    const available = await database.getAvailableTicketsForCompetition(competitionId, totalTickets, baseUser.id);
                    setAvailableTickets(available);
                    throw new Error(`Tickets ${response.unavailableTickets.join(", ")} are no longer available. Please select different tickets.`);
                }
                throw new Error(response?.error || "Failed to reserve tickets");
            }

            // Success - set reservation ID and success message
            const resId = response.reservationId || null;
            setReservationId(resId);
            setReservationSuccess("Tickets reserved! Complete payment within 15 minutes.");
            return resId;
        } catch (err) {
            // Enhanced error handling with user-friendly messages
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

    // Handle checkout - reserve tickets first, then show payment
    const handleCheckout = async () => {
        setShowCaptchaModal(true);
    };

    // After captcha success, reserve tickets then show payment modal directly
    const handleCaptchaSuccess = async () => {
        setShowCaptchaModal(false);

        // Clear previous messages
        clearMessages();

        // Double-check that tickets are selected (defensive check)
        if (selectedTickets.length === 0) {
            setReservationError("Please select at least one ticket before checkout.");
            return;
        }

        // Validate user is authenticated before attempting reservation
        if (!baseUser?.id) {
            setReservationError("Please log in to continue with checkout.");
            return;
        }

        // Reserve tickets before proceeding
        const resId = await reserveTickets();

        // Open payment modal directly after successful reservation
        if (resId) {
            setShowPaymentModal(true);
        } else if (!reservationError) {
            // If no reservation ID but also no error, something unexpected happened
            console.warn('[TicketSelectorWithTabs] Reservation returned null without setting an error');
            setReservationError("Unable to reserve tickets. Please try again or contact support.");
        }
    };

    if (loading) {
        return (
            <div className="max-w-5xl mx-auto border-[3px] border-[#DDE404] rounded-2xl text-white sm:p-8 p-4">
                <Loader />
            </div>
        );
    }

    // Error state UI for failed data loading
    if (loadingError) {
        return (
            <div className="max-w-5xl mx-auto border-[3px] border-[#DDE404] rounded-2xl text-white sm:p-8 p-4">
                <div className="text-center py-8">
                    <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <h3 className="text-white sequel-75 text-xl mb-2">Unable to Load Tickets</h3>
                    <p className="text-gray-400 sequel-45 mb-6 max-w-md mx-auto">
                        {loadingError}
                    </p>
                    <button
                        onClick={fetchAvailableTickets}
                        className="bg-[#DDE404] hover:bg-[#DDE404]/90 text-black sequel-75 uppercase px-8 py-3 rounded-lg transition-colors"
                    >
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto border-[3px] border-[#DDE404] rounded-2xl text-white sm:p-8 p-4 space-y-8">
            {/* Ticket Range Navigation */}
            <div className="space-y-4">
                {totalRangePages > 1 && (
                    <div className="flex justify-between items-center">
                        <button
                            onClick={handleRangePagePrev}
                            disabled={currentRangePage === 1}
                            className="bg-[#3c3d3c] hover:bg-[#DDE404] hover:text-black disabled:opacity-40 disabled:cursor-not-allowed text-white sequel-75 uppercase px-4 py-2 rounded-lg transition-colors text-sm flex items-center gap-2"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                            Previous
                        </button>
                        <span className="text-white/70 sequel-45 text-sm">
                            Range Page {currentRangePage} of {totalRangePages}
                        </span>
                        <button
                            onClick={handleRangePageNext}
                            disabled={currentRangePage === totalRangePages}
                            className="bg-[#3c3d3c] hover:bg-[#DDE404] hover:text-black disabled:opacity-40 disabled:cursor-not-allowed text-white sequel-75 uppercase px-4 py-2 rounded-lg transition-colors text-sm flex items-center gap-2"
                        >
                            Next
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                        </button>
                    </div>
                )}
                
                {/* Filter Tabs */}
                <FilterTabs
                    options={visibleRanges}
                    active={activeFilter}
                    onChange={setActiveFilter}
                    containerClasses="grid lg:grid-cols-5 sm:grid-cols-3 grid-cols-2 w-full justify-center gap-3"
                    buttonClasses="!sequel-75 sm:!text-base"
                />
            </div>

            {/* Ticket Grid with Pagination */}
            <TicketGrid
                start={start}
                end={end}
                availableTickets={availableTickets}
                selectedTickets={selectedTickets}
                ownedTickets={ownedTickets}
                onSelect={handleTicketSelect}
                maxSelectableCount={availableTickets.length}
            />

            {/* Footer */}
            <div className="space-y-4">
                {/* User's Owned Tickets Section */}
                {ownedTickets.length > 0 && (
                    <div className="bg-[#1E3A2F] rounded-xl p-4 sm:p-6 border border-green-500/30">
                        <div className="flex items-center gap-2 mb-3">
                            <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <h3 className="text-green-400 sequel-75 text-sm uppercase">Your Purchased Tickets ({ownedTickets.length})</h3>
                        </div>
                        <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto custom-scrollbar">
                            {ownedTickets.map(ticket => (
                                <span
                                    key={ticket}
                                    className="bg-green-500/20 text-green-300 sequel-75 text-sm px-3 py-1 rounded-md border border-green-500/30"
                                >
                                    {ticket}
                                </span>
                            ))}
                        </div>
                        <p className="text-green-300/60 sequel-45 text-xs mt-3">
                            These tickets are already in your account. They will appear in your dashboard entries.
                        </p>
                    </div>
                )}

                {/* Selection Summary Card */}
                <div className="bg-[#2A2A2A] rounded-xl p-4 sm:p-6">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div className="flex-1 w-full sm:w-auto">
                            <h3 className="text-white sequel-75 text-sm mb-2">Your Selection</h3>
                            <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto custom-scrollbar">
                                {selectedTickets.length > 0 ? (
                                    selectedTickets.map(ticket => (
                                        <span
                                            key={ticket}
                                            className="bg-[#DDE404] text-[#1A1A1A] sequel-75 text-sm px-3 py-1 rounded-md cursor-pointer hover:bg-[#DDE404]/80 transition-colors"
                                            onClick={() => handleTicketSelect(ticket)}
                                            title={`Click to remove ticket ${ticket}`}
                                        >
                                            {ticket}
                                        </span>
                                    ))
                                ) : (
                                    <span className="text-white/40 sequel-45 text-sm">No tickets selected</span>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-3 w-full sm:w-auto">
                            <button
                                onClick={fetchAvailableTickets}
                                className="bg-[#404040] hover:bg-[#555] text-white p-2.5 rounded-lg transition-colors"
                                disabled={loading}
                                title="Refresh available tickets"
                            >
                                <svg className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                            </button>
                            {selectedTickets.length > 0 && (
                                <button
                                    onClick={() => setSelectedTickets([])}
                                    className="bg-[#404040] hover:bg-red-500/20 hover:text-red-400 text-white/60 sequel-45 text-sm px-4 py-2.5 rounded-lg transition-colors"
                                >
                                    Clear All
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Checkout Bar */}
                <div className="bg-[#1A1A1A] border-2 border-[#DDE404] rounded-xl p-4 sm:p-6">
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div className="text-center sm:text-left">
                            <p className="text-white/60 sequel-45 text-sm">
                                {selectedTickets.length} ticket{selectedTickets.length !== 1 ? 's' : ''} selected
                                {availableTickets.length > 0 && (
                                    <span className="text-white/40 ml-2">(max {availableTickets.length})</span>
                                )}
                            </p>
                            <p className="text-[#DDE404] sequel-95 text-2xl sm:text-3xl">
                                ${(selectedTickets.length * ticketPrice).toFixed(2)}
                            </p>
                        </div>

                        <button
                            onClick={() => setShowCaptchaModal(true)}
                            className="bg-[#DDE404] hover:bg-[#DDE404]/90 disabled:bg-[#494949] disabled:cursor-not-allowed w-full sm:w-auto sequel-95 text-lg sm:text-xl text-[#1A1A1A] px-8 sm:px-12 py-4 rounded-xl uppercase transition-all hover:scale-[1.02]"
                            disabled={selectedTickets.length === 0}
                        >
                            {selectedTickets.length === 0 ? 'Select Tickets' : 'Checkout'}
                        </button>
                    </div>
                </div>

                {/* Maximum selection warning */}
                {selectedTickets.length >= availableTickets.length && availableTickets.length > 0 && (
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-3">
                        <p className="text-yellow-400 text-sm sequel-45 text-center">
                            You have selected all {availableTickets.length} available tickets
                        </p>
                    </div>
                )}

                {/* Enhanced Message Display - Only show ONE message at a time */}
                {reservationError && !reservationSuccess && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2.5">
                        <p className="text-red-400 text-xs sequel-45 text-center">
                            ⚠️ {reservationError}
                        </p>
                    </div>
                )}

                {reservationSuccess && !reservationError && (
                    <div className="bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-2.5">
                        <p className="text-green-400 text-xs sequel-45 text-center">
                            ✅ {reservationSuccess}
                        </p>
                    </div>
                )}

                {/* Reserving Indicator */}
                {reserving && (
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg px-4 py-2.5">
                        <p className="text-blue-400 text-xs sequel-45 text-center flex items-center justify-center gap-2">
                            <span className="animate-spin">⏳</span>
                            Reserving your tickets...
                        </p>
                    </div>
                )}

                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg px-4 py-2.5">
                    <p className="text-blue-300 text-xs sequel-45 text-center">
                        Pay with Base USDC for fast, low-fee transactions
                    </p>
                </div>
            </div>

            <CaptchaModal
                isOpen={showCaptchaModal}
                onClose={() => setShowCaptchaModal(false)}
                onSuccess={handleCaptchaSuccess}
            />

            <UserInfoModal
                isOpen={showUserInfoModal}
                onClose={() => setShowUserInfoModal(false)}
                ticketCount={selectedTickets.length}
                totalAmount={selectedTickets.length * ticketPrice}
                savedInfo={userInfo}
                onPayWithCrypto={(info) => {
                    setUserInfo(info);
                    setShowUserInfoModal(false);
                    setShowPaymentModal(true);
                }}
                onPayWithCard={(info) => {
                    // Card payment now routes to the main payment modal
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
                        ticketCount={selectedTickets.length}
                        competitionId={competitionId}
                        ticketPrice={ticketPrice}
                        userInfo={userInfo}
                        selectedTickets={selectedTickets}
                        reservationId={reservationId}
                        maxAvailableTickets={availableTickets.length}
                        onPaymentSuccess={() => {
                            // Refresh available tickets and owned tickets after successful payment
                            // Use soft refresh (no loading spinner) to prevent UI flash
                            fetchAvailableTickets(false);
                            fetchOwnedTickets();
                            // Clear the selection and messages
                            setSelectedTickets([]);
                            setReservationId(null);
                            setReservationSuccess(null);
                            setReservationError(null);
                        }}
                    />
                </Suspense>
            )}
        </div>
    );
};

export default TicketSelector;
