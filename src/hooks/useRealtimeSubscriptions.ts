/**
 * Comprehensive Realtime Subscriptions Hook
 *
 * Subscribes to multiple tables via postgres_changes to provide immediate
 * data updates across the user dashboard, payment flows, and balance tracking.
 *
 * Subscribed Tables:
 * - balance_ledger: Credits and debits to user balance
 * - user_transactions: Payment and top-up transactions
 * - joincompetition: Competition entry records (legacy)
 * - tickets: Confirmed ticket purchases
 * - pending_tickets: Reserved tickets awaiting payment
 * - competition_entries: New unified competition entries table
 * - sub_account_balances: User balance source of truth
 */

import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthUser } from '../contexts/AuthContext';
import { toPrizePid, userIdsEqual, isWalletAddress, normalizeWalletAddress } from '../utils/userId';

export interface RealtimePayload {
  table: string;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Record<string, any>;
  old: Record<string, any>;
}

export interface RealtimeSubscriptionOptions {
  onBalanceLedgerChange?: (payload: RealtimePayload) => void;
  onUserTransactionChange?: (payload: RealtimePayload) => void;
  onJoinCompetitionChange?: (payload: RealtimePayload) => void;
  onTicketsChange?: (payload: RealtimePayload) => void;
  onPendingTicketsChange?: (payload: RealtimePayload) => void;
  onCompetitionEntriesChange?: (payload: RealtimePayload) => void;
  onSubAccountBalanceChange?: (payload: RealtimePayload) => void;
  // Generic callback for any change
  onAnyChange?: (payload: RealtimePayload) => void;
  // Debounce delay in ms (default: 300ms)
  debounceMs?: number;
}

/**
 * Check if a database record belongs to the current user
 * Handles case-insensitive wallet address matching and various identifier formats
 */
function recordMatchesUser(
  record: Record<string, any>,
  userId: string,
  canonicalUserId: string
): boolean {
  if (!record || !userId) return false;

  const normalizedUserId = isWalletAddress(userId)
    ? (normalizeWalletAddress(userId) || userId.toLowerCase())
    : userId;

  // Check all possible user identifier fields
  const idFields = [
    'user_id',
    'canonical_user_id',
    'privy_user_id',
    'wallet_address',
    'wallet_address',
    'userid',
  ];

  for (const field of idFields) {
    const value = record[field];
    if (!value) continue;

    // Direct match
    if (value === userId || value === canonicalUserId) return true;

    // Case-insensitive match for wallet addresses
    if (userIdsEqual(value, userId) || userIdsEqual(value, canonicalUserId)) {
      return true;
    }
  }

  return false;
}

/**
 * Hook to subscribe to realtime database changes for the current user
 *
 * @param options Callbacks for specific table changes
 * @returns Object with refresh function and subscription status
 */
