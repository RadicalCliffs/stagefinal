-- SUPERSEDED: This migration is obsolete.
-- The get_competition_ticket_availability function defined here references tables
-- (competitions, joincompetition, tickets, pending_tickets) that are not all created
-- at this migration's timestamp. The function is superseded by:
-- - 20251218100000_create_vrf_availability_view_and_lucky_dip_support.sql
-- - 20251221000000_fix_ticket_availability_competition_id_type_mismatch.sql
-- - 20251222000000_atomic_lucky_dip_allocation_and_count_queries.sql
-- This file is kept as a no-op stub to maintain migration history.

SELECT 1;
