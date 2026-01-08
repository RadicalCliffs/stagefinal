-- SUPERSEDED: This migration is obsolete.
-- The sync_external_wallet_balances function defined here references privy_user_connections.usdc_balance
-- and check_external_usdc_balance which may not exist at this migration's timestamp.
-- Additionally, this migration runs before the tables it references are created.
-- This file is kept as a no-op stub to maintain migration history.

SELECT 1;
