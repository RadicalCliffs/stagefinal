-- ============================================================================
-- TEST: Check what the function actually returns
-- ============================================================================

SELECT credit_balance_with_first_deposit_bonus(
  'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363',
  3,
  'Test credit 2',
  'TOPUP_prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363_36d6366e-da18-44bf-b150-c89340b66ad3'
) AS result;
