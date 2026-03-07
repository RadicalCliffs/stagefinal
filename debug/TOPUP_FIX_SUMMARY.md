# TOPUP ISSUE RESOLUTION - Highblock & Luxe

## Problem Summary

Two users reported topup issues:

1. **Highblock**: $3 topup confirmed but never credited to balance
2. **Luxe**: $5 topup confirmed but never credited to balance

**Status**: ✅ ROOT CAUSE IDENTIFIED | ⚠️ FIX READY TO DEPLOY

---

## Root Cause Analysis

### Bug Location

`supabase/functions/commerce-webhook/index.ts:935-945`

### The Bug

The webhook's idempotency check was incorrectly including `transaction.status` in the "already credited" check:

```typescript
// BUGGY CODE
const alreadyCredited =
  transaction.posted_to_balance === true ||
  transaction.wallet_credited === true ||
  (transaction.status &&
    ["completed", "finished", "confirmed", "success"].includes(
      transaction.status.toLowerCase(),
    ));

if (alreadyCredited) {
  // Skips crediting logic!
}
```

### Why It Broke

1. **Payment confirmed** → Coinbase sets `status = "finished"` in `user_transactions`
2. **Webhook fires** → Looks up transaction, sees `status = "finished"`
3. **Idempotency check** → Thinks payment already credited (WRONG!)
4. **Skips credit logic** → Balance never updated, `posted_to_balance` stays false
5. **User loses money** → Payment taken, balance never credited

### The Fix

Only check OUR system's flags, not the payment provider's status:

```typescript
// FIXED CODE
const alreadyCredited =
  transaction.posted_to_balance === true ||
  transaction.wallet_credited === true;

// Status = "finished" means PAYMENT confirmed (from provider)
// posted_to_balance = true means BALANCE credited (from our system)
// Only the latter should prevent re-crediting
```

---

## Impact Analysis

### Affected Transactions

**Highblock**:

- Transaction: `b1b7a840-142e-40e0-aef1-aab2c157697a`
- Amount: $3.00
- Status: `finished` but `posted_to_balance = false`
- Balance ledger: NO ENTRIES (truly stuck)

**Luxe**:

- Transaction: `ca16d095-d855-4cc1-a866-557741347a65`
- Amount: $5.00
- Status: `finished` but `posted_to_balance = false`
- Balance ledger: ⚠️ MAY have been credited via `charge:pending` event
- Current balance: $7.50 ($5 + $2.5 bonus) suggests one payment credited

### New User Bonus Handling

**Confirmed**: The `credit_balance_with_first_deposit_bonus` function works correctly:

- ✅ Checks `has_used_new_user_bonus` flag
- ✅ Applies 50% bonus on first deposit
- ✅ Creates separate ledger entries for deposit and bonus
- ✅ Updates user record to mark bonus as used

**The issue was NOT with bonus logic** - it was with the webhook never calling the credit function.

---

## Solution Deployment

### 1. Fix Commerce Webhook (Code Change)

**File**: `supabase/functions/commerce-webhook/index.ts`  
**Status**: ✅ FIXED

### 2. Credit Stuck Topups (SQL Script)

**File**: `FIX_STUCK_TOPUPS.sql`  
**Status**: ✅ READY TO RUN

This script:

- Checks balance_ledger to avoid double-crediting
- Credits only truly missing topups
- Updates `posted_to_balance` flags
- **Does NOT apply bonus** (both users already used their bonus)

### 3. Deploy Fixed Webhook

```bash
cd supabase/functions
supabase functions deploy commerce-webhook
```

### 4. Run Credit Script

In Supabase SQL Editor:

```sql
-- Run FIX_STUCK_TOPUPS.sql
```

---

## Prevention

### Changes Made

1. **Removed status check from idempotency logic** - Only trust our internal flags
2. **Enhanced script with deduplication** - Checks ledger before crediting
3. **Better logging** - Shows exactly which reference_id is being used

### Testing Recommendations

1. Make a $3 test topup (Coinbase Commerce)
2. Verify `charge:pending` event credits balance immediately
3. Verify `charge:confirmed` event doesn't double-credit
4. Check `posted_to_balance = true` is set correctly
5. Verify balance_ledger has entries

### Monitoring

Watch for:

- `posted_to_balance = false` with `status = finished` (shouldn't happen anymore)
- Duplicate balance_ledger entries with same reference_id (idempotency working)
- `has_used_new_user_bonus = false` for new users (bonus eligibility)

---

## User Communication

### Highblock

> "Your $3 topup has been credited. We identified a payment processing bug that prevented the balance from updating immediately. This has been fixed and won't happen again."

### Luxe

> "We're investigating your topup issue. Our records show $7.50 in your account (which matches your $5 topup with 50% new user bonus). We're crediting any missing amounts now."

---

## Files Changed

1. ✅ `supabase/functions/commerce-webhook/index.ts` - Fixed idempotency bug
2. ✅ `FIX_STUCK_TOPUPS.sql` - Smart deduplication credit script
3. ✅ `FIX_COMMERCE_WEBHOOK_IDEMPOTENCY_BUG.sql` - Documentation of the fix
4. ✅ `diagnose-highblock-luxe-topups.mjs` - Diagnostic tool for future issues

---

## Next Steps

- [ ] Deploy commerce-webhook with fix
- [ ] Run FIX_STUCK_TOPUPS.sql in production
- [ ] Verify Highblock balance increased by $3
- [ ] Verify Luxe balance (should already be correct or increase by $5)
- [ ] Test new topups work correctly
- [ ] Monitor for 48 hours
- [ ] Close issue once confirmed working

---

**Priority**: 🔴 HIGH - Users lost money  
**Complexity**: 🟢 LOW - Simple logic fix  
**Risk**: 🟡 MEDIUM - Must avoid double-crediting  
**Testing**: ⚪ Required before production deploy
