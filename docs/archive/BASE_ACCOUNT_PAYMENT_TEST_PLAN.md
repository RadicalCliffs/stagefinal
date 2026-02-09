# Base Account Payment Fix - Test Plan

## Overview
This document outlines manual and automated testing procedures for the Base Account payment ticket allocation fix.

## Critical Scenarios to Test

### 1. Base Account Payment with Reservation
**Setup:**
- User selects tickets on competition page
- Reservation is created in pending_tickets table
- User clicks "Pay with Base Account"

**Expected Behavior:**
- PaymentModal passes `effectiveReservationId` and `walletAddress` to BaseAccountPaymentService
- Payment completes successfully via Base Account SDK
- Tickets are allocated via normal PATH B (reservation exists)
- User sees success screen with allocated ticket numbers
- `user_transactions` record shows ticket numbers in notes field

**Verification:**
```sql
-- Check user_transactions was updated
SELECT id, status, notes, tx_id, ticket_count 
FROM user_transactions 
WHERE payment_provider = 'base_account' 
AND status = 'completed'
ORDER BY created_at DESC LIMIT 10;

-- Check tickets were allocated
SELECT ticket_number, competition_id, privy_user_id 
FROM tickets 
WHERE order_id IN (SELECT id FROM user_transactions WHERE payment_provider = 'base_account' AND status = 'completed')
ORDER BY created_at DESC LIMIT 10;

-- Check joincompetition entry was created
SELECT uid, competitionid, userid, ticketnumbers, transactionhash
FROM joincompetition
WHERE chain = 'base_account' OR transactionhash IN (
  SELECT tx_id FROM user_transactions WHERE payment_provider = 'base_account' AND status = 'completed'
)
ORDER BY purchasedate DESC LIMIT 10;
```

### 2. Base Account Payment WITHOUT Reservation (Fallback Path)
**Setup:**
- Simulate missing reservation (e.g., expired or not found in storage)
- User has completed payment but reservationId is null

**Expected Behavior:**
- confirm-pending-tickets-proxy uses PATH A (fallback allocation)
- Checks for duplicate entries via sessionId/transactionHash (idempotency)
- Allocates tickets randomly or from selectedTickets array
- Creates tickets table entries
- Creates joincompetition entry
- Updates user_transactions with allocated ticket numbers
- Logs incident via log_confirmation_incident RPC
- Returns {success: true, ticketNumbers, ticketCount, message}

**Verification:**
```sql
-- Check incident was logged
SELECT * FROM confirmation_incidents
WHERE error_type = 'BaseAccountFallbackPath'
ORDER BY created_at DESC LIMIT 5;

-- Check user_transactions was updated with ticket numbers
SELECT id, notes, payment_provider, status
FROM user_transactions
WHERE payment_provider = 'base_account'
AND notes LIKE '%Tickets allocated:%'
ORDER BY created_at DESC LIMIT 10;
```

### 3. Idempotency - Duplicate Confirmation Request
**Setup:**
- Complete a Base Account payment
- Send duplicate confirmation request with same transactionHash/sessionId

**Expected Behavior:**
- Second request detects existing joincompetition entry
- Returns {success: true, alreadyConfirmed: true, ticketNumbers, ticketCount}
- Does NOT allocate duplicate tickets
- Does NOT double-charge or create duplicate entries

**Verification:**
```sql
-- Verify no duplicate entries exist for same transaction hash
SELECT transactionhash, COUNT(*) as entry_count
FROM joincompetition
WHERE transactionhash IN (
  SELECT tx_id FROM user_transactions WHERE payment_provider = 'base_account'
)
GROUP BY transactionhash
HAVING COUNT(*) > 1;

-- Should return 0 rows if idempotency works correctly
```

### 4. Auto-Heal - Recover Failed Allocations
**Setup:**
- Identify completed Base Account payments with missing ticket allocations
- Run payments-auto-heal function

