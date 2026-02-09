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
  // Store the latest options in a ref to avoid re-subscribing when callbacks change
  const optionsRef = useRef(options);
  
  // Update the ref whenever options change, but don't trigger re-subscription
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const userId = baseUser?.id;
  const canonicalUserId = userId ? toPrizePid(userId) : '';
  
  // Store userId and canonicalUserId in refs for stable access in callbacks
  const userIdRef = useRef(userId);
  const canonicalUserIdRef = useRef(canonicalUserId);
  useEffect(() => {
    userIdRef.current = userId;
    canonicalUserIdRef.current = canonicalUserId;
  }, [userId, canonicalUserId]);

  const debounceMs = options.debounceMs ?? 300;

  // Stable debounced callback executor - uses refs to access current values at execution time
  const executeWithDebounce = useCallback(
    (key: string, callback: () => void) => {
      const existing = debounceRef.current.get(key);
      if (existing) {
        clearTimeout(existing);
      }

      const timer = setTimeout(() => {
        callback();
        debounceRef.current.delete(key);
      }, optionsRef.current.debounceMs ?? 300);

      debounceRef.current.set(key, timer);
    },
    [] // Stable function - uses refs to access current values at execution time
  );

  // Process incoming realtime payload - stable function that uses refs to access latest values
  const processPayload = useCallback(
    (table: string, eventType: string, newData: any, oldData: any) => {
      const currentUserId = userIdRef.current;
      const currentCanonicalUserId = canonicalUserIdRef.current;
      
      if (!currentUserId) return;

      // Check if this event is for the current user
      const dataToCheck = newData || oldData;
      if (!recordMatchesUser(dataToCheck, currentUserId, currentCanonicalUserId)) {
        return;
      }

      const payload: RealtimePayload = {
        table,
        eventType: eventType as 'INSERT' | 'UPDATE' | 'DELETE',
        new: newData || {},
        old: oldData || {},
      };

      console.log(`[RealtimeSubscriptions] ${table} ${eventType}:`, {
        userId: currentUserId?.substring(0, 15) + '...',
      });

      // Execute specific callbacks with debouncing - use optionsRef.current to get latest callbacks
      const callbackKey = `${table}-${eventType}`;
      const currentOptions = optionsRef.current;

      switch (table) {
        case 'balance_ledger':
          if (currentOptions.onBalanceLedgerChange) {
            executeWithDebounce(callbackKey, () => currentOptions.onBalanceLedgerChange!(payload));
          }
          break;
        case 'user_transactions':
          if (currentOptions.onUserTransactionChange) {
            executeWithDebounce(callbackKey, () => currentOptions.onUserTransactionChange!(payload));
          }
          break;
        case 'joincompetition':
        case 'v_joincompetition_active':
          if (currentOptions.onJoinCompetitionChange) {
            executeWithDebounce(callbackKey, () => currentOptions.onJoinCompetitionChange!(payload));
          }
          break;
        case 'tickets':
          if (currentOptions.onTicketsChange) {
            executeWithDebounce(callbackKey, () => currentOptions.onTicketsChange!(payload));
          }
          break;
        case 'pending_tickets':
          if (currentOptions.onPendingTicketsChange) {
            executeWithDebounce(callbackKey, () => currentOptions.onPendingTicketsChange!(payload));
          }
          break;
        case 'competition_entries':
          if (currentOptions.onCompetitionEntriesChange) {
            executeWithDebounce(callbackKey, () => currentOptions.onCompetitionEntriesChange!(payload));
          }
          break;
        case 'sub_account_balances':
          if (currentOptions.onSubAccountBalanceChange) {
            executeWithDebounce(callbackKey, () => currentOptions.onSubAccountBalanceChange!(payload));
          }
          break;
      }

      // Execute generic callback
      if (currentOptions.onAnyChange) {
        executeWithDebounce(`any-${callbackKey}`, () => currentOptions.onAnyChange!(payload));
      }
    },
    [executeWithDebounce] // Stable function - uses refs to access latest values at execution time
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

    // Cleanup on unmount OR user change only - NOT on option changes
    return () => {
      console.log('[RealtimeSubscriptions] Cleaning up subscriptions');

      // Clear all debounce timers
      debounceRef.current.forEach((timer) => clearTimeout(timer));
      debounceRef.current.clear();

      // Remove channel
      supabase.removeChannel(channel);
    };
    // CRITICAL: Only depend on userId and canonicalUserId - NOT on processPayload or options
    // This ensures subscriptions are set up once per user session and only cleaned up when user changes
    // Note: processPayload is intentionally omitted - it's stable and uses refs to access latest values
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, canonicalUserId]);

  return {
    isSubscribed: subscriptionStatusRef.current === 'subscribed',
    subscriptionStatus: subscriptionStatusRef.current,
  };
}

export { useRealtimeSubscriptions };
