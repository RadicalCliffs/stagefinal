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

import { useEffect, useMemo, useState, useRef } from 'react';
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
 * @param handlers - Object with onInsert, onUpdate, onDelete handlers (should be memoized with useMemo or useCallback)
 * @param filter - Optional filter string
 * @param enabled - Whether subscription is enabled (default: true)
 */
export function useSupabaseRealtime<T = any>(
  tableName: SubscribableTable,
  handlers: RealtimeHandlers<T>,
  filter?: string,
  enabled: boolean = true
): void {
  useEffect(() => {
    if (!enabled) return;

    const unsubscribe = subscribeToTable(tableName, handlers, filter);

    return () => {
      unsubscribe();
    };
  }, [tableName, filter, enabled, handlers]);
}

/**
 * Hook to subscribe to multiple tables' realtime changes
 * 
 * @param subscriptions - Array of subscription configurations (should be memoized with useMemo)
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
    if (!enabled || !subscriptions.length) return;

    const unsubscribe = subscribeToMultipleTables(subscriptions);

    return () => {
      unsubscribe();
    };
    // Note: subscriptions array should be memoized by caller to prevent unnecessary re-subscriptions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, JSON.stringify(subscriptions.map(s => ({ table: s.table, filter: s.filter })))]);
}

/**
 * Hook to subscribe to any change on a table (INSERT, UPDATE, or DELETE)
 * Useful when you just want to refresh data on any change
 * 
 * @param tableName - Name of the table to subscribe to
 * @param onAnyChange - Function to call on any change (should be memoized with useCallback)
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

/**
 * ============================================================================
 * Enhanced Hooks with Ready States and Guards
 * ============================================================================
 */

import {
  subscribeToTableWithState,
  subscribeToBroadcast,
  isChannelReady,
  type ChannelState,
} from '../lib/supabase-realtime';
import { BalanceGuard } from '../lib/guards/BalanceGuard';
import { ReservationGuard } from '../lib/guards/ReservationGuard';
import type { BalanceSnapshot, PurchaseEvent, ReservationRow } from '../lib/guards/types';
import { supabase } from '../lib/supabase';

export interface RealtimeReadyStates {
  balances: boolean;
  purchases: boolean;
  entries: boolean;
  tickets: boolean;
}

export interface RealtimeLatestData {
  balances: BalanceSnapshot | null;
  reservation: any | null;
  payment: any | null;
  tickets: any[] | null;
  user_transactions: any[] | null;
}

export interface RealtimeGuards {
  requireAvailable: (amount: number) => void;
  requirePending: (amount: number, reservationId?: string) => Promise<void>;
}

/**
 * Enhanced hook for managing realtime subscriptions with ready states and guards
 * 
 * Usage:
 * ```typescript
 * const { isReady, latest, guards } = useRealtimeWithGuards(userId);
 * 
 * // Wait for channels to be ready before showing UI
 * if (!isReady.balances) return <Loading />;
 * 
 * // Use guards before operations
 * try {
 *   guards.requireAvailable(totalAmount);
 *   await reserveTickets();
 * } catch (err) {
 *   console.error('Guard check failed:', err);
 * }
 * ```
 */
