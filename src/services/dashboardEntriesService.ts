/**
 * Dashboard Entries Service
 * 
 * API functions for fetching user entries, transactions, and competition availability.
 * These functions work with Supabase RPCs for robust data fetching on the dashboard/entries page.
 * 
 * Usage with real-time channels:
 * - Use these functions for initial data fetching and manual refreshes
 * - Combine with real-time subscriptions for live updates
 * - Functions are idempotent and safe to call multiple times
 */

import { supabase } from '../lib/supabase';

/**
 * Dashboard entry interface for typed responses
 */
export interface DashboardEntry {
  competitionId: string;
  competitionTitle: string | null;
  ticketNumber: number | null;
  purchasedAt: string | null;
  status: string | null;
  source: 'tickets' | 'pending_tickets';
  competitionUrl: string;
}

/**
 * Detailed entry interface with user identifiers
 */
export interface DetailedEntry extends DashboardEntry {
  canonicalUserId: string | null;
  walletAddress: string | null;
  privyUserId: string | null;
}

/**
 * Competition availability interface
 */
export interface CompetitionAvailability {
  competitionId: string;
  totalTickets: number;
  soldCount: number;
  pendingCount: number;
  availableCount: number;
  availableTickets: number[];
}

/**
 * Pending transaction interface
 */
export interface PendingTransaction {
  id: string;
  created_at: string;
  status: string;
  expires_at: string;
  competition_id: string;
  canonical_user_id: string | null;
  wallet_address: string | null;
  user_id: string | null;
  transaction_hash: string | null;
  client_secret: string | null;
  competitionUrl: string;
}

/**
 * 1) Get all user entries for dashboard (tickets + active pending)
 * Use the consolidated RPC and map extra fields you need for display.
 * 
 * Identifier can be: canonical_user_id like "prize:pid:0x...",
 * wallet address "0x...", or Privy DID "did:privy:..."
 * 
 * @param identifier - User identifier (canonical_user_id, wallet address, or Privy DID)
 * @returns Promise with array of dashboard entries
 * 
 * @example
 * const entries = await fetchUserDashboardEntries('prize:pid:0x2137af5047526a1180...');
 */
export async function fetchUserDashboardEntries(identifier: string): Promise<DashboardEntry[]> {
  const { data, error } = await supabase.rpc(
    'get_comprehensive_user_dashboard_entries',
    { p_identifier: identifier }
  );

  if (error) throw error;

  // Map to UI model with competition URL
  const entries = (data ?? []).map((row: {
    competition_id: string;
    competition_title: string | null;
    ticket_number: number | null;
    purchased_at: string | null;
    status: string | null;
    source: 'tickets' | 'pending_tickets';
  }) => {
    const competitionUrl = `/competitions/${row.competition_id}`; // change if you have slugs

    return {
      competitionId: row.competition_id,
      competitionTitle: row.competition_title,
      ticketNumber: row.ticket_number,
      purchasedAt: row.purchased_at,
      status: row.status,
      source: row.source,
      competitionUrl,
    };
  });

  return entries;
}

/**
 * 2) Get detailed entries with user identifiers (exact entries RPC)
 * If you need canonical_user_id, wallet_address, privy_user_id alongside the entry rows.
 * 
 * @param identifier - User identifier (canonical_user_id, wallet address, or Privy DID)
 * @returns Promise with array of detailed entries
 * 
 * @example
 * const entries = await fetchUserEntriesDetailed('prize:pid:0x2137af5047526a1180...');
 */
export async function fetchUserEntriesDetailed(identifier: string): Promise<DetailedEntry[]> {
  const { data, error } = await supabase.rpc(
    'get_user_competition_entries',
    { p_user_identifier: identifier }
  );

  if (error) throw error;

  const entries = (data ?? []).map((row: {
    competition_id: string;
    competition_title: string | null;
    ticket_number: number | null;
    purchased_at: string | null;
    status: string | null;
    source: 'tickets' | 'pending_tickets';
    canonical_user_id: string | null;
    wallet_address: string | null;
    privy_user_id: string | null;
  }) => {
    const competitionUrl = `/competitions/${row.competition_id}`;

    return {
      competitionId: row.competition_id,
      competitionTitle: row.competition_title,
      ticketNumber: row.ticket_number,
      purchasedAt: row.purchased_at,
      status: row.status,
      source: row.source,
      canonicalUserId: row.canonical_user_id,
      walletAddress: row.wallet_address,
      privyUserId: row.privy_user_id,
      competitionUrl,
    };
  });

  return entries;
}