**Manual Execution:**
```bash
# Dry run to see what would be healed
curl -X POST \
  -H "Authorization: Bearer YOUR_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true, "limit": 10}' \
  https://YOUR_PROJECT.supabase.co/functions/v1/payments-auto-heal

# Live run to heal transactions
curl -X POST \
  -H "Authorization: Bearer YOUR_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": false, "limit": 10}' \
  https://YOUR_PROJECT.supabase.co/functions/v1/payments-auto-heal

# Heal specific transaction
curl -X POST \
  -H "Authorization: Bearer YOUR_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"transactionId": "SPECIFIC_UUID"}' \
  https://YOUR_PROJECT.supabase.co/functions/v1/payments-auto-heal
```

**Expected Behavior:**
- Function identifies completed base_account transactions without tickets
- Allocates tickets using assignTickets helper
- Creates joincompetition and tickets entries
- Updates user_transactions notes field
- Returns summary: {success: true, checked: N, healed: M, results: [...]}

**Verification:**
```sql
-- Check healed transactions
SELECT id, notes, updated_at
FROM user_transactions
WHERE notes LIKE '%Auto-healed at%'
AND payment_provider = 'base_account'
ORDER BY updated_at DESC;
```

## Regression Tests

### 5. Normal Payment Flows Still Work
**Test these payment providers to ensure no regression:**
- [ ] Balance payment (spend_permission)
- [ ] Base wallet payment (USDC)
- [ ] Coinbase Commerce
- [ ] One-click payment

**Verify:**
- All payment methods create proper joincompetition entries
- Tickets are allocated correctly
- No duplicate allocations occur

### 6. Balance Ledger Not Triggered for Base Account
**Setup:**
- Complete Base Account payment
- Check database triggers

**Verification:**
```sql
-- Ensure no balance_ledger entries for base_account payments
SELECT * FROM balance_ledger
WHERE transaction_id IN (
  SELECT id FROM user_transactions WHERE payment_provider = 'base_account'
)
ORDER BY created_at DESC LIMIT 10;

-- Should return 0 rows
```

## Performance Tests

### 7. Concurrent Payment Handling
**Setup:**
- Simulate multiple users paying for same competition simultaneously
- Test race condition handling in assignTickets

**Expected Behavior:**
- No duplicate ticket numbers allocated
- All users receive unique tickets
- Retry logic handles conflicts gracefully

## Security Checks

### 8. Input Validation
**Test:**
- Invalid userId formats
- SQL injection attempts in userId/competitionId
- Missing required fields

**Expected Behavior:**
- Proper error messages
- No security vulnerabilities
- Input sanitization works correctly

### 9. Run CodeQL Security Scan
```bash
# This will be run automatically in CI
npm run security-scan  # if configured
```

## Documentation Review

### 10. Code Documentation
- [ ] Frontend changes have clear comments
- [ ] Backend fallback logic is well-documented
- [ ] Auto-heal function has usage examples
- [ ] Incident logging explains context

## Success Criteria

All tests pass when:
- ✅ Base Account payments with reservation work correctly
- ✅ Base Account payments without reservation use fallback successfully
- ✅ Idempotency prevents duplicate allocations
- ✅ Auto-heal successfully recovers failed allocations
- ✅ No regressions in other payment methods
- ✅ No balance ledger entries for base_account
- ✅ No security vulnerabilities introduced
- ✅ All code is properly documented

## Test Execution Log

Date: _________
Tester: _________

| Test # | Scenario | Status | Notes |
|--------|----------|--------|-------|
| 1 | Payment with reservation | ⬜ Pass ⬜ Fail | |
| 2 | Payment without reservation | ⬜ Pass ⬜ Fail | |
| 3 | Idempotency check | ⬜ Pass ⬜ Fail | |
| 4 | Auto-heal function | ⬜ Pass ⬜ Fail | |
| 5 | Regression tests | ⬜ Pass ⬜ Fail | |
| 6 | No balance ledger | ⬜ Pass ⬜ Fail | |
| 7 | Concurrent handling | ⬜ Pass ⬜ Fail | |
| 8 | Input validation | ⬜ Pass ⬜ Fail | |
| 9 | Security scan | ⬜ Pass ⬜ Fail | |
| 10 | Documentation | ⬜ Pass ⬜ Fail | |
