/**
 * Purchase Dashboard Helpers
 * 
 * This module provides typed query helpers for fetching and working with purchase groups
 * from the Supabase purchase_groups and purchase_events views.
 * 
 * Key Features:
 * - Fetch recent purchase sessions grouped by date/time windows
 * - Get detailed information about specific purchase sessions
 * - Fetch raw purchase events for a user
 * - Utility functions for formatting currency and dates
 */

import { supabase } from './supabase';

// ============================================================================
// Types for views and tables
// ============================================================================

export interface PurchaseEvent {
  source_row_id: string;
  source_table: 'tickets' | 'joincompetition';
  user_id: string;
  competition_id: string;
  amount: number;
  occurred_at: string; // ISO timestamp
  purchase_key: string | null;
}

export interface PurchaseGroup {
  user_id: string;
  competition_id: string;
  purchase_group_number: number;
  group_start_at: string;
  group_end_at: string;
  events_in_group: number;
  total_amount: number;
  any_purchase_key: string | null;
  events: Array<{
    source_table: PurchaseEvent['source_table'];
    source_row_id: string;
    amount: number;
    occurred_at: string;
    purchase_key: string | null;
  }>;
}

export interface Competition {
  id: string;
  title: string | null;
  // add more fields if needed
}

// ============================================================================
// Query helpers
// ============================================================================

export interface Pagination {
  limit?: number;
  offset?: number;
}

/**
 * Fetch recent purchase sessions for a user across all competitions
 * Returns purchase groups with competition titles hydrated
 */
export async function fetchRecentPurchaseSessions(params: {
  userId: string;
  limit?: number;
  offset?: number;
}) {
  const { userId, limit = 50, offset = 0 } = params;
  
  // Pull sessions from purchase_groups view
  const { data: groups, error } = await supabase
    .from('purchase_groups')
    .select('*')
    .eq('user_id', userId)
    .order('group_start_at', { ascending: false } as any)
    .range(offset, offset + limit - 1);
  
  if (error) throw error;
  
  const pgRows = (groups || []) as PurchaseGroup[];
  
  // Collect competition_ids
  const competitionIds = Array.from(new Set(pgRows.map(r => r.competition_id))).filter(Boolean);
  let competitionsMap: Record<string, Competition> = {};
  
  if (competitionIds.length > 0) {
    const { data: comps, error: compErr } = await supabase
      .from('competitions')
      .select('id,title')
      .in('id', competitionIds as string[]) as any;
    
    if (compErr) throw compErr;
    
    competitionsMap = (comps || []).reduce((acc: any, c: any) => {
      acc[c.id] = c as Competition;
      return acc;
    }, {} as Record<string, Competition>);
  }
  
  // Attach competition_title
  const rows = pgRows.map(r => ({
    ...r,
    competition_title: competitionsMap[r.competition_id]?.title ?? null,
  }));
  
  return rows as Array<PurchaseGroup & { competition_title: string | null }>;
}

/**
 * Fetch purchase sessions for a specific user and competition
 * Useful for the detailed competition view in the dashboard
 */
export async function fetchCompetitionPurchaseSessions(params: {
  userId: string;
  competitionId: string;
  limit?: number;
  offset?: number;
}) {
  const { userId, competitionId, limit = 50, offset = 0 } = params;
  
  const { data: groups, error } = await supabase
    .from('purchase_groups')
    .select('*')
    .eq('user_id', userId)
    .eq('competition_id', competitionId)
    .order('group_start_at', { ascending: false } as any)
    .range(offset, offset + limit - 1);
  
  if (error) throw error;
  
  const pgRows = (groups || []) as PurchaseGroup[];
  
  // Hydrate competition title
  if (pgRows.length > 0) {
    const { data: comp, error: compErr } = await supabase
      .from('competitions')
      .select('id,title')
      .eq('id', competitionId)
      .limit(1)
      .maybeSingle() as any;
    
    if (compErr) throw compErr;
    
    const competition_title = comp?.title ?? null;
    return pgRows.map(r => ({
      ...r,
      competition_title,
    })) as Array<PurchaseGroup & { competition_title: string | null }>;
  }
  
  return [];
}

/**
 * Fetch details of a specific purchase session
 */
export async function fetchSessionDetail(params: {
  userId: string;
  competitionId: string;
  groupNumber: number;
}) {
  const { userId, competitionId, groupNumber } = params;
  
  const { data: groups, error } = await supabase
    .from('purchase_groups')
    .select('*')
    .eq('user_id', userId)
    .eq('competition_id', competitionId)
    .eq('purchase_group_number', groupNumber)
    .limit(1);
  
  if (error) throw error;
  
  const row = (groups?.[0] || null) as PurchaseGroup | null;
  if (!row) return null;
  
  // Hydrate competition title
  const { data: comp, error: compErr } = await supabase
    .from('competitions')
    .select('id,title')
    .eq('id', competitionId)
    .limit(1)
    .maybeSingle() as any;
  
  if (compErr) throw compErr;
  
  return {
    ...row,
    competition_title: comp?.title ?? null,
  } as PurchaseGroup & { competition_title: string | null };
}

/**
 * Fetch raw purchase events for a user (optional - for debugging or detailed analysis)
 */
export async function fetchRawPurchaseEvents(params: {
  userId: string;
  competitionId?: string;
  limit?: number;
  offset?: number;
}) {
  const { userId, competitionId, limit = 200, offset = 0 } = params;
  
  let query = supabase
    .from('purchase_events')
    .select('*')
    .eq('user_id', userId);
  
  if (competitionId) {
    query = query.eq('competition_id', competitionId);
  }
  
  const { data, error } = await query
    .order('occurred_at', { ascending: false } as any)
    .range(offset, offset + limit - 1);
  
  if (error) throw error;
  
  return (data || []) as PurchaseEvent[];
}

// ============================================================================
// Formatting utilities
// ============================================================================

export function formatCurrency(amount: number, currency = 'USD', locale = 'en-US') {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
  } catch {
    // Fallback if currency/locale are invalid
    return `$${amount.toFixed(2)}`;
  }
}

export function formatDate(iso: string, locale = 'en-US', options?: Intl.DateTimeFormatOptions) {
  const date = new Date(iso);
  return new Intl.DateTimeFormat(locale, options || {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatDateShort(iso: string, locale = 'en-US') {
  const date = new Date(iso);
  return new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
  }).format(date);
}

export function formatDateTimeLong(iso: string, locale = 'en-US') {
  const date = new Date(iso);
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

// ============================================================================
// UI Helper Functions
// ============================================================================

/**
 * Render a purchase session row for display in a list
 */
export function renderPurchaseSessionRow(
  row: PurchaseGroup & { competition_title: string | null },
  currency = 'USD'
) {
  return {
    title: row.competition_title || `Competition ${row.competition_id}`,
    time: `${formatDate(row.group_start_at)} — ${formatDate(row.group_end_at)}`,
    events: `${row.events_in_group} events`,
    total: formatCurrency(row.total_amount, currency),
    key: `${row.user_id}-${row.competition_id}-${row.purchase_group_number}`,
  };
}

/**
 * Render a purchase event item for display in a detail view
 */
export function renderPurchaseEventItem(ev: PurchaseEvent, currency = 'USD') {
  return {
    label: `${ev.source_table} • ${formatDate(ev.occurred_at)}`,
    amount: formatCurrency(ev.amount, currency),
    purchaseKey: ev.purchase_key || undefined,
    id: ev.source_row_id,
  };
}
