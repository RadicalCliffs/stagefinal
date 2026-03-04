-- ============================================================================
-- NUCLEAR: Drop EVERY function that could possibly reference competitionid
-- Then reload the fixed versions
-- ============================================================================

-- Drop all possible signatures of every function we've tried to fix
DROP FUNCTION IF EXISTS public.allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) CASCADE;
DROP FUNCTION IF EXISTS public.allocate_lucky_dip_tickets_batch(TEXT, TEXT, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]) CASCADE;
DROP FUNCTION IF EXISTS public.allocate_lucky_dip_tickets_batch CASCADE;

DROP FUNCTION IF EXISTS public.check_and_mark_competition_sold_out(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.check_and_mark_competition_sold_out(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.check_and_mark_competition_sold_out CASCADE;

DROP FUNCTION IF EXISTS public.get_unavailable_tickets(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_unavailable_tickets(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_unavailable_tickets CASCADE;

DROP FUNCTION IF EXISTS public.get_competition_unavailable_tickets(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_competition_unavailable_tickets(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_competition_unavailable_tickets CASCADE;

DROP FUNCTION IF EXISTS public.reserve_lucky_dip(TEXT, TEXT, UUID, INTEGER, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS public.reserve_lucky_dip(TEXT, TEXT, TEXT, INTEGER, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS public.reserve_lucky_dip CASCADE;

DROP FUNCTION IF EXISTS public.get_competition_entries_bypass_rls(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_competition_entries_bypass_rls(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_competition_entries_bypass_rls CASCADE;

DROP FUNCTION IF EXISTS public.get_competition_entries(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_competition_entries(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_competition_entries CASCADE;

DROP FUNCTION IF EXISTS public.get_comprehensive_user_dashboard_entries(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_comprehensive_user_dashboard_entries CASCADE;

DROP FUNCTION IF EXISTS public.get_user_competition_entries(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_user_competition_entries CASCADE;

-- Force PostgREST schema reload
NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'DROPPED ALL FUNCTION OVERLOADS';
  RAISE NOTICE 'Fixes from previous migrations should now take effect';
  RAISE NOTICE 'Waiting for PostgREST to reload...';
  RAISE NOTICE '========================================================';
END $$;
