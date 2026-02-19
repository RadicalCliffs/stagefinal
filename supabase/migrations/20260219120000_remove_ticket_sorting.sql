-- ============================================================================
-- Remove Ticket Sorting from Fisher-Yates Shuffle
-- ============================================================================
-- This migration removes the sorting step from fisher_yates_shuffle() to
-- preserve the natural random order of tickets selected by the algorithm.
-- 
-- Previously, tickets were sorted (e.g., [1,2,3,4,5]) which made large
-- purchases appear sequential even though they were randomly selected.
-- Now tickets will appear in their Fisher-Yates shuffle order (e.g., [47,2,89,15,3])
-- ============================================================================

BEGIN;

-- ============================================================================
-- Updated Fisher-Yates Shuffle Function (Without Sorting)
-- ============================================================================

CREATE OR REPLACE FUNCTION fisher_yates_shuffle(
  p_total_tickets INTEGER,
  p_count INTEGER,
  p_vrf_seed TEXT,
  p_excluded_tickets INTEGER[] DEFAULT NULL
)
RETURNS INTEGER[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_tickets INTEGER[];
  v_available INTEGER[];
  v_excluded_set INTEGER[];
  v_result INTEGER[];
  v_seed_hash BYTEA;
  v_random_state BIGINT;
  v_random_value BIGINT;
  v_swap_index INTEGER;
  v_temp INTEGER;
  i INTEGER;
  j INTEGER;
BEGIN
  -- Validate inputs
  IF p_total_tickets <= 0 OR p_count <= 0 THEN
    RAISE EXCEPTION 'total_tickets and count must be positive';
  END IF;
  
  IF p_count > p_total_tickets THEN
    RAISE EXCEPTION 'count cannot exceed total_tickets';
  END IF;

  -- Initialize excluded set
  v_excluded_set := COALESCE(p_excluded_tickets, ARRAY[]::INTEGER[]);
  
  -- Build array of available tickets (excluding sold/reserved tickets)
  SELECT array_agg(n)
  INTO v_available
  FROM generate_series(1, p_total_tickets) AS n
  WHERE n != ALL(v_excluded_set);
  
  -- Check if we have enough available tickets
  IF array_length(v_available, 1) < p_count THEN
    RAISE EXCEPTION 'Insufficient available tickets: have %, need %', 
      array_length(v_available, 1), p_count;
  END IF;
  
  -- Create initial seed hash using SHA256
  -- Combine VRF seed with a salt for additional entropy
  v_seed_hash := digest(p_vrf_seed || 'FISHER_YATES_V1', 'sha256');
  
  -- Initialize random state from first 8 bytes of hash
  v_random_state := get_byte(v_seed_hash, 0)::BIGINT << 56 |
                    get_byte(v_seed_hash, 1)::BIGINT << 48 |
                    get_byte(v_seed_hash, 2)::BIGINT << 40 |
                    get_byte(v_seed_hash, 3)::BIGINT << 32 |
                    get_byte(v_seed_hash, 4)::BIGINT << 24 |
                    get_byte(v_seed_hash, 5)::BIGINT << 16 |
                    get_byte(v_seed_hash, 6)::BIGINT << 8 |
                    get_byte(v_seed_hash, 7)::BIGINT;
  
  -- Ensure non-zero state (required for xorshift)
  IF v_random_state = 0 THEN
    v_random_state := 1;
  END IF;
  
  -- Fisher-Yates shuffle (only shuffle first p_count positions)
  FOR i IN 1..p_count LOOP
    -- Generate pseudo-random number using xorshift64
    -- This is a simple but high-quality PRNG
    -- PostgreSQL uses ^ for bitwise XOR on BIGINT types
    v_random_state := v_random_state ^ (v_random_state << 13);
    v_random_state := v_random_state ^ (v_random_state >> 7);
    v_random_state := v_random_state ^ (v_random_state << 17);
    
    -- Map to range [i, array_length]
    v_random_value := abs(v_random_state) % (array_length(v_available, 1) - i + 1);
    v_swap_index := i + v_random_value::INTEGER;
    
    -- Swap v_available[i] with v_available[v_swap_index]
    v_temp := v_available[i];
    v_available[i] := v_available[v_swap_index];
    v_available[v_swap_index] := v_temp;
  END LOOP;
  
  -- Return first p_count tickets in their shuffled order (NOT SORTED)
  -- This preserves the random distribution from Fisher-Yates algorithm
  v_result := v_available[1:p_count];
  
  RETURN v_result;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION fisher_yates_shuffle(INTEGER, INTEGER, TEXT, INTEGER[]) TO authenticated;
GRANT EXECUTE ON FUNCTION fisher_yates_shuffle(INTEGER, INTEGER, TEXT, INTEGER[]) TO service_role;

-- Update comment to reflect the change
COMMENT ON FUNCTION fisher_yates_shuffle(INTEGER, INTEGER, TEXT, INTEGER[]) IS 
'Implements Fisher-Yates shuffle algorithm using VRF seed for deterministic, verifiable random ticket selection.
Uses xorshift64 PRNG for high-quality randomness. Returns tickets in their shuffled order (not sorted) to preserve visual randomness.
Same algorithm quality as instant win competitions.';

COMMIT;
