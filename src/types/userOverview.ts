/**
 * TypeScript interfaces for the public.user_overview database view
 * 
 * This view returns one row per canonical user with all related data as JSON aggregates.
 * It provides a single source of truth for dashboard data.
 */

/**
 * Entry data from entries_json
 */
export interface UserOverviewEntry {
  entry_id: string;
  competition_id: string;
  competition_title: string | null;
  amount_paid: number;
  tickets_count: number;
  ticket_numbers_joined: string;
  created_at: string;
}

/**
 * Ticket data from tickets_json
 */
export interface UserOverviewTicket {
  ticket_id: string;
  competition_id: string;
  ticket_number: number;
  created_at: string;
}

/**
 * Transaction data from transactions_json
 */
export interface UserOverviewTransaction {
  transaction_id: string;
  type: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
}

/**
 * Balance data for a specific currency
 */
export interface UserOverviewBalance {
  available: number;
  pending: number;
}

/**
 * Balances object mapping currency to balance
 */
export interface UserOverviewBalances {
  [currency: string]: UserOverviewBalance;
}

/**
 * Ledger entry data from ledger_json
 */
export interface UserOverviewLedger {
  ledger_id: string;
  reference_id: string | null;
  transaction_type: string;
  amount: number;
  currency: string;
  balance_before: number;
  balance_after: number;
  description: string | null;
  created_at: string;
}

/**
 * Main user_overview row structure
 */
export interface UserOverview {
  canonical_user_uuid: string;
  canonical_user_id: string;
  entries_json: UserOverviewEntry[];
  tickets_json: UserOverviewTicket[];
  transactions_json: UserOverviewTransaction[];
  balances_json: UserOverviewBalances;
  ledger_json: UserOverviewLedger[];
  entries_count: number;
  tickets_count: number;
  transactions_count: number;
  ledger_count: number;
  total_credits: number;
  total_debits: number;
}
