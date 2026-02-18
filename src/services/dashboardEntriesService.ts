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
 * RPC response interface for get_comprehensive_user_dashboard_entries
 */
interface ComprehensiveDashboardEntryResponse {
  id: string;
  competition_id: string;
  title: string | null;
  description: string | null;
  image: string | null;
  status: string | null;
  entry_type: string;
  expires_at: string | null;
  is_winner: boolean;
  ticket_numbers: string | null;
  number_of_tickets: number;
  amount_spent: number;
  purchase_date: string | null;
  wallet_address: string | null;
  transaction_hash: string | null;
  is_instant_win: boolean;
  prize_value: string | null;
  competition_status: string | null;
  end_date: string | null;
}

/**
 * RPC response interface for get_user_competition_entries
 */
interface UserCompetitionEntryResponse {
  id: string;
  competition_id: string;
  user_id: string | null;
  canonical_user_id: string | null;
  wallet_address: string | null;
  ticket_numbers: number[];
  ticket_count: number;
  amount_paid: number;
  currency: string | null;
  transaction_hash: string | null;
  payment_provider: string | null;
  entry_status: string;
  is_winner: boolean;
  prize_claimed: boolean;
  created_at: string;
  updated_at: string;
  competition_title: string | null;
  competition_description: string | null;
  competition_image_url: string | null;
  competition_status: string | null;
  competition_end_date: string | null;
  competition_prize_value: number | null;
  competition_is_instant_win: boolean;
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
  // CRITICAL FIX: Validate identifier before making RPC call
  // This prevents 400 errors from invalid/empty identifiers
  if (!identifier || identifier.trim().length === 0) {
    console.warn('[dashboardEntriesService] fetchUserDashboardEntries called with empty identifier, returning empty array');
    return [];
  }
  
  const { data, error } = await (supabase.rpc as any)(
    'get_comprehensive_user_dashboard_entries',
    { p_user_identifier: identifier }
  );

  if (error) {
    console.error('[dashboardEntriesService] Error in fetchUserDashboardEntries:', error);
    throw error;
  }

  // Cast RPC result from Json to expected type
  const typedData = (data as ComprehensiveDashboardEntryResponse[] | null) ?? [];

  // Map to UI model with competition URL
  const entries = typedData.map((row: ComprehensiveDashboardEntryResponse) => {
    const competitionUrl = `/competitions/${row.competition_id}`; // change if you have slugs

    return {
      competitionId: row.competition_id,
      competitionTitle: row.title,
      ticketNumber: row.ticket_numbers ? parseInt(row.ticket_numbers.split(',')[0]) : null,
      purchasedAt: row.purchase_date,
      status: row.status,
      source: row.entry_type === 'pending' ? 'pending_tickets' : 'tickets',
      competitionUrl,
    } as DashboardEntry;
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
  // CRITICAL FIX: Validate identifier before making RPC call
  // This prevents 400 errors from invalid/empty identifiers
  if (!identifier || identifier.trim().length === 0) {
    console.warn('[dashboardEntriesService] fetchUserEntriesDetailed called with empty identifier, returning empty array');
    return [];
  }
  
  const { data, error } = await (supabase.rpc as any)(
    'get_user_competition_entries',
    { p_user_identifier: identifier }
  );

  if (error) {
    console.error('[dashboardEntriesService] Error in fetchUserEntriesDetailed:', error);
    throw error;
  }

  // Cast RPC result from Json to expected type
  const typedData = (data as UserCompetitionEntryResponse[] | null) ?? [];

  const entries = typedData.map((row: UserCompetitionEntryResponse) => {
    const competitionUrl = `/competitions/${row.competition_id}`;
    
    // Extract first ticket number if ticket_numbers is an array
    const ticketNumber = row.ticket_numbers && Array.isArray(row.ticket_numbers) && row.ticket_numbers.length > 0
      ? row.ticket_numbers[0]
      : null;

    return {
      competitionId: row.competition_id,
      competitionTitle: row.competition_title,
      ticketNumber,
      purchasedAt: row.created_at,
      status: row.entry_status,
      source: 'tickets', // This RPC returns competition_entries which are finalized
      canonicalUserId: row.canonical_user_id,
      walletAddress: row.wallet_address,
      privyUserId: row.user_id,
      competitionUrl,
    } as DetailedEntry;
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
  const { data, error } = await (supabase.rpc as any)(
    'get_competition_ticket_availability',
    { p_competition_id: competitionId }
  );

  if (error) throw error;

  // Function returns JSON object directly - cast to expected type
  if (!data) return null;

  // Type assertion for the RPC result
  const typedData = data as {
    competition_id: string;
    total_tickets: number;
    sold_count: number;
    available_count: number;
    available_tickets: number[];
  };

  return {
    competitionId: typedData.competition_id,
    totalTickets: typedData.total_tickets,
    soldCount: typedData.sold_count,
    pendingCount: 0, // Not returned by this RPC, calculate if needed
    availableCount: typedData.available_count,
    availableTickets: typedData.available_tickets,
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
    .order('created_at', { ascending: false }) as { data: any[]; error: any };

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
  const entries = await fetchUserDashboardEntries(identifier);

  // Optionally fetch availability for all competitions concurrently
  const uniqueCompetitionIds = [...new Set(entries.map(e => e.competitionId))];
  const availabilityMap = new Map<string, CompetitionAvailability>();

  // Fetch all availability data concurrently for better performance
  const availabilities = await Promise.all(
    uniqueCompetitionIds.map(id => fetchCompetitionAvailability(id))
  );

  // Build the map from the results
  availabilities.forEach((availability, index) => {
    if (availability) {
      availabilityMap.set(uniqueCompetitionIds[index], availability);
    }
  });

  return { entries, availabilityMap };
}