/**
 * 3) Get competition availability (counts and available ticket numbers)
 * Use this to show remaining tickets and explicit numbers.
 * 
 * @param competitionId - Competition UUID or identifier
 * @returns Promise with competition availability data or null if not found
 * 
 * @example
 * const availability = await fetchCompetitionAvailability('88f3467c-747e-4231-bb2e-1869e227bb85');
 */
export async function fetchCompetitionAvailability(
  competitionId: string
): Promise<CompetitionAvailability | null> {
  const { data, error } = await supabase.rpc(
    'get_competition_ticket_availability',
    { p_competition_id: competitionId }
  );

  if (error) throw error;

  // Function returns one row
  const row = (data ?? [])[0];
  if (!row) return null;

  return {
    competitionId: row.competition_id as string,
    totalTickets: row.total_tickets as number,
    soldCount: row.sold_count as number,
    pendingCount: row.pending_count as number,
    availableCount: row.available_count as number,
    availableTickets: row.available_tickets as number[],
  };
}

/**
 * 4) Fetch transactions: purchased tickets and pending checkout references
 * For purchased tickets, use entries RPC (source === 'tickets') and show any payment fields.
 * 
 * @param identifier - User identifier (canonical_user_id, wallet address, or Privy DID)
 * @returns Promise with array of purchased tickets (detailed entries filtered by source)
 * 
 * @example
 * const purchased = await fetchPurchasedTicketsByUser('prize:pid:0x2137af5047526a1180...');
 */
export async function fetchPurchasedTicketsByUser(identifier: string): Promise<DetailedEntry[]> {
  // If you store user link on tickets via canonical_user_id or wallet_address or privy_user_id,
  // you can query via the entries RPC and filter source === 'tickets'.
  const entries = await fetchUserEntriesDetailed(identifier);
  const purchased = entries.filter(e => e.source === 'tickets');

  // If you need raw tickets columns (ensure columns exist in your schema):
  // const { data, error } = await supabase
  //   .from('tickets')
  //   .select('ticket_number, created_at, competition_id, status, canonical_user_id, wallet_address, privy_user_id, payment_tx_hash, tx_id')
  //   .in('status', ['sold','purchased'])
  //   .or(`canonical_user_id.eq.${identifier},wallet_address.eq.${identifier},privy_user_id.eq.${identifier}`)
  // if (error) throw error

  return purchased;
}

/**
 * Fetch pending transaction metadata (from pending_tickets)
 * 
 * @param identifier - User identifier (canonical_user_id, wallet address, or Privy DID)
 * @returns Promise with array of pending transactions
 * 
 * @example
 * const pending = await fetchPendingTransactions('prize:pid:0x2137af5047526a1180...');
 */
export async function fetchPendingTransactions(identifier: string): Promise<PendingTransaction[]> {
  // Adjust selected fields to what exists in pending_tickets schema.
  const { data, error } = await supabase
    .from('pending_tickets')
    .select('id, created_at, status, expires_at, competition_id, canonical_user_id, wallet_address, user_id, transaction_hash, client_secret')
    .in('status', ['pending', 'awaiting_payment'])
    .gt('expires_at', new Date().toISOString())
    .or(`canonical_user_id.eq.${identifier},wallet_address.eq.${identifier},user_id.eq.${identifier}`)
    .order('created_at', { ascending: false });

  if (error) throw error;

  // Attach competition URL
  const pending = (data ?? []).map(row => ({
    ...row,
    competitionUrl: `/competitions/${row.competition_id}`,
  }));

  return pending;
}

/**
 * Load complete user dashboard overview
 * Fetches entries and availability for all competitions the user has entered.
 * 
 * @param identifier - User identifier (canonical_user_id, wallet address, or Privy DID)
 * @returns Promise with entries and availability map
 * 
 * @example
 * const { entries, availabilityMap } = await loadUserOverview('prize:pid:0x2137af5047526a1180...');
 */
export async function loadUserOverview(identifier: string): Promise<{
  entries: DashboardEntry[];
  availabilityMap: Map<string, CompetitionAvailability>;
}> {
  const [entries] = await Promise.all([
    fetchUserDashboardEntries(identifier),
    // You can fetch availability per competition after you know which ones appear in entries
  ]);

  // Optionally fetch availability for top N competitions on screen
  const uniqueCompetitionIds = [...new Set(entries.map(e => e.competitionId))];
  const availabilityMap = new Map<string, CompetitionAvailability>();

  for (const id of uniqueCompetitionIds) {
    const a = await fetchCompetitionAvailability(id);
    if (a) availabilityMap.set(id, a);
  }

  return { entries, availabilityMap };
}