export function useRealtimeSubscriptions(options: RealtimeSubscriptionOptions = {}) {
  const { baseUser } = useAuthUser();
  const debounceRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const subscriptionStatusRef = useRef<'connecting' | 'subscribed' | 'error'>('connecting');

  const userId = baseUser?.id;
  const canonicalUserId = userId ? toPrizePid(userId) : '';
  const debounceMs = options.debounceMs ?? 300;

  // Debounced callback executor
  const executeWithDebounce = useCallback(
    (key: string, callback: () => void) => {
      const existing = debounceRef.current.get(key);
      if (existing) {
        clearTimeout(existing);
      }

      const timer = setTimeout(() => {
        callback();
        debounceRef.current.delete(key);
      }, debounceMs);

      debounceRef.current.set(key, timer);
    },
    [debounceMs]
  );

  // Process incoming realtime payload
  const processPayload = useCallback(
    (table: string, eventType: string, newData: any, oldData: any) => {
      if (!userId) return;

      // Check if this event is for the current user
      const dataToCheck = newData || oldData;
      if (!recordMatchesUser(dataToCheck, userId, canonicalUserId)) {
        return;
      }

      const payload: RealtimePayload = {
        table,
        eventType: eventType as 'INSERT' | 'UPDATE' | 'DELETE',
        new: newData || {},
        old: oldData || {},
      };

      console.log(`[RealtimeSubscriptions] ${table} ${eventType}:`, {
        userId: userId?.substring(0, 15) + '...',
      });

      // Execute specific callbacks with debouncing
      const callbackKey = `${table}-${eventType}`;

      switch (table) {
        case 'balance_ledger':
          if (options.onBalanceLedgerChange) {
            executeWithDebounce(callbackKey, () => options.onBalanceLedgerChange!(payload));
          }
          break;
        case 'user_transactions':
          if (options.onUserTransactionChange) {
            executeWithDebounce(callbackKey, () => options.onUserTransactionChange!(payload));
          }
          break;
        case 'joincompetition':
        case 'v_joincompetition_active':
          if (options.onJoinCompetitionChange) {
            executeWithDebounce(callbackKey, () => options.onJoinCompetitionChange!(payload));
          }
          break;
        case 'tickets':
          if (options.onTicketsChange) {
            executeWithDebounce(callbackKey, () => options.onTicketsChange!(payload));
          }
          break;
        case 'pending_tickets':
          if (options.onPendingTicketsChange) {
            executeWithDebounce(callbackKey, () => options.onPendingTicketsChange!(payload));
          }
          break;
        case 'competition_entries':
          if (options.onCompetitionEntriesChange) {
            executeWithDebounce(callbackKey, () => options.onCompetitionEntriesChange!(payload));
          }
          break;
        case 'sub_account_balances':
          if (options.onSubAccountBalanceChange) {
            executeWithDebounce(callbackKey, () => options.onSubAccountBalanceChange!(payload));
          }
          break;
      }

      // Execute generic callback
      if (options.onAnyChange) {
        executeWithDebounce(`any-${callbackKey}`, () => options.onAnyChange!(payload));
      }
    },
    [userId, canonicalUserId, options, executeWithDebounce]
  );

  useEffect(() => {
    if (!userId) return;

    const normalizedUserId = isWalletAddress(userId)
      ? (normalizeWalletAddress(userId) || userId.toLowerCase())
      : userId;

    console.log('[RealtimeSubscriptions] Setting up subscriptions for user:', {
      userId: userId.substring(0, 15) + '...',
      canonicalUserId: canonicalUserId.substring(0, 20) + '...',
    });

    // Create a single channel for all subscriptions
    const channel = supabase.channel(`realtime-dashboard-${canonicalUserId}`);

    // Subscribe to balance_ledger
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'balance_ledger' },
      (payload) => {
        processPayload('balance_ledger', payload.eventType, payload.new, payload.old);
      }
    );

    // Subscribe to user_transactions
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_transactions' },
      (payload) => {
        processPayload('user_transactions', payload.eventType, payload.new, payload.old);
      }
    );

    // Subscribe to joincompetition (legacy)
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'joincompetition' },
      (payload) => {
        processPayload('joincompetition', payload.eventType, payload.new, payload.old);
      }
    );

    // Subscribe to v_joincompetition_active (legacy view)
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'v_joincompetition_active' },
      (payload) => {
        processPayload('v_joincompetition_active', payload.eventType, payload.new, payload.old);
      }
    );

    // Subscribe to tickets
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tickets' },
      (payload) => {
        processPayload('tickets', payload.eventType, payload.new, payload.old);
      }
    );

    // Subscribe to pending_tickets
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'pending_tickets' },
      (payload) => {
        processPayload('pending_tickets', payload.eventType, payload.new, payload.old);
      }
    );

    // Subscribe to competition_entries (new unified table)
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'competition_entries' },
      (payload) => {
        processPayload('competition_entries', payload.eventType, payload.new, payload.old);
      }
    );

    // Subscribe to sub_account_balances (balance source of truth)
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'sub_account_balances' },
      (payload) => {
        processPayload('sub_account_balances', payload.eventType, payload.new, payload.old);
      }
    );

    // Subscribe to channel
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('[RealtimeSubscriptions] All subscriptions active');
        subscriptionStatusRef.current = 'subscribed';
      } else if (status === 'CHANNEL_ERROR') {
        console.warn('[RealtimeSubscriptions] Subscription error');
        subscriptionStatusRef.current = 'error';
      } else if (status === 'CLOSED') {
        console.log('[RealtimeSubscriptions] Channel closed');
      }
    });

    // Cleanup on unmount
    return () => {
      console.log('[RealtimeSubscriptions] Cleaning up subscriptions');

      // Clear all debounce timers
      debounceRef.current.forEach((timer) => clearTimeout(timer));
      debounceRef.current.clear();

      // Remove channel
      supabase.removeChannel(channel);
    };
  }, [userId, canonicalUserId, processPayload]);

  return {
    isSubscribed: subscriptionStatusRef.current === 'subscribed',
    subscriptionStatus: subscriptionStatusRef.current,
  };
}

export default useRealtimeSubscriptions;
