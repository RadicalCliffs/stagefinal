/**
 * useOmnipotentData Hook
 *
 * React hook for accessing the Omnipotent Data Service
 * Provides easy-to-use interface for fetching and managing data in components
 */

import { useState, useEffect, useCallback } from 'react';
import { omnipotentData, type OmnipotentCompetition, type OmnipotentEntry } from '../lib/omnipotent-data-service';
import { toPrizePid } from '../utils/userId';

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
 * Hook for managing ticket reservations
 */
export function useTicketReservation(competitionId: string | undefined) {
  const [reserving, setReserving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [unavailableTickets, setUnavailableTickets] = useState<number[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);

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

  // Reserve tickets
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

      const result = await omnipotentData.reserveTickets(
        canonicalUserId,
        competitionId,
        ticketNumbers
      );

      if (result.success) {
        setReservationId(result.reservationId || null);
        // Refresh unavailable tickets after successful reservation
        await fetchUnavailableTickets();
      } else {
        setError(result.error || 'Reservation failed');
      }

      return result;

    } catch (err: any) {
      const errorMessage = err.message || 'Failed to reserve tickets';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setReserving(false);
    }
  }, [competitionId, fetchUnavailableTickets]);

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
    areTicketsAvailable
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
