import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Ticket event types that can be received from the broadcast channel
 */
export type TicketEventType =
  | 'ticket_reserved'
  | 'ticket_sold'
  | 'ticket_released'
  | 'ticket_expired'
  | 'reservation_updated'
  | 'availability_sync';

/**
 * Stats payload included in ticket broadcast events
 */
export interface TicketStats {
  total_tickets: number;
  sold_count: number;
  pending_count: number;
  available_count: number;
}

/**
 * Ticket broadcast event payload
 */
export interface TicketBroadcastEvent {
  event: TicketEventType;
  competition_id: string;
  timestamp: string;
  stats: TicketStats;
  change?: {
    ticket_count: number;
    operation: 'INSERT' | 'UPDATE' | 'DELETE';
  };
  ticket_number?: number;
  reserved_count?: number;
}

/**
 * Options for the useTicketBroadcast hook
 */
export interface UseTicketBroadcastOptions {
  /** Competition ID to subscribe to */
  competitionId: string;
  /** Callback when any ticket event is received */
  onEvent?: (event: TicketBroadcastEvent) => void;
  /** Callback when tickets are reserved */
  onTicketReserved?: (event: TicketBroadcastEvent) => void;
  /** Callback when tickets are sold/confirmed */
  onTicketSold?: (event: TicketBroadcastEvent) => void;
  /** Callback when tickets are released */
  onTicketReleased?: (event: TicketBroadcastEvent) => void;
  /** Callback when reservation expires */
  onTicketExpired?: (event: TicketBroadcastEvent) => void;
  /** Enable console logging for debugging */
  debug?: boolean;
}

/**
 * Return type for the useTicketBroadcast hook
 */
export interface UseTicketBroadcastReturn {
  /** Current ticket stats */
  stats: TicketStats | null;
  /** Whether the subscription is active */
  isSubscribed: boolean;
  /** Any error that occurred */
  error: string | null;
  /** Timestamp of last received event */
  lastEventTime: Date | null;
  /** Last event type received */
  lastEventType: TicketEventType | null;
  /** Number of events received since subscription */
  eventCount: number;
  /** Manually reconnect to the channel */
  reconnect: () => void;
}

/**
 * Hook for subscribing to real-time ticket broadcast events for a competition.
 *
 * This hook subscribes to a Supabase broadcast channel that receives events
 * whenever tickets are reserved, sold, released, or expired for a competition.
 *
 * Unlike postgres_changes subscriptions which poll the database, this uses
 * lightweight broadcast events emitted by database triggers, providing
 * instant updates without additional database queries.
 *
 * @example
 * ```tsx
 * const { stats, isSubscribed, lastEventType } = useTicketBroadcast({
 *   competitionId: 'uuid-here',
 *   onTicketSold: (event) => {
 *     console.log('Ticket sold!', event.stats.available_count, 'left');
 *   },
 *   debug: true,
 * });
 *
 * return (
 *   <div>
 *     {isSubscribed && stats && (
 *       <p>{stats.available_count} tickets available</p>
 *     )}
 *   </div>
 * );
 * ```
 */
