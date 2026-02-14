/**
 * Types for user competition entries from Supabase RPC functions
 *
 * These types match the SQL function return shapes and ensure type-safety
 * when working with the getUserCompetitionEntries RPC and related helpers.
 */

/**
 * Individual purchase record within a competition entry
 */
export interface IndividualPurchase {
  id: string;
  purchase_key: string;
  tickets_count: number;
  amount_spent: number;
  ticket_numbers: string | null;
  purchased_at: string; // ISO timestamp
  created_at: string; // ISO timestamp
}

/**
 * Single user competition entry returned from get_user_competition_entries RPC
 * Enhanced to include individual purchase records and draw information
 *
 * Note: amount_spent is a Postgres numeric which comes back as string.
 * Convert with: const amountSpentNum = Number(entry.amount_spent)
 *
 * Note: latest_purchase_at is an ISO string (timestamptz).
 * Parse with: new Date(entry.latest_purchase_at)
 */
export interface UserCompetitionEntry {
  // Entry identifiers
  id: string;
  competition_id: string;
  
  // Competition information
  competition_title: string | null;
  competition_description: string | null;
  competition_image_url: string | null;
  competition_status: string | null;
  competition_end_date: string | null; // ISO timestamp
  competition_prize_value: number | null;
  competition_is_instant_win: boolean;
  
  // Draw information
  draw_date: string | null; // ISO timestamp
  vrf_tx_hash: string | null;
  vrf_status: string | null;
  vrf_draw_completed_at: string | null; // ISO timestamp
  
  // User entry data (aggregated)
  tickets_count: number;
  ticket_numbers: string | null; // CSV: "1432, 5324"
  amount_spent: string; // numeric from Postgres comes back as string
  amount_paid: number | null;
  is_winner: boolean;
  wallet_address: string | null;
  
  // Purchase timestamps
  latest_purchase_at: string | null; // ISO timestamp
  created_at: string | null; // ISO timestamp
  
  // Entry status
  entry_status: string;
  
  // Individual purchases
  individual_purchases: IndividualPurchase[];
}

/**
 * Parameters for getUserCompetitionEntries helper function
 */
export interface GetUserCompetitionEntriesParams {
  userIdentifier: string;
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
