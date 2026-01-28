/**
 * React Hook for Supabase Realtime Subscriptions
 * 
 * Provides React hooks for subscribing to Supabase realtime updates.
 * Automatically handles cleanup on component unmount.
 * 
 * Usage:
 * ```typescript
 * // Subscribe to a single table
 * useSupabaseRealtime('tickets', {
 *   onInsert: (payload) => setTickets(prev => [...prev, payload.new])
 * });
 * 
 * // Subscribe with filter
 * useSupabaseRealtime('tickets', {
 *   onInsert: refreshTickets
 * }, `competition_id=eq.${competitionId}`);
 * 
 * // Subscribe to multiple tables
 * useSupabaseRealtimeMultiple([
 *   { table: 'tickets', handlers: { onInsert: handleTicket } },
 *   { table: 'winners', handlers: { onInsert: handleWinner } }
 * ]);
 * ```
 */

import { useEffect, useMemo } from 'react';
import {
  subscribeToTable,
  subscribeToMultipleTables,
  subscribeToTableChanges,
  type RealtimeHandlers,
  type SubscribableTable,
} from '../lib/supabase-realtime';

/**
 * Hook to subscribe to a single table's realtime changes
 * 
 * @param tableName - Name of the table to subscribe to
 * @param handlers - Object with onInsert, onUpdate, onDelete handlers
 * @param filter - Optional filter string
 * @param enabled - Whether subscription is enabled (default: true)
 */
export function useSupabaseRealtime<T = any>(
  tableName: SubscribableTable,
  handlers: RealtimeHandlers<T>,
  filter?: string,
  enabled: boolean = true
): void {
  // Memoize handlers to avoid re-subscribing on every render
  const memoizedHandlers = useMemo(() => handlers, [
    handlers.onInsert,
    handlers.onUpdate,
    handlers.onDelete
  ]);

  useEffect(() => {
    if (!enabled) return;

    const unsubscribe = subscribeToTable(tableName, memoizedHandlers, filter);

    return () => {
      unsubscribe();
    };
  }, [tableName, filter, enabled, memoizedHandlers]);
}

/**
 * Hook to subscribe to multiple tables' realtime changes
 * 
 * @param subscriptions - Array of subscription configurations
 * @param enabled - Whether subscriptions are enabled (default: true)
 */
export function useSupabaseRealtimeMultiple(
  subscriptions: Array<{
    table: SubscribableTable;
    handlers: RealtimeHandlers;
    filter?: string;
  }>,
  enabled: boolean = true
): void {
  useEffect(() => {
    if (!enabled) return;

    const unsubscribe = subscribeToMultipleTables(subscriptions);

    return () => {
      unsubscribe();
    };
  }, [subscriptions, enabled]);
}

/**
 * Hook to subscribe to any change on a table (INSERT, UPDATE, or DELETE)
 * Useful when you just want to refresh data on any change
 * 
 * @param tableName - Name of the table to subscribe to
 * @param onAnyChange - Function to call on any change
 * @param filter - Optional filter string
 * @param enabled - Whether subscription is enabled (default: true)
 */
export function useSupabaseRealtimeRefresh(
  tableName: SubscribableTable,
  onAnyChange: () => void,
  filter?: string,
  enabled: boolean = true
): void {
  useEffect(() => {
    if (!enabled) return;

    const unsubscribe = subscribeToTableChanges(
      tableName,
      () => onAnyChange(),
      filter
    );

    return () => {
      unsubscribe();
    };
  }, [tableName, onAnyChange, filter, enabled]);
}
