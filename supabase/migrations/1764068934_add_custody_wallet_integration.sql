-- SUPERSEDED: This migration is obsolete.
-- This migration references the 'users' table (ALTER TABLE users, REFERENCES users(id)),
-- but the users table is not created until 20251030184124_create_complete_schema_v2.sql.
-- The custody_transactions and custody_wallet_balances tables defined here need to be
-- recreated in a properly ordered migration if needed.
-- This file is kept as a no-op stub to maintain migration history.

SELECT 1;
