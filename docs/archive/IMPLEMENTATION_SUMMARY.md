# Base Account Payment Fix - Implementation Summary

## What Was Fixed

This PR resolves the critical issue where Base Account payments succeed but tickets are not allocated.

## Root Causes Addressed

### 1. Frontend Issue
**Problem:** PaymentModal wasn't passing `reservationId` and `walletAddress` to the payment service.

**Fix:** 
- Changed line 762 in `PaymentModal.tsx` to use `effectiveReservationId` instead of `reservationId`
- This includes reservations recovered from sessionStorage
- Already passed `walletAddress` from `getPrimaryWalletAddress()` on line 750

### 2. Backend Missing Fallback
**Problem:** When reservationId is null/missing, no tickets were allocated even after successful payment.

**Fix:**
- Added user_transactions update in `confirm-pending-tickets-proxy.mts` line 791-804
- Added incident logging for base_account fallback on line 806-834
- Existing PATH A (line 537+) already handles allocation when no reservation exists

### 3. No Recovery Mechanism
**Problem:** No way to heal past failed allocations.

**Fix:**
- Documented that `payments-auto-heal` function already supports base_account
- Added comprehensive usage documentation with examples (line 1-52)

## Files Changed

1. **src/components/PaymentModal.tsx**
   - Line 762: Use `effectiveReservationId` instead of `reservationId`
   - Line 760-765: Enhanced logging

2. **netlify/functions/confirm-pending-tickets-proxy.mts**
   - Line 791-804: Update user_transactions with ticket numbers
   - Line 806-834: Log incident when base_account uses fallback path

3. **supabase/functions/payments-auto-heal/index.ts**
   - Line 1-52: Added comprehensive documentation header
   - Line 294-311: Added comment about base_account support

4. **BASE_ACCOUNT_PAYMENT_TEST_PLAN.md** (new file)
   - Complete testing guide with SQL queries
   - 10 test scenarios covering all edge cases

## How It Works

### Normal Flow (with reservation)
```
User selects tickets → Reservation created → PaymentModal opens
→ User clicks "Pay with Base Account"
→ PaymentModal calls BaseAccountPaymentService.purchaseTickets with:
  - effectiveReservationId (from prop or recovered from storage)
  - walletAddress
  - userId, competitionId, ticketCount, selectedTickets
→ Payment succeeds via Base Account SDK
→ Backend confirm-pending-tickets receives:
  - reservationId ✓
  - userId, competitionId, transactionHash, etc.
→ PATH B executes (reservation exists)
→ Tickets allocated, joincompetition entry created
→ Success!
```

### Fallback Flow (without reservation)
```
Payment succeeds but reservationId is null/missing
→ Backend confirm-pending-tickets receives:
  - reservationId = null
  - sessionId = transactionId
  - userId, competitionId, transactionHash, ticketCount
→ PATH A executes (no reservation)
→ Check for existing entry by transactionHash (idempotency)
→ If not exists:
  - Allocate tickets using assignTickets()
  - Create tickets table entries
  - Create joincompetition entry
  - Update user_transactions.notes with ticket numbers ✓ NEW
  - Log incident via log_confirmation_incident ✓ NEW
→ Success!
```

### Auto-Heal Flow (recover past failures)
```
Admin identifies failed allocations
→ Run: curl -X POST ... /payments-auto-heal -d '{"dryRun": false}'
→ Function queries user_transactions:
  - status IN ('finished', 'completed', 'confirmed')
  - type = 'entry'
  - competition_id IS NOT NULL
  - Includes base_account payments ✓
→ For each transaction without tickets:
  - Allocate tickets
  - Create joincompetition entry
  - Update user_transactions.notes
→ Returns summary of healed transactions
```

## Testing Instructions

### Quick Smoke Test
1. Open browser console
2. Navigate to competition page
3. Select tickets
4. Click "Pay with Base Account"
5. Complete payment in Base Account popup
6. Check console for logs:
   ```
   [PaymentModal] Starting Base Account payment flow
   walletAddress: 0x1234...
   reservationId: uuid-xxxx or 'none'
   ticketCount: N
   ```
7. Verify success screen shows allocated tickets
8. Check database:
   ```sql
   -- Most recent base_account transaction
   SELECT id, status, notes, tx_id 
   FROM user_transactions 
   WHERE payment_provider = 'base_account' 
   ORDER BY created_at DESC LIMIT 1;
   
   -- Should show: notes = "Tickets allocated: 1, 2, 3"
   ```

### Full Test Suite
See [BASE_ACCOUNT_PAYMENT_TEST_PLAN.md](./BASE_ACCOUNT_PAYMENT_TEST_PLAN.md) for complete testing procedures.

## Verification Checklist

- [ ] Frontend passes `effectiveReservationId` and `walletAddress`
- [ ] Backend PATH A allocates tickets when reservationId is missing
- [ ] user_transactions.notes updated with ticket numbers
- [ ] Incidents logged via log_confirmation_incident
- [ ] Idempotency prevents duplicate allocations
- [ ] Auto-heal function can recover failed allocations
- [ ] No balance ledger entries for base_account
- [ ] No security vulnerabilities (CodeQL passed)
- [ ] All payment methods still work (no regressions)

## Rollback Plan

If issues arise:
1. Revert PaymentModal.tsx changes:
   ```diff
   - reservationId: effectiveReservationId,
   + reservationId,
   ```
2. Remove incident logging (lines 806-834 in confirm-pending-tickets-proxy.mts)
3. Remove user_transactions update (lines 791-804)

The core PATH A logic was already present, so minimal risk.

## Support Queries

### Find transactions that used fallback path
```sql
SELECT * FROM confirmation_incidents
WHERE error_type = 'BaseAccountFallbackPath'
ORDER BY created_at DESC;
```

### Find base_account transactions with allocated tickets
```sql
SELECT id, status, notes, payment_provider, created_at
FROM user_transactions
WHERE payment_provider = 'base_account'
AND notes LIKE '%Tickets allocated:%'
ORDER BY created_at DESC;
```

### Find base_account transactions needing healing
```sql
SELECT ut.id, ut.competition_id, ut.user_privy_id, ut.ticket_count, ut.created_at
FROM user_transactions ut
WHERE ut.payment_provider = 'base_account'
AND ut.status IN ('finished', 'completed', 'confirmed')
AND ut.type = 'entry'
AND NOT EXISTS (
  SELECT 1 FROM joincompetition jc 
  WHERE jc.transactionhash = ut.tx_id
)
ORDER BY ut.created_at DESC;
```

## Monitoring

After deployment, monitor:
1. `confirmation_incidents` table for BaseAccountFallbackPath entries
2. `user_transactions` for base_account payments
3. User support tickets about missing tickets
4. Console logs for Base Account payment flows

## Next Steps

1. Deploy to staging
2. Run manual tests from test plan
3. Monitor for 24-48 hours
4. If stable, deploy to production
5. Run auto-heal function to recover past failures
6. Update user support documentation
