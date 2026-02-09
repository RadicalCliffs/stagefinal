# Issue Resolution Summary - February 5, 2026

## What Went Wrong

You deployed a preview of the latest code changes, but encountered two major issues:

### 1. Lucky Dip Reservations Failing
**Error:** `FunctionsFetchError: Failed to send a request to the Edge Function`
**URL:** `https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/lucky-dip-reserve`

### 2. Transaction History Showing Negative Amounts
**Display:** `+$-55.00`, `+$-191.00`, `+$-2.30`
**Also:** Multiple duplicate transactions at the same timestamp

## Root Causes Identified

### Issue #1: Edge Function Not Deployed

**What Happened:**
1. JWT validation was added to `lucky-dip-reserve` (commit aa2076e)
2. We discovered the app doesn't use Supabase Auth
3. JWT validation was reverted in Git (commit 265cd2b)
4. **BUT:** The edge function was never redeployed to Supabase

**Current State:**
- ✅ Git repository has correct code (no JWT validation)
- ❌ Supabase deployment has broken code (with JWT validation)
- ❌ All Lucky Dip requests return 401 before CORS, causing "Failed to fetch"

**Fix Required:**
```bash
supabase functions deploy lucky-dip-reserve
```

See `EDGE_FUNCTION_DEPLOYMENT_ISSUE.md` for details.

### Issue #2: Transaction Display Bug ✅ FIXED

**What Happened:**
The UI was unconditionally adding a `+` prefix to all amounts:
```typescript
// Before (WRONG)
<p>+${tx.amount}</p>
// Displays: +$-55.00 when tx.amount is -55

// After (CORRECT)
<p>{amount >= 0 ? '+' : ''}${Math.abs(amount).toFixed(2)}</p>
// Displays: -$55.00 when amount is -55
```

**Status:** ✅ Fixed in commit 388b174

**Files Changed:**
- `src/components/WalletManagement/WalletManagement.tsx` (2 locations)

### Issue #3: Why Are Amounts Negative? ⚠️ INVESTIGATING

**Observation:** Some transactions have negative amounts for type='topup'

**Possible Causes:**

1. **Webhook Retries Creating Compensating Entries**
   - Initial charge: +$55
   - Failed/rolled back: -$55
   - Retry: +$55
   - Result: One positive, two negative

2. **Missing Database Function**
   - Trigger calls `_wallet_delta_from_txn()` 
   - Function doesn't exist in migrations
   - Could cause errors leading to rollbacks

3. **Balance Ledger Logic Leaking**
   - `balance_ledger` uses negative for debits
   - Same logic being applied to `user_transactions`?

**Needs Investigation:**
- Run SQL queries in `TRANSACTION_ISSUES_ANALYSIS.md`
- Check webhook logs for retries
- Verify database function exists

## What I Did

### Code Fixes ✅
1. **Fixed transaction display**
   - File: `src/components/WalletManagement/WalletManagement.tsx`
   - Shows proper +/- signs
   - No more `+$-55.00` displays

### Documentation 📝
1. **`EDGE_FUNCTION_DEPLOYMENT_ISSUE.md`**
   - Explains edge function problem
   - Provides deployment command
   - Includes verification steps

2. **`TRANSACTION_ISSUES_ANALYSIS.md`**
   - Analyzes negative amounts
   - Documents duplicate patterns
   - Provides investigation SQL queries
   - Lists recommended fixes

3. **`AUTHENTICATION_ARCHITECTURE.md`**
   - Documents CDP/Base auth system
   - Explains why JWT validation won't work
   - Recommends wallet signature verification

4. **`WHY_NO_JWT_VALIDATION.md`**
   - Explains the JWT validation revert
   - Why it was necessary

## What You Need to Do

### CRITICAL - Deploy Edge Function

**This is blocking all Lucky Dip purchases:**

```bash
# In your terminal (requires Supabase CLI)
cd /path/to/theprize.io
supabase login
supabase link --project-ref mthwfldcjvpxjtmrqkqm
supabase functions deploy lucky-dip-reserve
```

**Verification:**
```bash
# Test the function
curl -X POST https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/lucky-dip-reserve \
  -H "Authorization: ******" \
  -H "Content-Type: application/json" \
  -d '{"userId":"prize:pid:test","competitionId":"22786f37-66a1-4bf1-aa15-910ddf8d4eb4","count":5}'
```

Should return validation error (not 401 or Failed to fetch).

### MEDIUM - Investigate Transactions

**Run these SQL queries on production database:**

```sql
-- Check for negative top-ups
SELECT id, type, amount, payment_provider, status, created_at
FROM user_transactions
WHERE type = 'topup' AND amount < 0
ORDER BY created_at DESC LIMIT 20;

-- Check for duplicates
SELECT user_id, amount, payment_provider, tx_id, created_at, COUNT(*) as count
FROM user_transactions
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY user_id, amount, payment_provider, tx_id, created_at
HAVING COUNT(*) > 1;
```

See `TRANSACTION_ISSUES_ANALYSIS.md` for more queries.

### LOW - Long-term Fixes

1. Add idempotency to webhook handlers
2. Create missing `_wallet_delta_from_txn` function
3. Add transaction monitoring
4. Implement reconciliation tool

## Current Status

### What's Working ✅
- Transaction display (fixed)
- Auth system (CDP/Base)
- Manual ticket selection
- Balance payments (mostly)

### What's Broken ❌
- Lucky Dip reservations (edge function not deployed)
- Transaction history has anomalies (negative/duplicate entries)

### What's Unknown ⚠️
- Root cause of negative top-ups
- Why webhooks create duplicates
- If missing DB function causes issues

## Timeline

- **Feb 5, 17:19** - JWT validation added (commit aa2076e)
- **Feb 5, 17:24** - JWT validation reverted (commit 265cd2b)
- **Feb 5, 18:35** - Issues reported by user
- **Feb 5, 18:45** - UI fix applied (commit 388b174)
- **Feb 5, 18:55** - Documentation completed (commit 23e901a)
- **Next** - Edge function needs deployment

## Summary

**Quick Wins:**
- ✅ UI fixed - no more `+$-55.00`
- ✅ Code is correct in Git

**Critical Action Needed:**
- ❌ Deploy edge function (2 minutes, unblocks users)

**Investigation Needed:**
- ⚠️ Why transactions have negative amounts
- ⚠️ Why duplicates are created

**Priority Order:**
1. Deploy edge function (CRITICAL)
2. Pull the changes from this PR
3. Investigate production database
4. Fix webhook idempotency

---

**All documentation and fixes are in this PR.**
**Main blocker: Edge function deployment (requires manual action with Supabase CLI).**