export function useTicketBroadcast(options: UseTicketBroadcastOptions): UseTicketBroadcastReturn {
  const {
    competitionId,
    onEvent,
    onTicketReserved,
    onTicketSold,
    onTicketReleased,
    onTicketExpired,
    debug = false,
  } = options;

  const [stats, setStats] = useState<TicketStats | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastEventTime, setLastEventTime] = useState<Date | null>(null);
  const [lastEventType, setLastEventType] = useState<TicketEventType | null>(null);
  const [eventCount, setEventCount] = useState(0);

  // Use refs for callbacks to avoid re-subscribing on callback changes
  const callbacksRef = useRef({ onEvent, onTicketReserved, onTicketSold, onTicketReleased, onTicketExpired });
  callbacksRef.current = { onEvent, onTicketReserved, onTicketSold, onTicketReleased, onTicketExpired };

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const log = useCallback(
    (...args: unknown[]) => {
      if (debug) {
        console.log('[TicketBroadcast]', ...args);
      }
    },
    [debug]
  );

  const handleEvent = useCallback(
    (payload: { payload: TicketBroadcastEvent }) => {
      const event = payload.payload;

      log('Received event:', event.event, event);

      // Update state
      if (event.stats) {
        setStats(event.stats);
      }
      setLastEventTime(new Date());
      setLastEventType(event.event);
      setEventCount((prev) => prev + 1);

      // Call callbacks
      const callbacks = callbacksRef.current;
      callbacks.onEvent?.(event);

      switch (event.event) {
        case 'ticket_reserved':
          callbacks.onTicketReserved?.(event);
          break;
        case 'ticket_sold':
          callbacks.onTicketSold?.(event);
          break;
        case 'ticket_released':
          callbacks.onTicketReleased?.(event);
          break;
        case 'ticket_expired':
          callbacks.onTicketExpired?.(event);
          break;
      }
    },
    [log]
  );

  const subscribe = useCallback(() => {
    if (!competitionId) {
      log('No competition ID provided, skipping subscription');
      return;
    }

    // Clean up existing channel
    if (channelRef.current) {
      log('Removing existing channel');
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const topic = `competition:${competitionId}:tickets`;
    log('Subscribing to channel:', topic);

    const channel = supabase.channel(topic);

    channel
      .on('broadcast', { event: 'ticket_reserved' }, handleEvent)
      .on('broadcast', { event: 'ticket_sold' }, handleEvent)
      .on('broadcast', { event: 'ticket_released' }, handleEvent)
      .on('broadcast', { event: 'ticket_expired' }, handleEvent)
      .on('broadcast', { event: 'reservation_updated' }, handleEvent)
      .on('broadcast', { event: 'availability_sync' }, handleEvent)
      .subscribe((status) => {
        log('Subscription status:', status);
        if (status === 'SUBSCRIBED') {
          setIsSubscribed(true);
          setError(null);
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          setIsSubscribed(false);
          setError(`Channel ${status.toLowerCase()}`);
        }
      });

    channelRef.current = channel;
  }, [competitionId, handleEvent, log]);

  const reconnect = useCallback(() => {
    log('Reconnecting...');
    setError(null);
    subscribe();
  }, [subscribe, log]);

  // Subscribe on mount and when competitionId changes
  useEffect(() => {
    subscribe();

    return () => {
      if (channelRef.current) {
        log('Cleaning up channel on unmount');
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [subscribe, log]);

  return {
    stats,
    isSubscribed,
    error,
    lastEventTime,
    lastEventType,
    eventCount,
    reconnect,
  };
}

/**
 * Hook that combines broadcast events with initial data fetch.
 *
 * This is a convenience hook that:
 * 1. Fetches initial ticket availability on mount
 * 2. Subscribes to broadcast events for real-time updates
 * 3. Returns merged state with the latest data
 *
 * @example
 * ```tsx
 * const { availableCount, soldCount, isLoading, lastUpdate } = useTicketAvailability({
 *   competitionId: 'uuid-here',
 * });
 *
 * return <div>{availableCount} tickets left</div>;
 * ```
 */
/**
 * Debounce function for availability refresh calls during high traffic
 */
function createDebouncedFunction<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      func(...args);
    }, wait);
  };
}