export function useRealtimeWithGuards(userId: string | null) {
  const [isReady, setIsReady] = useState<RealtimeReadyStates>({
    balances: false,
    purchases: false,
    entries: false,
    tickets: false,
  });

  const [latest, setLatest] = useState<RealtimeLatestData>({
    balances: null,
    reservation: null,
    payment: null,
    tickets: null,
    user_transactions: null,
  });

  // Balance guard instance - create once with stable reference
  const latestRef = useRef(latest);
  latestRef.current = latest;
  
  const balanceGuard = useMemo(() => {
    return new BalanceGuard({
      getLatest: () => latestRef.current.balances,
      subscribe: (handler) => {
        const interval = setInterval(() => {
          if (latestRef.current.balances) {
            handler(latestRef.current.balances);
          }
        }, 100);
        return () => clearInterval(interval);
      },
    });
  }, []); // Empty deps - create only once

  // Reservation guard instance
  const reservationGuard = useMemo(() => {
    return new ReservationGuard({
      balances: balanceGuard,
      events: {
        subscribe: (handler) => {
          // This will be connected to purchase broadcast events
          const unsubscribe = subscribeToBroadcast<PurchaseEvent>(
            `user:${userId}:purchases`,
            'purchase_event',
            handler
          );
          return unsubscribe;
        },
      },
      repo: {
        fetchReservation: async (reservationId: string) => {
          const { data, error } = await supabase
            .from('pending_tickets')
            .select('*')
            .eq('id', reservationId)
            .single();
          
          if (error || !data) return null;
          
          return {
            id: data.id,
            status: data.status as 'pending' | 'confirmed' | 'failed' | 'expired',
            competition_id: data.competition_id,
            canonical_user_id: data.canonical_user_id,
            total_amount: data.total_amount,
            expires_at: data.expires_at,
            created_at: data.created_at,
          } as ReservationRow;
        },
      },
    });
  }, [balanceGuard, userId]);

  // Guards interface
  const guards: RealtimeGuards = useMemo(
    () => ({
      requireAvailable: (amount: number) => {
        balanceGuard.requireAvailable(amount);
      },
      requirePending: async (amount: number, reservationId?: string) => {
        if (reservationId) {
          await reservationGuard.assertPendingFor(reservationId, amount);
        } else {
          balanceGuard.requirePending(amount);
        }
      },
    }),
    [balanceGuard, reservationGuard]
  );

  // Subscribe to balances channel
  useEffect(() => {
    if (!userId) return;

    const channelKey = `user-balances-${userId}`;
    
    const handleStateChange = (state: ChannelState) => {
      setIsReady((prev) => ({ ...prev, balances: state === 'SUBSCRIBED' }));
    };

    const unsubscribe = subscribeToTableWithState<any>(
      'sub_account_balances',
      {
        onInsert: (payload) => {
          const balance = payload.new;
          setLatest((prev) => ({
            ...prev,
            balances: {
              user_id: balance.canonical_user_id,
              available: balance.available_balance || 0,
              pending: balance.pending_balance || 0,
              currency: balance.currency,
              updated_at: balance.updated_at,
            },
          }));
        },
        onUpdate: (payload) => {
          const balance = payload.new;
          setLatest((prev) => ({
            ...prev,
            balances: {
              user_id: balance.canonical_user_id,
              available: balance.available_balance || 0,
              pending: balance.pending_balance || 0,
              currency: balance.currency,
              updated_at: balance.updated_at,
            },
          }));
        },
      },
      undefined,
      {
        channelKey,
        enableVersioning: true,
        onStateChange: handleStateChange,
      }
    );

    return () => {
      unsubscribe();
    };
  }, [userId]);

  // Subscribe to purchases/reservations channel
  useEffect(() => {
    if (!userId) return;

    const channelKey = `user-purchases-${userId}`;
    
    const handleStateChange = (state: ChannelState) => {
      setIsReady((prev) => ({ ...prev, purchases: state === 'SUBSCRIBED' }));
    };

    const unsubscribe = subscribeToBroadcast<any>(
      `user:${userId}:purchases`,
      'purchase_event',
      (event) => {
        console.log('[useRealtimeWithGuards] Purchase event:', event);
        
        if (event.type === 'reservation_created') {
          setLatest((prev) => ({ ...prev, reservation: event }));
        } else if (event.type === 'payment_authorized') {
          setLatest((prev) => ({ ...prev, payment: event }));
        }
      },
      {
        onStateChange: handleStateChange,
      }
    );

    return unsubscribe;
  }, [userId]);

  return {
    isReady,
    latest,
    guards,
    balanceGuard,
    reservationGuard,
  };
}
