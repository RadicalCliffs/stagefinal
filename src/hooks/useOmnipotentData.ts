/**
 * useOmnipotentData Hook
 *
 * React hook for accessing the Omnipotent Data Service
 * Provides easy-to-use interface for fetching and managing data in components
 */

import { useState, useEffect, useCallback } from 'react';
import { omnipotentData, type OmnipotentCompetition, type OmnipotentEntry } from '../lib/omnipotent-data-service';
import { toPrizePid } from '../utils/userId';
import { reservationStorage } from '../lib/reservation-storage';
import { BalancePaymentService } from '../lib/balance-payment-service';

export interface UseOmnipotentDataOptions {
  autoFetch?: boolean;
  refreshInterval?: number;
  cacheEnabled?: boolean;
}

/**
 * Hook for fetching competitions
 */
export function useCompetitions(
  status?: 'active' | 'completed' | 'drawing' | 'drawn' | 'cancelled' | 'expired' | 'draft',
  options: UseOmnipotentDataOptions = {}
) {
  const [competitions, setCompetitions] = useState<OmnipotentCompetition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { autoFetch = true, refreshInterval, cacheEnabled = true } = options;

  const fetchCompetitions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await omnipotentData.getCompetitions(status, { useCache: cacheEnabled });
      setCompetitions(data);
    } catch (err) {
      setError(err as Error);
      console.error('[useCompetitions] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [status, cacheEnabled]);

  useEffect(() => {
    if (autoFetch) {
      fetchCompetitions();
    }
  }, [autoFetch, fetchCompetitions]);

  // Set up refresh interval if specified
  useEffect(() => {
    if (refreshInterval && refreshInterval > 0) {
      const interval = setInterval(fetchCompetitions, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [refreshInterval, fetchCompetitions]);

  return {
    competitions,
    loading,
    error,
    refetch: fetchCompetitions
  };
}

/**
 * Hook for fetching a single competition
 */
export function useCompetition(
  competitionId: string | undefined,
  options: UseOmnipotentDataOptions = {}
) {
  const [competition, setCompetition] = useState<OmnipotentCompetition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { autoFetch = true, refreshInterval, cacheEnabled = true } = options;

  const fetchCompetition = useCallback(async () => {
    if (!competitionId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await omnipotentData.getCompetition(competitionId, { useCache: cacheEnabled });
      setCompetition(data);
    } catch (err) {
      setError(err as Error);
      console.error('[useCompetition] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [competitionId, cacheEnabled]);

  useEffect(() => {
    if (autoFetch) {
      fetchCompetition();
    }
  }, [autoFetch, fetchCompetition]);

  // Set up refresh interval if specified
  useEffect(() => {
    if (refreshInterval && refreshInterval > 0 && competitionId) {
      const interval = setInterval(fetchCompetition, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [refreshInterval, competitionId, fetchCompetition]);

  return {
    competition,
    loading,
    error,
    refetch: fetchCompetition
  };
}

/**
 * Hook for fetching user entries
 */
export function useUserEntries(
  userIdentifier?: string,
  options: UseOmnipotentDataOptions = {}
) {
  const [entries, setEntries] = useState<OmnipotentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { autoFetch = true, refreshInterval, cacheEnabled = true } = options;

  // Convert to canonical format for consistent lookups
  const canonicalIdentifier = userIdentifier ? toPrizePid(userIdentifier) : undefined;

  const fetchEntries = useCallback(async () => {
    if (!canonicalIdentifier) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await omnipotentData.getUserEntries(canonicalIdentifier, { useCache: cacheEnabled });
      setEntries(data);
    } catch (err) {
      setError(err as Error);
      console.error('[useUserEntries] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [canonicalIdentifier, cacheEnabled]);

  useEffect(() => {
    if (autoFetch) {
      fetchEntries();
    }
  }, [autoFetch, fetchEntries]);

  // Set up refresh interval if specified
  useEffect(() => {
    if (refreshInterval && refreshInterval > 0 && canonicalIdentifier) {
      const interval = setInterval(fetchEntries, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [refreshInterval, canonicalIdentifier, fetchEntries]);

  return {
    entries,
    loading,
    error,
    refetch: fetchEntries
  };
}

/**
 * Hook for fetching competition entries (public view)
 */
export function useCompetitionEntries(
  competitionId: string | undefined,
  options: UseOmnipotentDataOptions = {}
) {
  const [entries, setEntries] = useState<OmnipotentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { autoFetch = true, refreshInterval, cacheEnabled = true } = options;

  const fetchEntries = useCallback(async () => {
    if (!competitionId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await omnipotentData.getCompetitionEntries(competitionId, { useCache: cacheEnabled });
      setEntries(data);
    } catch (err) {
      setError(err as Error);
      console.error('[useCompetitionEntries] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [competitionId, cacheEnabled]);

  useEffect(() => {
    if (autoFetch) {
      fetchEntries();
    }
  }, [autoFetch, fetchEntries]);

  // Set up refresh interval if specified
  useEffect(() => {
    if (refreshInterval && refreshInterval > 0 && competitionId) {
      const interval = setInterval(fetchEntries, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [refreshInterval, competitionId, fetchEntries]);

  return {
    entries,
    loading,
    error,
    refetch: fetchEntries
  };
}

/**
 * Hook for managing ticket reservations - NEW FLOW
 * 
 * Uses the new 3-endpoint balance payment system.
 * Features:
 * - Persistent storage across page refreshes (sessionStorage)
 * - Auto-recovery of reservations on mount
 * - Passive cleanup of expired reservations during retrieval
 */
export function useTicketReservation(competitionId: string | undefined) {
  const [reserving, setReserving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [unavailableTickets, setUnavailableTickets] = useState<number[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);

  // Auto-recover reservation from storage on mount
  useEffect(() => {
    if (!competitionId) return;

    const stored = reservationStorage.getReservation(competitionId);
    if (stored && stored.reservationId) {
      console.log('[useTicketReservation] Auto-recovered reservation:', stored.reservationId);
      setReservationId(stored.reservationId);
    }
  }, [competitionId]);

  // Fetch unavailable tickets
  const fetchUnavailableTickets = useCallback(async () => {
    if (!competitionId) return;

    try {
      setLoadingTickets(true);
      const tickets = await omnipotentData.getUnavailableTickets(competitionId);
      setUnavailableTickets(tickets);
    } catch (err) {
      console.error('[useTicketReservation] Error fetching unavailable tickets:', err);
    } finally {
      setLoadingTickets(false);
    }
  }, [competitionId]);

  // Load unavailable tickets on mount and when competitionId changes
  useEffect(() => {
    fetchUnavailableTickets();
  }, [fetchUnavailableTickets]);

  // Reserve tickets using new endpoint
  const reserveTickets = useCallback(async (
    userIdentifier: string,
    ticketNumbers: number[]
  ) => {
    if (!competitionId) {
      setError('Competition ID is required');
      return { success: false };
    }

    try {
      setReserving(true);
      setError(null);

      // Convert to canonical format for consistent reservation
      const canonicalUserId = toPrizePid(userIdentifier);

      // Use the new BalancePaymentService
      const result = await BalancePaymentService.reserveTickets({
        userId: canonicalUserId,
        competitionId,
        ticketNumbers
      });

      if (result.success && result.data) {
        const resId = result.data.reservation_id;
        setReservationId(resId);
        
        // CRITICAL: Store reservation in sessionStorage for persistence
        reservationStorage.storeReservation({
          reservationId: resId,
          competitionId,
          ticketNumbers: result.data.ticket_numbers,
          userId: canonicalUserId,
          expiresAt: new Date(result.data.expires_at).getTime()
        });
        
        // Refresh unavailable tickets after successful reservation
        await fetchUnavailableTickets();

        return { 
          success: true, 
          reservationId: resId,
          expiresAt: result.data.expires_at 
        };
      } else {
        setError(result.error || 'Reservation failed');
        return { success: false, error: result.error };
      }

    } catch (err: any) {
      const errorMessage = err.message || 'Failed to reserve tickets';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setReserving(false);
    }
  }, [competitionId, fetchUnavailableTickets]);

  // Clear reservation (call this after successful purchase)
  const clearReservation = useCallback(() => {
    if (competitionId) {
      reservationStorage.clearReservation(competitionId);
      setReservationId(null);
      console.log('[useTicketReservation] Cleared reservation');
    }
  }, [competitionId]);

  // Check if specific tickets are available
  const areTicketsAvailable = useCallback((ticketNumbers: number[]) => {
    return ticketNumbers.every(num => !unavailableTickets.includes(num));
  }, [unavailableTickets]);

  return {
    reserveTickets,
    reserving,
    error,
    reservationId,
    unavailableTickets,
    loadingTickets,
    refetchUnavailable: fetchUnavailableTickets,
    areTicketsAvailable,
    clearReservation
  };
}

/**
 * Hook for fetching available tickets for a competition
 * 
 * Features:
 * - Automatic fetching on mount and when parameters change
 * - Caching to prevent redundant queries (handled by OmnipotentDataService)
 * - Manual refresh capability
 * - Loading and error states
 * 
 * Note: Caching is always enabled by the OmnipotentDataService layer (3s TTL).
 * The cacheEnabled option is ignored for this hook.
 */
export function useAvailableTickets(
  competitionId: string | undefined,
  totalTickets: number,
  options: UseOmnipotentDataOptions = {}
) {
  const [availableTickets, setAvailableTickets] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { autoFetch = true, refreshInterval } = options;

  const fetchAvailableTickets = useCallback(async () => {
    if (!competitionId || !totalTickets) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      // Use omnipotent data service which handles caching automatically
      const tickets = await omnipotentData.getAvailableTickets(competitionId, totalTickets);
      setAvailableTickets(tickets);
      
    } catch (err) {
      setError(err as Error);
      console.error('[useAvailableTickets] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [competitionId, totalTickets]);

  useEffect(() => {
    if (autoFetch) {
      fetchAvailableTickets();
    }
  }, [autoFetch, fetchAvailableTickets]);

  // Set up refresh interval if specified
  useEffect(() => {
    if (refreshInterval && refreshInterval > 0 && competitionId && totalTickets) {
      const interval = setInterval(fetchAvailableTickets, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [refreshInterval, competitionId, totalTickets, fetchAvailableTickets]);

  return {
    availableTickets,
    availableCount: availableTickets.length,
    loading,
    error,
    refetch: fetchAvailableTickets
  };
}

/**
 * Hook for general data operations (cache management, etc.)
 */
export function useOmnipotentData() {
  const clearCache = useCallback((pattern?: string) => {
    omnipotentData.clearCache(pattern);
  }, []);

  const refresh = useCallback(async (type: 'competitions' | 'entries' | 'all' = 'all') => {
    await omnipotentData.refresh(type);
  }, []);

  const initialize = useCallback(async (userIdentifier?: string) => {
    // Convert to canonical format for consistent initialization
    const canonicalId = userIdentifier ? toPrizePid(userIdentifier) : undefined;
    await omnipotentData.initialize(canonicalId);
  }, []);

  return {
    clearCache,
    refresh,
    initialize
  };
}

/**
 * Example usage:
 * 
 * // In a component that displays competitions:
 * const { competitions, loading, error, refetch } = useCompetitions('active', {
 *   cacheEnabled: true,
 *   refreshInterval: 30000 // Refresh every 30 seconds
 * });
 * 
 * // In a component that shows user entries:
 * const { entries, loading } = useUserEntries(userWalletAddress);
 * 
 * // In a competition detail page:
 * const { competition, loading } = useCompetition(competitionId);
 * const { entries } = useCompetitionEntries(competitionId);
 * const { 
 *   reserveTickets, 
 *   reserving, 
 *   unavailableTickets,
 *   areTicketsAvailable 
 * } = useTicketReservation(competitionId);
 * 
 * // Reserve tickets:
 * const handleReserve = async () => {
 *   const result = await reserveTickets(userWalletAddress, [1, 2, 3]);
 *   if (result.success) {
 *     console.log('Reserved!', result.reservationId);
 *   }
 * };
 */
