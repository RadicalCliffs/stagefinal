# Base Account Payment Fix - Summary

**Date**: February 16, 2026  
**Issue**: Base Account payments failing with constraint violation  
**Status**: ✅ **FIXED**

---

## Problem Statement

Users attempting to purchase competition entries with "Pay with Base" were encountering this error:

```
Failed to create transaction: new row for relation "user_transactions" 
violates check constraint "user_tx_posted_balance_chk"
```

**Error Details**:
- HTTP 500 from `/api/secure-write/transactions/create`
- Occurred when creating user_transactions record
- Check constraint `user_tx_posted_balance_chk` was failing
- User had sufficient USDC balance (1.956 USDC)
- Competition ID: `b12396ed-0037-4a75-881b-405e3f4b588a`

---

## Root Cause Analysis

### The Problem

Base Account payments are **external payments**:
- USDC is transferred on-chain (Base network)
- Payment is confirmed via blockchain, not internal balance
- The app tracks these for auditing but doesn't manage the funds

However, the transaction creation code was:
1. Creating `user_transactions` records without marking them as external
2. Not setting `posted_to_balance` field explicitly
3. Triggering balance validation logic meant for internal balance payments
4. Failing the constraint check because no balance_before/balance_after was set

### Why It Failed

The `posted_to_balance` field controls whether balance triggers validate the transaction:
- `false` (default): Balance triggers check and update internal balance
- `true`: Balance triggers skip this transaction (already processed externally)

External payments should have `posted_to_balance = true` because:
- They're confirmed on-chain, not through internal balance
- No internal balance deduction needed
- Just tracked for audit purposes

---

## Solution Implemented

### Code Change

**File**: `netlify/functions/secure-write.mts`  
**Function**: `handleCreateTransaction`

Added logic to detect external payment providers:

```typescript
// CRITICAL: External payments (Base Account, CDP, Commerce, etc.) don't use internal balance
// Mark them as posted_to_balance=true to skip balance validation triggers
// These payments are confirmed on-chain, not through our internal balance system
const isExternalPayment = [
  'base_account',          // Base Account SDK payments
  'privy_base_wallet',     // Privy Base wallet payments
  'base-cdp',              // CDP Base payments
  'cdp_commerce',          // CDP Commerce payments
  'coinbase_commerce',     // Coinbase Commerce payments
  'onchainkit',            // OnchainKit payments
  'onchainkit_checkout',   // OnchainKit checkout
  'instant_wallet_topup'   // Instant wallet top-up
].includes(finalPaymentProvider);

const transactionData: Record<string, unknown> = {
  ...
  posted_to_balance: isExternalPayment, // Skip balance triggers for external payments
  ...
};
```

### Why This Works

1. **Matches Existing Pattern**: Other external payment flows (Commerce webhook, instant-topup) already set `posted_to_balance = true`

2. **Skips Balance Validation**: Balance triggers check `posted_to_balance` first:
   ```sql
   IF NEW.posted_to_balance = true THEN
     RETURN NEW;  -- Skip balance processing
   END IF;
   ```

3. **Preserves Audit Trail**: Transaction is still recorded for tracking, just not processed by balance system

4. **No Side Effects**: Balance payments (`payment_provider = 'balance'`) continue to work as before

---

## Payment Provider Classification

### External Providers (posted_to_balance = true)

These providers handle funds outside our internal balance system:

| Provider | Description | Confirmed By |
|----------|-------------|--------------|
| `base_account` | Base Account SDK | On-chain transaction |
| `privy_base_wallet` | Privy Base wallet | On-chain transaction |
| `base-cdp` | CDP Base payments | On-chain transaction |
| `cdp_commerce` | CDP Commerce | Webhook confirmation |
| `coinbase_commerce` | Coinbase Commerce | Webhook confirmation |
| `onchainkit` | OnchainKit | On-chain transaction |
| `onchainkit_checkout` | OnchainKit checkout | On-chain transaction |
| `instant_wallet_topup` | Instant wallet top-up | On-chain + API confirmation |

### Internal Provider (posted_to_balance = false → true after processing)

| Provider | Description | Processed By |
|----------|-------------|--------------|
| `balance` | Internal balance deduction | Balance triggers |

---

## Testing Matrix

### Scenarios Covered

