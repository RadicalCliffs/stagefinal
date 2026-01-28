/**
 * Supabase Realtime Service
 * 
 * Centralized service for managing Supabase realtime subscriptions.
 * Provides utilities for subscribing to table changes and handling broadcasts.
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

  const channel = supabase.channel(channelName);

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

  // Subscribe to the channel
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      console.log(`[Realtime] Subscribed to ${tableName}${filter ? ` (${filter})` : ''}`);
    } else if (status === 'CHANNEL_ERROR') {
      console.error(`[Realtime] Error subscribing to ${tableName}`);
    } else if (status === 'TIMED_OUT') {
      console.warn(`[Realtime] Subscription timeout for ${tableName}`);
    } else if (status === 'CLOSED') {
      console.log(`[Realtime] Channel closed for ${tableName}`);
    }
  });

  // Return unsubscribe function
  return () => {
    console.log(`[Realtime] Unsubscribing from ${tableName}`);
    supabase.removeChannel(channel);
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
