-- SUPERSEDED: This migration is obsolete.
-- The functions defined here (update_custody_balance, get_custody_wallet_summary, process_prize_payout)
-- reference tables (users, custody_transactions, custody_wallet_balances) that are not created
-- until later migrations. This migration runs before its dependencies exist.
-- This file is kept as a no-op stub to maintain migration history.

SELECT 1;
