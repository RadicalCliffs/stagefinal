/**
 * useLiveData - A hook for data that stays fresh via realtime + polling fallback
 * 
 * Combines:
 * - Initial data fetch
 * - Supabase realtime subscriptions to multiple tables
 * - Polling fallback (realtime can silently disconnect)
 * - Debouncing to prevent hammering the database
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

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
  channelName = 'live-data',
}: UseLiveDataOptions<T>): UseLiveDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const lastFetchRef = useRef<number>(0);
  const initialLoadDoneRef = useRef<boolean>(false);

  const fetchData = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastFetchRef.current < debounceMs) {
      return;
    }
    lastFetchRef.current = now;

    if (!initialLoadDoneRef.current) {
      setLoading(true);
    }

    try {
      const result = await fetchFn();
      setData(result);
    } catch (error) {
      console.error(`[${channelName}] Fetch error:`, error);
    } finally {
      setLoading(false);
      initialLoadDoneRef.current = true;
    }
  }, [fetchFn, debounceMs, channelName]);

  useEffect(() => {
    // Initial fetch
    fetchData(true);

    // Set up realtime subscriptions for all tables
    let channel: RealtimeChannel = supabase.channel(`${channelName}-${Date.now()}`);
    
    tables.forEach(table => {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload) => {
          console.log(`[${channelName}] ${table} changed:`, payload.eventType);
          fetchData();
        }
      );
    });

    channel.subscribe((status) => {
      console.log(`[${channelName}] Realtime status:`, status);
    });

    // Polling fallback
    const pollTimer = setInterval(() => {
      console.log(`[${channelName}] Polling refresh`);
      fetchData();
    }, pollInterval);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollTimer);
    };
  }, [fetchData, tables, pollInterval, channelName]);

  const refresh = useCallback(() => {
    fetchData(true);
  }, [fetchData]);

  return { data, loading, refresh };
}
