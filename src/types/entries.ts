/**
 * Types for user competition entries from Supabase RPC functions
 *
 * These types match the SQL function return shapes and ensure type-safety
 * when working with the getUserCompetitionEntries RPC and related helpers.
 */

/**
 * Single user competition entry returned from get_user_competition_entries RPC
 *
 * Note: amount_spent is a Postgres numeric which comes back as string.
 * Convert with: const amountSpentNum = Number(entry.amount_spent)
 *
 * Note: latest_purchase_at is an ISO string (timestamptz).
 * Parse with: new Date(entry.latest_purchase_at)
 */
export interface UserCompetitionEntry {
  competition_id: string;
  competition_name: string | null;
  competition_image_url: string | null;
  tickets_count: number;
  amount_spent: string; // numeric from Postgres comes back as string
  latest_purchase_at: string | null; // timestamptz -> ISO string
  is_winner: boolean;
  winner_address: string | null;
  ticket_numbers_csv: string | null; // e.g. "1432, 5324"
}

/**
 * Parameters for getUserCompetitionEntries helper function
 */
export interface GetUserCompetitionEntriesParams {
  canonicalUserId: string;
  competitionId?: string | null;
}

/**
 * Dashboard entry type used in the enhanced dashboard hooks
 * This is a more comprehensive type that includes all entry metadata
 */
export interface DashboardEntry {
  id: string;
  competition_id: string;
  title: string;
  description: string;
  image: string;
  status: 'live' | 'drawn' | 'cancelled' | 'pending';
  entry_type: 'completed' | 'completed_transaction' | 'pending';
  expires_at: string | null;
  is_winner: boolean;
  ticket_numbers: string | null;
  number_of_tickets: number;
  amount_spent: number;
  purchase_date: string;
  wallet_address: string | null;
  transaction_hash: string | null;
  is_instant_win: boolean;
  prize_value: number | null;
  competition_status: string;
  end_date: string | null;
}

/**
 * Competition entry statistics
 */
export interface CompetitionEntryStats {
  totalEntries: number;
  totalSpent: number;
  totalTickets: number;
  avgSpentPerEntry: number;
}

/**
 * Entry counts by category
 */
export interface EntryCounts {
  all: number;
  instant: number;
  regular: number;
  pending: number;
}
