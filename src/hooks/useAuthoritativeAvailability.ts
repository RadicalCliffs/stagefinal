import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useTicketBroadcast, type TicketStats } from './useTicketBroadcast';

export interface AuthoritativeAvailability {
  total_tickets: number;
  sold_count: number;
  pending_count: number;
  available_count: number;
  isAuthoritative: boolean;
}

export function useAuthoritativeAvailability(options: {
  competitionId: string;
  debug?: boolean;
}): {
  availability: AuthoritativeAvailability;
  isLoading: boolean;
  error: string | null;
  lastUpdate: Date | null;
  refresh: () => Promise<void>;
} {
  const { competitionId, debug = false } = options;

  const requestIdRef = useRef(0);
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
      if (debug) console.log('[AuthoritativeAvailability]', ...args);
    },
    [debug]
  );

  const fetchAvailability = useCallback(async () => {
    if (!competitionId || !isMountedRef.current) return;

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(competitionId)) {
      const errorMsg = `Invalid competition ID format (not a full UUID): ${competitionId.substring(
        0,
        8
      )}...`;
      log(`UUID validation failed for competition ${competitionId}`);
      setError(errorMsg);
      setIsLoading(false);
      return;
    }

    const thisRequestId = ++requestIdRef.current;
    log(
      `Fetching availability from v_competition_ticket_stats for ${competitionId} (request #${thisRequestId})...`
    );
    setIsLoading(true);

    try {
      const { data, error: viewErr } = await supabase
        .from('v_competition_ticket_stats')
        .select('competition_id,sold,held,total')
        .eq('competition_id', competitionId)
        .maybeSingle();

      if (viewErr) throw viewErr;

      if (thisRequestId !== requestIdRef.current) {
        log(
          `Discarding stale response #${thisRequestId} (current is #${requestIdRef.current})`
        );
        return;
      }

      const total = Number(data?.total ?? 0);
      const sold = Number(data?.sold ?? 0);
      const held = Number(data?.held ?? 0);
      const available = Math.max(0, total - sold - held);

      if (isMountedRef.current) {
        const next: AuthoritativeAvailability = {
          total_tickets: total,
          sold_count: sold,
          pending_count: held,
          available_count: available,
          isAuthoritative: true,
        };

        log(`Fetch success (request #${thisRequestId}):`, {
          competitionId,
          next,
        });

        setAvailability(next);
        setLastUpdate(new Date());
        setError(null);
        hasRpcSucceededRef.current = true;
      }
    } catch (err) {
      log(`Fetch error (request #${thisRequestId}):`, {
        competitionId,
        error: err instanceof Error ? err.message : String(err),
        errorObj: err,
      });

      if (thisRequestId !== requestIdRef.current) {
        log(
          `Discarding stale error #${thisRequestId} (current is #${requestIdRef.current})`
        );
        return;
      }

      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to fetch availability');
        if (!hasRpcSucceededRef.current) setIsLoading(false);
      }
    } finally {
      if (thisRequestId === requestIdRef.current && isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [competitionId, log]);

  const handleBroadcastEvent = useCallback(
    (stats: TicketStats) => {
      log('Broadcast event received:', stats);
      setAvailability({
        total_tickets: stats.total_tickets,
        sold_count: stats.sold_count,
        pending_count: stats.pending_count,
        available_count: stats.available_count,
        isAuthoritative: true,
      });
      setLastUpdate(new Date());
      setError(null);
      hasRpcSucceededRef.current = true;
    },
    [log]
  );

  useTicketBroadcast({
    competitionId,
    onEvent: (event) => {
      if (event.stats) handleBroadcastEvent(event.stats);
    },
    debug,
  });

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
