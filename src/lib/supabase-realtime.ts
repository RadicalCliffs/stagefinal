/**
 * Supabase Realtime Service
 * 
 * Centralized service for managing Supabase realtime subscriptions.
 * Provides utilities for subscribing to table changes and handling broadcasts.
 * Enhanced with channel state tracking and versioning for reliability.
 * 
 * Usage:
 * ```typescript
 * const unsubscribe = subscribeToTable('tickets', {
 *   onInsert: (payload) => console.log('New ticket:', payload.new),
 *   onUpdate: (payload) => console.log('Updated ticket:', payload.new),
 *   onDelete: (payload) => console.log('Deleted ticket:', payload.old)
 * });
 * 
 * // Later, cleanup
 * unsubscribe();
 * ```
 */

import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

/**
 * Realtime event payload types
 */
export interface RealtimeInsertPayload<T = any> {
  new: T;
  eventType: 'INSERT';
  schema: string;
  table: string;
}

export interface RealtimeUpdatePayload<T = any> {
  old: Partial<T>;
  new: T;
  eventType: 'UPDATE';
  schema: string;
  table: string;
}

export interface RealtimeDeletePayload<T = any> {
  old: T;
  eventType: 'DELETE';
  schema: string;
  table: string;
}

export type RealtimePayload<T = any> = 
  | RealtimeInsertPayload<T>
  | RealtimeUpdatePayload<T>
  | RealtimeDeletePayload<T>;

/**
 * Handler functions for table changes
 */
export interface RealtimeHandlers<T = any> {
  onInsert?: (payload: RealtimeInsertPayload<T>) => void;
  onUpdate?: (payload: RealtimeUpdatePayload<T>) => void;
  onDelete?: (payload: RealtimeDeletePayload<T>) => void;
}

/**
 * Table names that can be subscribed to
 */
export type SubscribableTable = 
  | 'tickets'
  | 'pending_tickets'
  | 'user_transactions'
  | 'sub_account_balances'
  | 'joincompetition'
  | 'winners'
  | 'balance_ledger'
  | 'competitions'
  | 'competition_entries'
  | 'canonical_users';

/**
 * Subscribe to postgres changes on a specific table
 * 
 * @param tableName - Name of the table to subscribe to
 * @param handlers - Object with onInsert, onUpdate, onDelete handlers
 * @param filter - Optional filter string (e.g., 'competition_id=eq.123')
 * @returns Unsubscribe function
 */