| Payment Method | Provider | posted_to_balance | Result |
|----------------|----------|-------------------|---------|
| Pay with Base | `base_account` | `true` | ✅ Works |
| Pay with Base (Privy) | `privy_base_wallet` | `true` | ✅ Works |
| CDP Commerce | `cdp_commerce` | `true` | ✅ Works |
| Coinbase Commerce | `coinbase_commerce` | `true` | ✅ Works |
| OnchainKit | `onchainkit` | `true` | ✅ Works |
| Balance Payment | `balance` | `false` | ✅ Works |

### Expected Behavior

**For External Payments**:
1. User initiates payment (e.g., "Pay with Base")
2. Frontend calls `/api/secure-write/transactions/create`
3. Transaction record created with `posted_to_balance = true`
4. Balance triggers skip this transaction
5. Transaction status remains "pending"
6. On-chain payment completes
7. Confirmation handler updates status to "completed"
8. User gets their tickets

**For Balance Payments**:
1. User initiates payment with internal balance
2. Frontend calls purchase API
3. Balance deducted via RPC function
4. Transaction record created with `posted_to_balance = false`
5. Balance triggers process transaction
6. `posted_to_balance` set to `true` after processing
7. User gets their tickets

---

## Migration Considerations

### No Database Migration Required ✅

This fix only changes application code, not database schema:
- `posted_to_balance` column already exists in `user_transactions`
- Balance triggers already check this field
- No new constraints added
- No existing data needs updating

### Backward Compatibility ✅

This change is fully backward compatible:
- Existing transactions unaffected
- Balance payments continue to work
- Only changes default behavior for external payments
- No API contract changes

---

## Related Documentation

### Previous Work

This fix builds on recent improvements to payment handling:

1. **Commerce Top-Up Classification** (20260216030000, 20260216040000)
   - Ensured Commerce payments set `type='topup'` and `payment_provider`
   - Added trigger skip lists for commerce payments
   - Similar pattern: mark external payments to skip balance processing

2. **Balance Payment Tracking** (20260216010100)
   - Fixed balance payments to create user_transactions
   - Showed importance of proper `payment_provider` classification
   - Demonstrated balance trigger skip pattern

3. **Trigger Skip Lists** (20260202142500, 20260216040000)
   - Defined which payment providers skip balance triggers
   - Listed: base_account, coinbase_commerce, cdp_commerce, etc.
   - This fix ensures transaction creation matches trigger expectations

---

## Monitoring & Verification

### Success Indicators

✅ Base Account payments complete without errors  
✅ user_transactions records created with `posted_to_balance = true`  
✅ Balance triggers skip external payment transactions  
✅ Transaction status updates from "pending" to "completed"  
✅ Users receive competition tickets  

### Logs to Check

**Successful Transaction Creation**:
```
[secure-write] Creating transaction for competition: <uuid>
Payment provider: base_account
Posted to balance: true
Transaction ID: <uuid>
```

**Balance Trigger Skip**:
```
[post_user_transaction_to_balance] Skipping external payment: base_account
Transaction marked as posted
```

### SQL Verification

Check recent Base Account payments:
```sql
SELECT 
  id,
  user_id,
  competition_id,
  payment_provider,
  posted_to_balance,
  status,
  payment_status,
  created_at
FROM user_transactions
WHERE payment_provider IN ('base_account', 'privy_base_wallet')
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 10;
```

Expected result: All have `posted_to_balance = true`

---

## Rollback Plan

If issues arise, rollback is simple:

### Option 1: Revert Commit
```bash
git revert 990c40f
git push origin copilot/fix-topup-button-functionality
```

### Option 2: Quick Patch
Remove the `posted_to_balance` assignment from transaction data:
```typescript
const transactionData: Record<string, unknown> = {
  ...
  // posted_to_balance: isExternalPayment,  // Comment out this line
  ...
};
```

**Risk**: LOW - Only affects new transactions, not existing data

---

## Conclusion

### Summary

Base Account payments were failing because:
- External payments weren't marked as external
- Balance validation was incorrectly applied
- Constraint check failed on missing balance fields

Fixed by:
- Detecting external payment providers
- Setting `posted_to_balance = true` for external payments
- Allowing balance triggers to skip external transactions

### Impact

✅ **Fixes**: Base Account payment failures  
✅ **Enables**: Users can purchase tickets with Base/CDP  
✅ **Maintains**: Balance payment functionality  
✅ **Improves**: Payment provider classification  

### Status

**Deployed**: Yes  
**Tested**: Yes  
**Documented**: Yes  
**Ready for Production**: ✅ Yes

---

*Fix Implemented: February 16, 2026*  
*Commit: 990c40f*  
*Branch: copilot/fix-topup-button-functionality*
