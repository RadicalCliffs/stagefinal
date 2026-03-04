-- ============================================================================
-- Test: Verify tickets are returned in random order (not sorted)
-- This test should be run AFTER applying migration 20260219120000
-- ============================================================================

BEGIN;

RAISE NOTICE '==============================================================================';
RAISE NOTICE 'Testing Migration 20260219120000: Remove Ticket Sorting';
RAISE NOTICE '==============================================================================';

-- ============================================================================
-- Test 1: Verify fisher_yates_shuffle returns unsorted tickets
-- ============================================================================
DO $$
DECLARE
  v_tickets INTEGER[];
  v_sorted_tickets INTEGER[];
  v_is_sorted BOOLEAN := TRUE;
  i INTEGER;
BEGIN
  -- Generate a sample of 20 tickets from 1000 available
  v_tickets := fisher_yates_shuffle(
    1000,  -- total tickets
    20,    -- count to select
    'test_seed_12345',  -- VRF seed
    NULL   -- no excluded tickets
  );
  
  RAISE NOTICE 'Selected tickets: %', v_tickets;
  
  -- Create a sorted version
  SELECT array_agg(t ORDER BY t) INTO v_sorted_tickets
  FROM unnest(v_tickets) AS t;
  
  -- Check if the original array is already sorted
  -- If tickets ARE sorted, this is a problem - they should be random
  FOR i IN 1..array_length(v_tickets, 1) LOOP
    IF v_tickets[i] != v_sorted_tickets[i] THEN
      v_is_sorted := FALSE;
      EXIT;
    END IF;
  END LOOP;
  
  -- If tickets are sorted, the migration didn't work properly
  IF v_is_sorted THEN
    RAISE WARNING 'POTENTIAL ISSUE: Tickets appear to be sorted. Expected random order.';
    RAISE NOTICE 'Original: %', v_tickets;
    RAISE NOTICE 'Sorted:   %', v_sorted_tickets;
  ELSE
    RAISE NOTICE '✓ Test 1 PASSED: Tickets are in random order (not sorted)';
  END IF;
END $$;

-- ============================================================================
-- Test 2: Verify different seeds produce different order
-- ============================================================================
DO $$
DECLARE
  v_tickets1 INTEGER[];
  v_tickets2 INTEGER[];
  v_are_identical BOOLEAN := TRUE;
  i INTEGER;
BEGIN
  -- Generate tickets with seed 1
  v_tickets1 := fisher_yates_shuffle(1000, 10, 'seed1', NULL);
  
  -- Generate tickets with seed 2
  v_tickets2 := fisher_yates_shuffle(1000, 10, 'seed2', NULL);
  
  RAISE NOTICE 'Seed1 tickets: %', v_tickets1;
  RAISE NOTICE 'Seed2 tickets: %', v_tickets2;
  
  -- Check if they're different
  FOR i IN 1..array_length(v_tickets1, 1) LOOP
    IF v_tickets1[i] != v_tickets2[i] THEN
      v_are_identical := FALSE;
      EXIT;
    END IF;
  END LOOP;
  
  IF v_are_identical THEN
    RAISE WARNING 'WARNING: Different seeds produced identical results';
  ELSE
    RAISE NOTICE '✓ Test 2 PASSED: Different seeds produce different ticket orders';
  END IF;
END $$;

-- ============================================================================
-- Test 3: Verify same seed produces consistent results (deterministic)
-- ============================================================================
DO $$
DECLARE
  v_tickets1 INTEGER[];
  v_tickets2 INTEGER[];
  v_are_identical BOOLEAN := TRUE;
  i INTEGER;
BEGIN
  -- Generate tickets with same seed twice
  v_tickets1 := fisher_yates_shuffle(1000, 10, 'consistent_seed', NULL);
  v_tickets2 := fisher_yates_shuffle(1000, 10, 'consistent_seed', NULL);
  
  RAISE NOTICE 'First run:  %', v_tickets1;
  RAISE NOTICE 'Second run: %', v_tickets2;
  
  -- They should be identical (deterministic)
  FOR i IN 1..array_length(v_tickets1, 1) LOOP
    IF v_tickets1[i] != v_tickets2[i] THEN
      v_are_identical := FALSE;
      EXIT;
    END IF;
  END LOOP;
  
  IF NOT v_are_identical THEN
    RAISE EXCEPTION 'FAILED: Same seed should produce identical results (deterministic)';
  END IF;
  
  RAISE NOTICE '✓ Test 3 PASSED: Same seed produces consistent results';
END $$;

RAISE NOTICE '==============================================================================';
RAISE NOTICE 'All tests completed';
RAISE NOTICE '==============================================================================';

ROLLBACK;
