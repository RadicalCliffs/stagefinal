/**
 * useLiveData - A hook for data that stays fresh via realtime + polling fallback
 *
 * Combines:
 * - Initial data fetch
 * - Supabase realtime subscriptions to multiple tables
 * - Polling fallback (realtime can silently disconnect)
 * - Debouncing to prevent hammering the database
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "../lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface UseLiveDataOptions<T> {
  /** Function to fetch the data */
  fetchFn: () => Promise<T>;
  /** Tables to subscribe to for realtime updates */
  tables: string[];
  /** Polling interval in ms (default: 30000) */
  pollInterval?: number;
  /** Debounce time in ms (default: 2000) */
  debounceMs?: number;
  /** Channel name prefix for debugging */
  channelName?: string;
}

interface UseLiveDataResult<T> {
  data: T | null;
  loading: boolean;
  refresh: () => void;
}

export function useLiveData<T>({
  fetchFn,
  tables,
  pollInterval = 30000,
  debounceMs = 2000,
  channelName = "live-data",
}: UseLiveDataOptions<T>): UseLiveDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const lastFetchRef = useRef<number>(0);
  const initialLoadDoneRef = useRef<boolean>(false);
  const fetchFnRef = useRef(fetchFn);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const isMountedRef = useRef(true);

  // Keep fetchFn ref up to date
  fetchFnRef.current = fetchFn;

  // Stable table key for dependency
  const tablesKey = useMemo(() => tables.sort().join(","), [tables]);

  // Fetch function that uses refs (stable, no dependencies)
  const fetchData = (force = false) => {
    const now = Date.now();
    if (!force && now - lastFetchRef.current < debounceMs) {
      return;
    }
    lastFetchRef.current = now;

    if (!initialLoadDoneRef.current) {
      setLoading(true);
    }

    fetchFnRef.current()
      .then((result) => {
        if (isMountedRef.current) {
          setData(result);
          setLoading(false);
          initialLoadDoneRef.current = true;
        }
      })
      .catch((error) => {
        console.error(`[${channelName}] Fetch error:`, error);
        if (isMountedRef.current) {
          setLoading(false);
          initialLoadDoneRef.current = true;
        }
      });
  };

  useEffect(() => {
    isMountedRef.current = true;

    // Initial fetch
    fetchData(true);

    // Clean up any existing channel
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    // Set up realtime subscription ONCE
    const channel = supabase.channel(`${channelName}-${Date.now()}`);

    tables.forEach((table) => {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload) => {
          console.log(`[${channelName}] ${table} changed:`, payload.eventType);
          fetchData();
        },
      );
    });

    channel.subscribe((status) => {
      console.log(`[${channelName}] Realtime status:`, status);
    });

    channelRef.current = channel;

    // Polling fallback
    const pollTimer = setInterval(() => {
      fetchData();
    }, pollInterval);

    return () => {
      isMountedRef.current = false;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      clearInterval(pollTimer);
    };
    // Only re-subscribe if tables actually change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tablesKey, channelName, pollInterval]);

  const refresh = () => {
    fetchData(true);
  };

  return { data, loading, refresh };
}