export function useTicketAvailability(options: {
  competitionId: string;
  onUpdate?: (stats: TicketStats) => void;
  /** Debounce time in ms for refresh calls (default: 300ms) */
  debounceMs?: number;
  /** Whether to refresh on page/tab focus (default: true) */
  refreshOnFocus?: boolean;
  debug?: boolean;
}): {
  totalTickets: number;
  soldCount: number;
  pendingCount: number;
  availableCount: number;
  isLoading: boolean;
  isSubscribed: boolean;
  error: string | null;
  lastUpdate: Date | null;
  refresh: () => Promise<void>;
} {
  const { competitionId, onUpdate, debounceMs = 300, refreshOnFocus = true, debug = false } = options;

  const [localStats, setLocalStats] = useState<TicketStats>({
    total_tickets: 0,
    sold_count: 0,
    pending_count: 0,
    available_count: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastFetchTime, setLastFetchTime] = useState<Date | null>(null);

  // Ref to track if component is mounted (prevents state updates after unmount)
  const isMountedRef = useRef(true);
  // Ref to store the onUpdate callback to avoid re-creating debounced function
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  // Subscribe to broadcast events
  const { stats: broadcastStats, isSubscribed, error: broadcastError, lastEventTime } = useTicketBroadcast({
    competitionId,
    onEvent: (event) => {
      if (event.stats) {
        setLocalStats(event.stats);
        onUpdateRef.current?.(event.stats);
      }
    },
    debug,
  });

  // Core fetch function (not debounced)
  const fetchData = useCallback(async () => {
    if (!competitionId || !isMountedRef.current) return;

    setIsLoading(true);
    try {
      // Call the text wrapper RPC to get accurate availability - avoids uuid = text type errors
      const { data, error } = await supabase.rpc('get_competition_ticket_availability_text', {
        competition_id_text: competitionId,
      });

      if (error) throw error;

      // Check for error responses from the RPC function
      // The RPC returns { error: "message" } when competition is not found or invalid
      if (data?.error) {
        throw new Error(data.error);
      }

      if (data && isMountedRef.current) {
        const stats: TicketStats = {
          total_tickets: data.total_tickets || 0,
          sold_count: data.sold_count || 0,
          pending_count: 0, // RPC doesn't return pending, calculate from available
          available_count: data.available_count || 0,
        };
        // Estimate pending from the difference
        stats.pending_count = Math.max(0, stats.total_tickets - stats.sold_count - stats.available_count);
        setLocalStats(stats);
        setLastFetchTime(new Date());
        onUpdateRef.current?.(stats);
      }
      if (isMountedRef.current) {
        setFetchError(null);
      }
    } catch (err) {
      console.error('[useTicketAvailability] Fetch error:', err);
      if (isMountedRef.current) {
        setFetchError(err instanceof Error ? err.message : 'Failed to fetch availability');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [competitionId]);

  // Create debounced refresh function for high traffic scenarios
  // This prevents excessive API calls when multiple rapid updates occur
  const debouncedRefresh = useRef(
    createDebouncedFunction(() => {
      fetchData();
    }, debounceMs)
  );

  // Update debounced function when debounceMs changes
  useEffect(() => {
    debouncedRefresh.current = createDebouncedFunction(() => {
      fetchData();
    }, debounceMs);
  }, [debounceMs, fetchData]);

  // Fetch on mount
  useEffect(() => {
    isMountedRef.current = true;
    fetchData();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchData]);

  // Refresh on page focus (tab becomes visible)
  // This ensures users see fresh availability when returning to the page
  useEffect(() => {
    if (!refreshOnFocus) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (debug) {
          console.log('[useTicketAvailability] Page focused, refreshing availability...');
        }
        // Use debounced refresh to prevent rapid calls if user switches tabs quickly
        debouncedRefresh.current();
      }
    };

    const handleWindowFocus = () => {
      if (debug) {
        console.log('[useTicketAvailability] Window focused, refreshing availability...');
      }
      // Use debounced refresh to prevent rapid calls
      debouncedRefresh.current();
    };

    // Listen for both visibility change and window focus for better coverage
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [refreshOnFocus, debug]);

  // Use broadcast stats if available, otherwise use local stats
  const currentStats = broadcastStats || localStats;
  const lastUpdate = lastEventTime || lastFetchTime;
  const error = broadcastError || fetchError;

  return {
    totalTickets: currentStats.total_tickets,
    soldCount: currentStats.sold_count,
    pendingCount: currentStats.pending_count,
    availableCount: currentStats.available_count,
    isLoading,
    isSubscribed,
    error,
    lastUpdate,
    refresh: fetchData,
  };
}

export default useTicketBroadcast;
