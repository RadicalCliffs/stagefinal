-- Fix function overloading ambiguity
-- Drop old function signatures that conflict with newer versions
-- Also add UUID wrapper for check_and_mark_competition_sold_out

BEGIN;

-- reserve_lucky_dip has 2 versions causing PGRST203 error
-- Drop the old version with different parameter order
DROP FUNCTION IF EXISTS public.reserve_lucky_dip(p_competition_id UUID, p_canonical_user_id TEXT, p_wallet_address TEXT, p_ticket_count INTEGER, p_hold_minutes INTEGER) CASCADE;

-- check_and_mark_competition_sold_out exists as TEXT version but is being called with UUID
-- Add UUID wrapper
CREATE OR REPLACE FUNCTION public.check_and_mark_competition_sold_out(p_competition_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN check_and_mark_competition_sold_out(p_competition_id::TEXT);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_and_mark_competition_sold_out(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_mark_competition_sold_out(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.check_and_mark_competition_sold_out(UUID) TO service_role;

COMMIT;