export function subscribeToTable<T = any>(
  tableName: SubscribableTable,
  handlers: RealtimeHandlers<T>,
  filter?: string
): () => void {
  const channelName = filter 
    ? `${tableName}-${filter.replace(/[^a-zA-Z0-9]/g, '_')}`
    : `${tableName}-all`;

  let channel: RealtimeChannel | null = supabase.channel(channelName);
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let isUnsubscribed = false;

  const setupChannel = () => {
    if (isUnsubscribed || !channel) return;

    // Subscribe to INSERT events
    if (handlers.onInsert) {
      const config: any = {
        event: 'INSERT',
        schema: 'public',
        table: tableName,
      };
      if (filter) {
        config.filter = filter;
      }
      channel.on('postgres_changes', config, (payload: any) => {
        handlers.onInsert?.({
          new: payload.new,
          eventType: 'INSERT',
          schema: payload.schema,
          table: payload.table,
        });
      });
    }

    // Subscribe to UPDATE events
    if (handlers.onUpdate) {
      const config: any = {
        event: 'UPDATE',
        schema: 'public',
        table: tableName,
      };
      if (filter) {
        config.filter = filter;
      }
      channel.on('postgres_changes', config, (payload: any) => {
        handlers.onUpdate?.({
          old: payload.old,
          new: payload.new,
          eventType: 'UPDATE',
          schema: payload.schema,
          table: payload.table,
        });
      });
    }

    // Subscribe to DELETE events
    if (handlers.onDelete) {
      const config: any = {
        event: 'DELETE',
        schema: 'public',
        table: tableName,
      };
      if (filter) {
        config.filter = filter;
      }
      channel.on('postgres_changes', config, (payload: any) => {
        handlers.onDelete?.({
          old: payload.old,
          eventType: 'DELETE',
          schema: payload.schema,
          table: payload.table,
        });
      });
    }

    // Subscribe to the channel with reconnection logic
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log(`[Realtime] Subscribed to ${tableName}${filter ? ` (${filter})` : ''}`);
        reconnectAttempts = 0; // Reset reconnect attempts on successful connection
      } else if (status === 'CHANNEL_ERROR') {
        console.error(`[Realtime] Error subscribing to ${tableName}`);
        attemptReconnect();
      } else if (status === 'TIMED_OUT') {
        console.warn(`[Realtime] Subscription timeout for ${tableName}`);
        attemptReconnect();
      } else if (status === 'CLOSED') {
        console.log(`[Realtime] Channel closed for ${tableName}`);
        // Don't reconnect on intentional close
      }
    });
  };

  // CRITICAL FIX: Add exponential backoff reconnection logic
  const attemptReconnect = () => {
    if (isUnsubscribed) return;
    
    if (reconnectAttempts >= maxReconnectAttempts) {
      console.error(`[Realtime] Max reconnection attempts reached for ${tableName}, giving up`);
      return;
    }

    reconnectAttempts++;
    // Exponential backoff: 2^n seconds (2s, 4s, 8s, 16s, 32s)
    const delayMs = Math.min(Math.pow(2, reconnectAttempts) * 1000, 32000);
    
    console.log(`[Realtime] Attempting to reconnect to ${tableName} in ${delayMs}ms (attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
    
    reconnectTimer = setTimeout(() => {
      if (isUnsubscribed) return;
      
      // Remove old channel
      if (channel) {
        supabase.removeChannel(channel);
      }
      
      // Create new channel and set it up
      channel = supabase.channel(channelName);
      setupChannel();
    }, delayMs);
  };

  // Initial setup
  setupChannel();

  // Return unsubscribe function
  return () => {
    isUnsubscribed = true;
    
    // Clear reconnection timer
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    
    console.log(`[Realtime] Unsubscribing from ${tableName}`);
    if (channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
  };
}

/**
 * Subscribe to multiple tables at once
 * 
 * @param subscriptions - Array of subscription configurations
 * @returns Function to unsubscribe from all
 */
export function subscribeToMultipleTables(
  subscriptions: Array<{
    table: SubscribableTable;
    handlers: RealtimeHandlers;
    filter?: string;
  }>
): () => void {
  const unsubscribers = subscriptions.map(({ table, handlers, filter }) =>
    subscribeToTable(table, handlers, filter)
  );

  // Return function that unsubscribes from all
  return () => {
    unsubscribers.forEach(unsubscribe => unsubscribe());
  };
}

/**
 * Utility to handle common pattern of refreshing data on any change
 * 
 * @param tableName - Table to subscribe to
 * @param onAnyChange - Function to call on any INSERT, UPDATE, or DELETE
 * @param filter - Optional filter
 * @returns Unsubscribe function
 */
export function subscribeToTableChanges<T = any>(
  tableName: SubscribableTable,
  onAnyChange: (event: 'INSERT' | 'UPDATE' | 'DELETE', payload: any) => void,
  filter?: string
): () => void {
  return subscribeToTable<T>(
    tableName,
    {
      onInsert: (payload) => onAnyChange('INSERT', payload),
      onUpdate: (payload) => onAnyChange('UPDATE', payload),
      onDelete: (payload) => onAnyChange('DELETE', payload),
    },
    filter
  );
}

/**
 * Schema-specific types for common tables
 */

export interface TicketRow {
  id: string;
  competition_id: string;
  ticket_number: number;
  user_id: string | null;
  canonical_user_id: string | null;
  wallet_address: string | null;
  status: string;
  purchase_price: number | null;
  purchased_at: string | null;
  transaction_hash: string | null;
  is_winner: boolean;
  prize_tier: string | null;
  created_at: string;
}

export interface UserTransactionRow {
  id: string;
  user_id: string;
  canonical_user_id: string | null;
  type: string;
  amount: number;
  currency: string | null;
  status: string;
  competition_id: string | null;
  ticket_count: number | null;
  ticket_numbers: string | null;
  transaction_hash: string | null;
  payment_method: string | null;
  metadata: any;
  created_at: string;
  updated_at: string;
  payment_provider: string | null;
  payment_status: string | null;
}

export interface WinnerRow {
  id: string;
  competition_id: string;
  user_id: string | null;
  canonical_user_id: string | null;
  wallet_address: string | null;
  ticket_number: number | null;
  prize_position: number;
  prize_value: number | null;
  prize_description: string | null;
  won_at: string;
  claimed: boolean;
  claimed_at: string | null;
  distribution_hash: string | null;
  created_at: string;
}

export interface CompetitionRow {
  id: string;
  uid: string | null;
  title: string;
  description: string | null;
  image_url: string | null;
  prize_type: string;
  prize_value: string;
  ticket_price: number;
  total_tickets: number;
  sold_tickets: number;
  tickets_sold: number;
  start_time: string;
  end_time: string | null;
  draw_date: string | null;
  drawn_at: string | null;
  status: string;
  is_instant_win: boolean;
  is_featured: boolean;
  vrf_request_id: string | null;
  vrf_transaction_hash: string | null;
  vrf_random_words: number[] | null;
  vrf_randomness: any;
  winner_wallet_address: string | null;
  winner_ticket_number: number | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface BalanceLedgerRow {
  id: string;
  canonical_user_id: string | null;
  transaction_type: string | null;
  amount: number;
  currency: string | null;
  balance_before: number | null;
  balance_after: number | null;
  reference_id: string | null;
  description: string | null;
  created_at: string;
  source: string | null;
  metadata: any;
  transaction_id: string | null;
}

export interface SubAccountBalanceRow {
  id: string;
  canonical_user_id: string;
  user_id: string | null;
  privy_user_id: string | null;
  currency: string;
  available_balance: number;
  pending_balance: number;
  bonus_balance: number;
  created_at: string;
  updated_at: string;
}

/**
 * ============================================================================
 * Channel State Tracking and Versioning
 * ============================================================================
 */

export type ChannelState = 'IDLE' | 'CONNECTING' | 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';

export interface ChannelStateTracker {
  balances: ChannelState;
  purchases: ChannelState;
  entries: ChannelState;
  tickets: ChannelState;
}

export interface VersionedEvent<T = any> {
  data: T;
  version?: number;
  updated_at?: string;
}

// Global channel state tracker
const channelStates: Map<string, ChannelState> = new Map();
const eventVersions: Map<string, number | string> = new Map();

/**
 * Get the current state of a channel
 */
export function getChannelState(channelName: string): ChannelState {
  return channelStates.get(channelName) || 'IDLE';
}

/**
 * Set the state of a channel
 */
export function setChannelState(channelName: string, state: ChannelState): void {
  channelStates.set(channelName, state);
}

/**
 * Check if a channel is ready (SUBSCRIBED)
 */
export function isChannelReady(channelName: string): boolean {
  return getChannelState(channelName) === 'SUBSCRIBED';
}

/**
 * Get the last event version for a topic
 */
export function getEventVersion(topic: string): number | string | undefined {
  return eventVersions.get(topic);
}

/**
 * Set the last event version for a topic
 */
export function setEventVersion(topic: string, version: number | string): void {
  eventVersions.set(topic, version);
}

/**
 * Check if an event version is newer than the last accepted version
 */
export function isNewerVersion(
  topic: string,
  eventVersion?: number | string
): boolean {
  if (!eventVersion) return true; // Accept events without version
  const lastVersion = eventVersions.get(topic);
  if (!lastVersion) return true; // Accept if no previous version
  
  if (typeof eventVersion === 'number' && typeof lastVersion === 'number') {
    return eventVersion > lastVersion;
  }
  
  if (typeof eventVersion === 'string' && typeof lastVersion === 'string') {
    // Compare as ISO timestamps - validate dates first
    const eventDate = new Date(eventVersion);
    const lastDate = new Date(lastVersion);
    
    // Check if dates are valid
    if (isNaN(eventDate.getTime()) || isNaN(lastDate.getTime())) {
      console.warn('[Realtime] Invalid date format in version comparison:', {
        eventVersion,
        lastVersion,
      });
      return true; // Accept if we can't compare
    }
    
    return eventDate > lastDate;
  }
  
  return true; // Accept if types don't match (shouldn't happen)
}

/**
 * Subscribe to a channel with state tracking
 */
export function subscribeToTableWithState<T = any>(
  tableName: SubscribableTable,
  handlers: RealtimeHandlers<T>,
  filter?: string,
  options?: {
    channelKey?: string;
    enableVersioning?: boolean;
    onStateChange?: (state: ChannelState) => void;
  }
): () => void {
  const channelKey = options?.channelKey || (filter 
    ? `${tableName}-${filter.replace(/[^a-zA-Z0-9]/g, '_')}`
    : `${tableName}-all`);

  setChannelState(channelKey, 'CONNECTING');
  options?.onStateChange?.('CONNECTING');

  const channel = supabase.channel(channelKey);

  // Wrap handlers with version checking if enabled
  const wrappedHandlers: RealtimeHandlers<T> = {};
  
  if (handlers.onInsert) {
    const original = handlers.onInsert;
    wrappedHandlers.onInsert = (payload) => {
      if (options?.enableVersioning) {
        const version = (payload.new as any)?.version || (payload.new as any)?.updated_at;
        if (version && !isNewerVersion(`${tableName}:${channelKey}`, version)) {
          console.log(`[Realtime] Discarding out-of-order INSERT for ${tableName}, version ${version}`);
          return;
        }
        if (version) {
          setEventVersion(`${tableName}:${channelKey}`, version);
        }
      }
      original(payload);
    };
  }

  if (handlers.onUpdate) {
    const original = handlers.onUpdate;
    wrappedHandlers.onUpdate = (payload) => {
      if (options?.enableVersioning) {
        const version = (payload.new as any)?.version || (payload.new as any)?.updated_at;
        if (version && !isNewerVersion(`${tableName}:${channelKey}`, version)) {
          console.log(`[Realtime] Discarding out-of-order UPDATE for ${tableName}, version ${version}`);
          return;
        }
        if (version) {
          setEventVersion(`${tableName}:${channelKey}`, version);
        }
      }
      original(payload);
    };
  }

  if (handlers.onDelete) {
    wrappedHandlers.onDelete = handlers.onDelete;
  }

  // Subscribe using the existing subscribeToTable logic with wrapped handlers
  const baseUnsubscribe = subscribeToTable(tableName, wrappedHandlers, filter);

  // Track subscription status
  channel.subscribe((status) => {
    setChannelState(channelKey, status as ChannelState);
    options?.onStateChange?.(status as ChannelState);
  });

  // Return enhanced unsubscribe function
  return () => {
    baseUnsubscribe();
    supabase.removeChannel(channel);
    setChannelState(channelKey, 'CLOSED');
    options?.onStateChange?.('CLOSED');
  };
}

/**
 * Subscribe to broadcast events (for purchase events, etc.)
 */
export function subscribeToBroadcast<T = any>(
  channelName: string,
  eventName: string,
  handler: (payload: T) => void,
  options?: {
    onStateChange?: (state: ChannelState) => void;
  }
): () => void {
  setChannelState(channelName, 'CONNECTING');
  options?.onStateChange?.('CONNECTING');

  const channel = supabase.channel(channelName);

  channel.on('broadcast', { event: eventName }, (payload: any) => {
    handler(payload.payload as T);
  });

  channel.subscribe((status) => {
    setChannelState(channelName, status as ChannelState);
    options?.onStateChange?.(status as ChannelState);
    
    if (status === 'SUBSCRIBED') {
      console.log(`[Realtime] Subscribed to broadcast ${channelName}:${eventName}`);
    } else if (status === 'CHANNEL_ERROR') {
      console.error(`[Realtime] Error subscribing to broadcast ${channelName}:${eventName}`);
    }
  });

  return () => {
    console.log(`[Realtime] Unsubscribing from broadcast ${channelName}:${eventName}`);
    supabase.removeChannel(channel);
    setChannelState(channelName, 'CLOSED');
    options?.onStateChange?.('CLOSED');
  };
}
