-- SUPERSEDED: This migration is obsolete.
-- This migration references the joincompetition table, which is not created until
-- 20251120000003_create_joincompetition_table.sql. The privy_user_id backfill for
-- joincompetition is properly handled by 20251201000001_backfill_privy_user_id_from_identifiers.sql.
-- This file is kept as a no-op stub to maintain migration history.

SELECT 1;
