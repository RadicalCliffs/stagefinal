# Transaction Issues Analysis

## Problems Identified

### 1. Negative Top-Up Amounts ✅ FIXED

**Symptom:** Top-up history showing `+$-55.00`, `+$-191.00`

**Root Cause:** UI was unconditionally prepending `+` sign even for negative amounts

**Fix Applied:** 
- File: `src/components/WalletManagement/WalletManagement.tsx`
- Changed display logic to conditionally show sign
- Use `Math.abs()` for the amount value
- Show `-` for negative, `+` for positive

**Status:** ✅ FIXED in commit 388b174

### 2. Why Are Top-Ups Negative? ⚠️ INVESTIGATING

**Observation:** Some transactions in `user_transactions` table have negative amounts for type='topup'

**Possible Causes:**

#### A. Duplicate/Compensating Entries
Some payment systems create compensating entries:
1. Initial charge: +$55
2. Failed/reversed: -$55
3. Retry: +$55

This would explain patterns like: $55, $-55, $-55

#### B. Balance Ledger Mixing
The `balance_ledger` table uses negative amounts for debits:
```sql
amount: -totalCost  // Negative for debit in ledger
```

If somehow balance_ledger entries are being shown as user_transactions, or if the same logic is being applied to both tables, this could cause negative top-ups.

#### C. Trigger Issues
The `user_transactions_post_to_wallet()` trigger calls:
```sql
v_delta := public._wallet_delta_from_txn(NEW.type, NEW.amount);
```

But `_wallet_delta_from_txn` function doesn't exist in migrations. This could be:
- Causing errors that rollback with negative compensating entries
- Using a missing function that defaults to negative

#### D. Webhook Retry Logic
Payment webhooks might be:
1. Creating initial transaction
2. Failing partway through
3. Creating rollback/refund entry
4. Retrying and creating duplicate

### 3. Duplicate Transactions ⚠️ INVESTIGATING

**Observation:** Multiple identical transactions at same timestamp

**Likely Cause:** Webhook retries without idempotency checks

**Evidence:**
```
Feb 5, 2026 • 08:27 AM: +$191.00
Feb 5, 2026 • 08:27 AM: +$-191.00
Feb 5, 2026 • 08:27 AM: +$-191.00
```

This pattern suggests:
1. Initial top-up created: $191
2. Something failed, created reversal: -$191  
3. Retry created another reversal: -$191

**Functions to Check:**
- `supabase/functions/commerce-webhook/index.ts`
- `supabase/functions/onramp-complete/index.ts`
- `supabase/functions/onramp-webhook/index.ts`

**Idempotency Checks Needed:**
1. Check if transaction with same external_id already exists
2. Use `wallet_credited` flag to prevent double-credits
3. Add unique constraints on external payment IDs

### 4. Edge Function Deployment ❌ CRITICAL

**Issue:** Lucky Dip reservations failing with "Failed to fetch"

**Cause:** Edge function not deployed to Supabase

**Details:** See `EDGE_FUNCTION_DEPLOYMENT_ISSUE.md`

**Action Required:** Deploy `lucky-dip-reserve` edge function

## Investigation Needed

### Query to Check User Transactions

```sql
-- Check for negative top-ups
SELECT 
  id,
  type,
  amount,
  payment_provider,
  status,
  created_at,
  tx_id,
  payment_tx_hash
FROM user_transactions
WHERE type = 'topup'
  AND amount < 0
ORDER BY created_at DESC
LIMIT 20;

-- Check for duplicates
SELECT 
  user_id,
  amount,
  payment_provider,
  tx_id,
  created_at,
  COUNT(*) as duplicate_count
FROM user_transactions
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY user_id, amount, payment_provider, tx_id, created_at
HAVING COUNT(*) > 1
ORDER BY created_at DESC;

-- Check balance_ledger vs user_transactions
SELECT 
  'ledger' as source,
  transaction_type,
  amount,
  created_at
FROM balance_ledger
WHERE canonical_user_id = 'prize:pid:0x0ff51ec0ecc9ae1e5e...'
  AND created_at > NOW() - INTERVAL '24 hours'
UNION ALL
SELECT 
  'transactions' as source,
  type as transaction_type,
  amount,
  created_at
FROM user_transactions
WHERE canonical_user_id = 'prize:pid:0x0ff51ec0ecc9ae1e5e...'
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;
```

### Missing Function Issue

The `_wallet_delta_from_txn` function is referenced but not defined. This needs to be:
1. Created in a migration
2. Or removed from trigger if not needed

**Expected Logic:**
```sql
CREATE OR REPLACE FUNCTION _wallet_delta_from_txn(
  p_type text,
  p_amount numeric
) RETURNS numeric AS $$
BEGIN
  -- For top-ups, amount is positive (credit)
  IF p_type IN ('topup', 'top_up', 'top-up') THEN
    RETURN p_amount;
  END IF;
  
  -- For entries, amount is negative (debit)
  IF p_type IN ('entry', 'entry_payment', 'purchase') THEN
    RETURN -p_amount;
  END IF;
  
  -- Default: use amount as-is
  RETURN p_amount;
END;
$$ LANGUAGE plpgsql;
```

## Recommended Actions

### Immediate
1. ✅ Deploy edge function (documented in EDGE_FUNCTION_DEPLOYMENT_ISSUE.md)
2. ✅ Fix UI display (completed)

### Short-term
1. ❌ Run investigation queries to understand negative amounts
2. ❌ Check webhook logs for duplicate/retry patterns
3. ❌ Add idempotency to webhook handlers
4. ❌ Create missing `_wallet_delta_from_txn` function

### Long-term
1. Add comprehensive transaction validation
2. Implement transaction reconciliation tool
3. Add monitoring for duplicate/negative transactions
4. Document transaction flow completely

## Status

**Fixed:**
- ✅ UI display of transaction amounts

**Pending:**
- ❌ Edge function deployment (requires Supabase CLI access)
- ❌ Investigation of negative amounts root cause
- ❌ Fix duplicate transaction creation
- ❌ Create missing database function

**Blocker:**
- Cannot deploy edge functions from this environment
- Need production database access to investigate transactions
- Need webhook logs to debug duplicate creation

---

**Created:** 2026-02-05
**Status:** Partially Fixed - UI corrected, root causes being investigated
