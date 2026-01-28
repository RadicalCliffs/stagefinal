/**
 * Enhanced Ticket Reservation Hook with Guards and State Machine
 * 
 * Provides reliable ticket reservation with:
 * - Balance guards to prevent insufficient funds
 * - Reservation guards to verify server state
 * - State machine for clear flow
 * - Idempotency for safe retries
 * - Realtime event verification
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuthUser } from '../contexts/AuthContext';
import { toPrizePid } from '../utils/userId';
import { omnipotentData } from '../lib/omnipotent-data-service';
import { reservationStorage } from '../lib/reservation-storage';
import { ReservationStateMachineManager } from '../lib/reservation-state-machine';
import { idempotencyKeyManager } from '../lib/idempotency-keys';
import { useRealtimeWithGuards } from './useSupabaseRealtime';
import type { ReservationStateMachine } from '../lib/guards/types';

export interface EnhancedReservationOptions {
  competitionId: string | undefined;
  ticketPrice: number;
  enableGuards?: boolean;
}

export function useEnhancedReservation(options: EnhancedReservationOptions) {
  const { competitionId, ticketPrice, enableGuards = true } = options;
  const { baseUser } = useAuthUser();
  const userId = baseUser?.id;
  
  // State machine for reservation flow
  const stateMachine = useMemo(() => new ReservationStateMachineManager(), []);
  const [state, setState] = useState<ReservationStateMachine>(stateMachine.getState());
  
  // Realtime with guards
  const { isReady, guards, balanceGuard, reservationGuard } = useRealtimeWithGuards(userId || null);
  
  // Local state
  const [error, setError] = useState<string | null>(null);
  const [unavailableTickets, setUnavailableTickets] = useState<number[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [retrying, setRetrying] = useState(false);

  // Subscribe to state machine changes
  useEffect(() => {
    const unsubscribe = stateMachine.subscribe((newState) => {
      setState(newState);
      if (newState.error) {
        setError(newState.error);
      }
    });
    return unsubscribe;
  }, [stateMachine]);

  // Auto-recover reservation from storage on mount
  useEffect(() => {
    if (!competitionId || !userId) return;

    const stored = reservationStorage.getReservation(competitionId);
    if (stored && stored.reservationId) {
      console.log('[EnhancedReservation] Auto-recovered reservation:', stored.reservationId);
      
      // Verify the reservation is still valid
      verifyStoredReservation(stored.reservationId);
    }
  }, [competitionId, userId]);

  // Fetch unavailable tickets
  const fetchUnavailableTickets = useCallback(async () => {
    if (!competitionId) return;

    try {
      setLoadingTickets(true);
      const tickets = await omnipotentData.getUnavailableTickets(competitionId);
      setUnavailableTickets(tickets);
    } catch (err) {
      console.error('[EnhancedReservation] Error fetching unavailable tickets:', err);
    } finally {
      setLoadingTickets(false);
    }
  }, [competitionId]);

  useEffect(() => {
    fetchUnavailableTickets();
  }, [fetchUnavailableTickets]);

  // Verify stored reservation is still valid
  const verifyStoredReservation = async (reservationId: string) => {
    try {
      const { data, error: fetchError } = await omnipotentData.supabase
        .from('pending_tickets')
        .select('*')
        .eq('id', reservationId)
        .single();

      if (fetchError || !data) {
        console.log('[EnhancedReservation] Stored reservation not found, clearing');
        if (competitionId) {
          reservationStorage.clearReservation(competitionId);
        }
        stateMachine.reset();
        return;
      }

      if (data.status === 'expired' || new Date(data.expires_at) < new Date()) {
        console.log('[EnhancedReservation] Stored reservation expired');
        stateMachine.reservationExpired();
        if (competitionId) {
          reservationStorage.clearReservation(competitionId);
        }
        return;
      }

      if (data.status === 'pending') {
        console.log('[EnhancedReservation] Stored reservation is valid');
        stateMachine.reservationCreated(reservationId);
      }
    } catch (err) {
      console.error('[EnhancedReservation] Error verifying stored reservation:', err);
    }
  };

  /**
   * Reserve tickets with guards
   */
  const reserveTickets = useCallback(
    async (ticketNumbers: number[]) => {
      if (!competitionId || !userId) {
        setError('Missing competition ID or user ID');
        return { success: false, error: 'Missing competition ID or user ID' };
      }

      if (!stateMachine.canReserve()) {
        setError('Cannot reserve in current state: ' + state.state);
        return { success: false, error: 'Cannot reserve in current state' };
      }

      const totalAmount = ticketNumbers.length * ticketPrice;
      const canonicalUserId = toPrizePid(userId);

      try {
        setError(null);
        
        // Step 1: Check balance guard (if enabled and ready)
        if (enableGuards && isReady.balances) {
          try {
            guards.requireAvailable(totalAmount);
            console.log('[EnhancedReservation] Balance guard passed');
          } catch (guardError: any) {
            console.error('[EnhancedReservation] Balance guard failed:', guardError.message);
            setError(guardError.message);
            return { success: false, error: guardError.message };
          }
        } else if (enableGuards && !isReady.balances) {
          console.warn('[EnhancedReservation] Balance channel not ready, skipping guard check');
        }

        // Step 2: Start reservation in state machine
        stateMachine.startReservation(totalAmount);

        // Step 3: Call server to reserve tickets
        console.log('[EnhancedReservation] Calling server to reserve tickets');
        const result = await omnipotentData.reserveTickets(
          canonicalUserId,
          competitionId,
          ticketNumbers
        );

        if (!result.success || !result.reservationId) {
          stateMachine.reservationFailed(result.error || 'Reservation failed');
          setError(result.error || 'Reservation failed');
          return result;
        }

        // Step 4: Wait for reservation_created event and verify (if guards enabled)
        if (enableGuards && reservationGuard) {
          try {
            console.log('[EnhancedReservation] Waiting for reservation confirmation');
            await reservationGuard.awaitReservationCreated(
              result.reservationId,
              totalAmount,
              {
                timeoutMs: 5000,
                verifyDb: true,
                requirePendingBalance: true,
              }
            );
            console.log('[EnhancedReservation] Reservation confirmed by guards');
          } catch (guardError: any) {
            console.error('[EnhancedReservation] Reservation verification failed:', guardError.message);
            stateMachine.reservationFailed(guardError.message);
            setError(guardError.message);
            return { success: false, error: guardError.message };
          }
        }

        // Step 5: Mark as created in state machine
        stateMachine.reservationCreated(result.reservationId);

        // Step 6: Store in sessionStorage
        reservationStorage.storeReservation({
          reservationId: result.reservationId,
          competitionId,
          ticketNumbers,
          userId: canonicalUserId,
          expiresAt: result.expiresAt ? new Date(result.expiresAt).getTime() : undefined,
        });

        // Step 7: Refresh unavailable tickets
        await fetchUnavailableTickets();

        return result;
      } catch (err: any) {
        const errorMessage = err.message || 'Failed to reserve tickets';
        console.error('[EnhancedReservation] Error:', errorMessage);
        stateMachine.reservationFailed(errorMessage);
        setError(errorMessage);
        return { success: false, error: errorMessage };
      }
    },
    [
      competitionId,
      userId,
      ticketPrice,
      enableGuards,
      isReady,
      guards,
      reservationGuard,
      stateMachine,
      fetchUnavailableTickets,
      state.state,
    ]
  );

  /**
   * Initiate payment with idempotency
   */
  const initiatePayment = useCallback(async () => {
    if (!state.reservationId) {
      setError('No active reservation');
      return { success: false, error: 'No active reservation' };
    }

    if (!stateMachine.canPay()) {
      setError('Cannot pay in current state: ' + state.state);
      return { success: false, error: 'Cannot pay in current state' };
    }

    try {
      setError(null);
      setRetrying(false);

      // Get or create idempotency key
      const idempotencyKey = idempotencyKeyManager.getOrCreateKey(state.reservationId);
      console.log('[EnhancedReservation] Using idempotency key:', idempotencyKey);

      // Check pending balance guard
      if (enableGuards && isReady.balances) {
        try {
          await guards.requirePending(state.totalAmount, state.reservationId);
          console.log('[EnhancedReservation] Pending balance guard passed');
        } catch (guardError: any) {
          console.error('[EnhancedReservation] Pending balance guard failed:', guardError.message);
          setError(guardError.message);
          return { success: false, error: guardError.message };
        }
      }

      // Start payment in state machine
      stateMachine.startPayment(idempotencyKey);

      // Call payment endpoint (this would be your actual payment flow)
      // For now, we're just marking the transition
      console.log('[EnhancedReservation] Payment initiated with key:', idempotencyKey);

      return { success: true, idempotencyKey };
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to initiate payment';
      console.error('[EnhancedReservation] Payment error:', errorMessage);
      stateMachine.paymentFailed(errorMessage);
      setError(errorMessage);
      return { success: false, error: errorMessage };
    }
  }, [
    state.reservationId,
    state.totalAmount,
    state.state,
    enableGuards,
    isReady,
    guards,
    stateMachine,
  ]);

  /**
   * Retry payment with same idempotency key
   */
  const retryPayment = useCallback(async () => {
    setRetrying(true);
    const result = await initiatePayment();
    setRetrying(false);
    return result;
  }, [initiatePayment]);

  /**
   * Clear reservation and reset
   */
  const clearReservation = useCallback(() => {
    if (competitionId) {
      reservationStorage.clearReservation(competitionId);
    }
    if (state.reservationId) {
      idempotencyKeyManager.clearKey(state.reservationId);
    }
    stateMachine.reset();
    setError(null);
    console.log('[EnhancedReservation] Cleared reservation and reset state');
  }, [competitionId, state.reservationId, stateMachine]);

  /**
   * Check if specific tickets are available
   */
  const areTicketsAvailable = useCallback(
    (ticketNumbers: number[]) => {
      return ticketNumbers.every((num) => !unavailableTickets.includes(num));
    },
    [unavailableTickets]
  );

  return {
    // State
    state,
    error,
    unavailableTickets,
    loadingTickets,
    retrying,
    
    // Ready states
    isReady,
    canReserve: stateMachine.canReserve(),
    canPay: stateMachine.canPay(),
    isProcessing: stateMachine.isProcessing(),
    
    // Actions
    reserveTickets,
    initiatePayment,
    retryPayment,
    clearReservation,
    refetchUnavailable: fetchUnavailableTickets,
    areTicketsAvailable,
    
    // Guards (for advanced use)
    guards,
    balanceGuard,
    reservationGuard,
  };
}
