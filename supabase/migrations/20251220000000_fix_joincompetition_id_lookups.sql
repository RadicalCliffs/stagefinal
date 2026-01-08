-- Fix joincompetition ID lookups
-- Simplified migration to avoid function signature conflicts

-- Drop all existing versions first
DROP FUNCTION IF EXISTS get_joincompetition_entries_for_competition(UUID);

-- Recreate function with proper signature
CREATE OR REPLACE FUNCTION get_joincompetition_entries_for_competition(
    p_competition_id UUID
)
RETURNS TABLE (
    uid TEXT,
    competitionid TEXT,
    userid TEXT,
    privy_user_id TEXT,
    numberoftickets INTEGER,
    ticketnumbers TEXT,
    amountspent DECIMAL,
    walletaddress TEXT,
    chain TEXT,
    transactionhash TEXT,
    purchasedate TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $get_joincomp_entries$
DECLARE
    v_comp_uid TEXT;
BEGIN
    SELECT c.uid INTO v_comp_uid
    FROM competitions c
    WHERE c.id = p_competition_id::text;

    RETURN QUERY
    SELECT
        jc.uid,
        jc.competitionid,
        jc.userid,
        jc.privy_user_id,
        jc.numberoftickets,
        jc.ticketnumbers,
        jc.amountspent,
        jc.walletaddress,
        jc.chain,
        jc.transactionhash,
        jc.purchasedate
    FROM joincompetition jc
    WHERE jc.competitionid = p_competition_id::text
       OR (v_comp_uid IS NOT NULL AND jc.competitionid = v_comp_uid);
END;
$get_joincomp_entries$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_joincompetition_entries_for_competition(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_joincompetition_entries_for_competition(UUID) TO anon;
GRANT EXECUTE ON FUNCTION get_joincompetition_entries_for_competition(UUID) TO service_role;
