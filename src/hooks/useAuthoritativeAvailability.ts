import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useTicketBroadcast, type TicketStats } from './useTicketBroadcast';

/**
 * RPC response from get_competition_ticket_availability_text
 */
interface TicketAvailabilityRPCResponse {
  competition_id: string;
  total_tickets: number;
  sold_count: number;
  available_count: number;
}

/**
 * Error response from RPC function
 */
interface RPCErrorResponse {
  error: string;
}

/**
 * Authoritative ticket availability state
 * Once RPC data is loaded, fallback values are never used
 */
export interface AuthoritativeAvailability {
  total_tickets: number;
  sold_count: number;
  pending_count: number;
  available_count: number;
  /** True if RPC fetch has succeeded at least once */
  isAuthoritative: boolean;
}

/**
 * Hook providing single source of truth for ticket availability
 * 
 * Key features:
 * - Prevents "bouncing" between computed/fallback values and RPC results
 * - Protects against stale out-of-order RPC responses
 * - Once RPC succeeds, never falls back to competition.tickets_sold
 * - Integrates with broadcast events for real-time updates
 * 
 * @example
 * ```tsx
 * const { availability, isLoading, refresh } = useAuthoritativeAvailability({
 *   competitionId: 'uuid-here',
 * });
 * 
 * // availability.isAuthoritative === true means data is from RPC
 * // Once true, fallback values are never used
 * ```
 */
export function useAuthoritativeAvailability(options: {
  competitionId: string;
  /** Enable debug logging */
  debug?: boolean;
}): {
  availability: AuthoritativeAvailability;
  isLoading: boolean;
  error: string | null;
  lastUpdate: Date | null;
  /** Manually refresh availability from RPC */
  refresh: () => Promise<void>;
} {
  const { competitionId, debug = false } = options;

  // Request ID to prevent out-of-order responses from overwriting fresher state
  const requestIdRef = useRef(0);
  
  // Track if we've ever successfully fetched from RPC
  const hasRpcSucceededRef = useRef(false);

  const [availability, setAvailability] = useState<AuthoritativeAvailability>({
    total_tickets: 0,
    sold_count: 0,
    pending_count: 0,
    available_count: 0,
    isAuthoritative: false,
  });
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  
  const isMountedRef = useRef(true);

  const log = useCallback(
    (...args: unknown[]) => {
      if (debug) {
        console.log('[AuthoritativeAvailability]', ...args);
      }
    },
    [debug]
  );

  /**
   * Core fetch function with stale-response protection
   */
  const fetchAvailability = useCallback(async () => {
    if (!competitionId || !isMountedRef.current) return;

    // Validate that competitionId is a full UUID (not a masked/prefix ID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(competitionId)) {
      const errorMsg = `Invalid competition ID format (not a full UUID): ${competitionId.substring(0, 8)}...`;
      log(errorMsg);
      setError(errorMsg);
      setIsLoading(false);
      return;
    }

    // Increment request ID to track this request
    const thisRequestId = ++requestIdRef.current;
    log(`Fetching availability for competition ${competitionId} (request #${thisRequestId})...`);

    setIsLoading(true);
    
    try {
      // Call authoritative RPC function
      const { data, error: rpcError } = await supabase.rpc('get_competition_ticket_availability_text', {
        competition_id_text: competitionId,
      });

      if (rpcError) {
        log(`RPC error (request #${thisRequestId}):`, {
          competitionId,
          error: rpcError.message,
          code: rpcError.code,
          details: rpcError.details,
          hint: rpcError.hint
        });
        throw rpcError;
      }

      // Check if this response is stale (another request was made after this one)
      if (thisRequestId !== requestIdRef.current) {
        log(`Discarding stale response #${thisRequestId} (current is #${requestIdRef.current})`);
        return;
      }

      // Check for RPC-level errors
      if (data && typeof data === 'object' && 'error' in data) {
        const errorData = data as RPCErrorResponse;
        log(`RPC returned error response (request #${thisRequestId}):`, {
          competitionId,
          error: errorData.error
        });
        throw new Error(errorData.error);
      }

      // Check for no data returned
      if (!data) {
        const errorMsg = 'RPC returned no data';
        log(`${errorMsg} (request #${thisRequestId}):`, { competitionId });
        throw new Error(errorMsg);
      }

      if (isMountedRef.current) {
        const rpcData = data as TicketAvailabilityRPCResponse;
        const stats: AuthoritativeAvailability = {
          total_tickets: rpcData.total_tickets || 0,
          sold_count: rpcData.sold_count || 0,
          pending_count: 0, // Estimated from difference
          available_count: rpcData.available_count || 0,
          isAuthoritative: true, // Mark as authoritative once RPC succeeds
        };
        
        // Estimate pending count
        stats.pending_count = Math.max(0, stats.total_tickets - stats.sold_count - stats.available_count);
        
        log(`RPC success (request #${thisRequestId}):`, {
          competitionId,
          stats
        });
        
        setAvailability(stats);
        setLastUpdate(new Date());
        setError(null);
        hasRpcSucceededRef.current = true;
      }
    } catch (err) {
      log(`Fetch error (request #${thisRequestId}):`, {
        competitionId,
        error: err instanceof Error ? err.message : String(err),
        errorObj: err
      });
      
      // Check if this response is stale
      if (thisRequestId !== requestIdRef.current) {
        log(`Discarding stale error #${thisRequestId} (current is #${requestIdRef.current})`);
        return;
      }

      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to fetch availability');
        
        // Only set loading to false if we haven't succeeded before
        // Keep showing last known good data if we have it
        if (!hasRpcSucceededRef.current) {
          setIsLoading(false);
        }
      }
    } finally {
      // Only clear loading if this is still the current request
      if (thisRequestId === requestIdRef.current && isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [competitionId, log]);

  /**
   * Handle broadcast events - always authoritative when received
   */
  const handleBroadcastEvent = useCallback((stats: TicketStats) => {
    log('Broadcast event received:', stats);
    
    setAvailability({
      total_tickets: stats.total_tickets,
      sold_count: stats.sold_count,
      pending_count: stats.pending_count,
      available_count: stats.available_count,
      isAuthoritative: true, // Broadcast events are authoritative
    });
    setLastUpdate(new Date());
    setError(null);
    hasRpcSucceededRef.current = true;
  }, [log]);

  // Subscribe to broadcast events
  useTicketBroadcast({
    competitionId,
    onEvent: (event) => {
      if (event.stats) {
        handleBroadcastEvent(event.stats);
      }
    },
    debug,
  });

  // Fetch on mount and when competitionId changes
  useEffect(() => {
    isMountedRef.current = true;
    requestIdRef.current = 0;
    hasRpcSucceededRef.current = false;
    
    fetchAvailability();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchAvailability]);

  return {
    availability,
    isLoading,
    error,
    lastUpdate,
    refresh: fetchAvailability,
  };
}
