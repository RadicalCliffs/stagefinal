/**
 * User Overview Service
 * 
 * Service for fetching data from the public.user_overview database view.
 * This view provides a single source of truth for all user dashboard data.
 * 
 * Usage:
 * - Call fetchUserOverview(canonicalUserId) to get all user data in one query
 * - The view returns one row per canonical user with JSON aggregates
 * - All related data (entries, tickets, transactions, balances, ledger) is included
 */

import { supabase } from '../lib/supabase';
import type { UserOverview } from '../types/userOverview';

/**
 * Fetch complete user overview data from the user_overview view
 * 
 * @param canonicalUserId - The canonical user ID (format: "prize:pid:0x...")
 * @returns Promise with UserOverview data or null if user not found
 * 
 * @example
 * const overview = await fetchUserOverview('prize:pid:0x2137af5047526a1180...');
 * if (overview) {
 *   console.log('Entries:', overview.entries_json);
 *   console.log('Balance:', overview.balances_json.USDC);
 *   console.log('Total tickets:', overview.tickets_count);
 * }
 */
export async function fetchUserOverview(
  canonicalUserId: string
): Promise<UserOverview | null> {
  if (!canonicalUserId) {
    console.warn('[userOverviewService] No canonical user ID provided');
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('user_overview')
      .select('*')
      .eq('canonical_user_id', canonicalUserId)
      .single();

    if (error) {
      // If no rows found, return null instead of throwing
      if (error.code === 'PGRST116') {
        console.log('[userOverviewService] No data found for user:', canonicalUserId);
        return null;
      }
      throw error;
    }

    // Parse JSON fields if they come back as strings (shouldn't happen but just in case)
    const parsedData: UserOverview = {
      ...data,
      entries_json: typeof data.entries_json === 'string' 
        ? JSON.parse(data.entries_json) 
        : data.entries_json || [],
      tickets_json: typeof data.tickets_json === 'string'
        ? JSON.parse(data.tickets_json)
        : data.tickets_json || [],
      transactions_json: typeof data.transactions_json === 'string'
        ? JSON.parse(data.transactions_json)
        : data.transactions_json || [],
      balances_json: typeof data.balances_json === 'string'
        ? JSON.parse(data.balances_json)
        : data.balances_json || {},
      ledger_json: typeof data.ledger_json === 'string'
        ? JSON.parse(data.ledger_json)
        : data.ledger_json || [],
    };

    console.log('[userOverviewService] Fetched user overview:', {
      canonicalUserId,
      entriesCount: parsedData.entries_count,
      ticketsCount: parsedData.tickets_count,
      transactionsCount: parsedData.transactions_count,
    });

    return parsedData;
  } catch (error) {
    console.error('[userOverviewService] Error fetching user overview:', error);
    throw error;
  }
}

/**
 * Helper: Get user balance for a specific currency
 * 
 * @param overview - UserOverview data
 * @param currency - Currency code (e.g., 'USDC', 'BONUS')
 * @returns Balance object or null if currency not found
 */
export function getUserBalance(
  overview: UserOverview | null,
  currency: string
): { available: number; pending: number } | null {
  if (!overview || !overview.balances_json) {
    return null;
  }
  return overview.balances_json[currency] || null;
}

/**
 * Helper: Get total available balance across all currencies
 * 
 * @param overview - UserOverview data
 * @returns Total available balance (sum of all currencies)
 */
export function getTotalAvailableBalance(overview: UserOverview | null): number {
  if (!overview || !overview.balances_json) {
    return 0;
  }
  
  return Object.values(overview.balances_json).reduce(
    (sum, balance) => sum + (balance.available || 0),
    0
  );
}

/**
 * Helper: Filter entries by competition status
 * 
 * @param overview - UserOverview data
 * @param competitionIds - Optional array of competition IDs to filter by
 * @returns Filtered entries
 */
export function getEntriesByCompetition(
  overview: UserOverview | null,
  competitionIds?: string[]
) {
  if (!overview || !overview.entries_json) {
    return [];
  }
  
  if (!competitionIds || competitionIds.length === 0) {
    return overview.entries_json;
  }
  
  return overview.entries_json.filter(entry =>
    competitionIds.includes(entry.competition_id)
  );
}

/**
 * Transform user_overview entries to the format expected by the dashboard
 * This adapter ensures compatibility with existing dashboard components
 * 
 * @param overview - UserOverview data
 * @returns Entries in dashboard format
 */
export function transformOverviewToEntries(overview: UserOverview | null): any[] {
  if (!overview || !overview.entries_json) {
    return [];
  }

  return overview.entries_json.map(entry => ({
    id: entry.entry_id,
    competition_id: entry.competition_id,
    title: entry.competition_title || 'Unknown Competition',
    description: '',
    image: null,
    status: 'live', // Default status, will be refined by dashboard
    entry_type: 'completed',
    expires_at: null,
    is_winner: false,
    ticket_numbers: entry.ticket_numbers_csv,
    number_of_tickets: entry.tickets_count,
    amount_spent: entry.amount_paid,
    purchase_date: entry.created_at,
    wallet_address: null,
    transaction_hash: null,
    is_instant_win: false,
    prize_value: null,
    competition_status: 'active',
    end_date: null,
  }));
}
