# WHY USERS HAVE TWO ROWS WITH SAME BALANCE

## Your Question
"So every user has two rows with the same balance on each but just different identifiers, why????"

## The Answer

### What's Happening
Each user has **duplicate rows** in `sub_account_balances`:

```sql
SELECT * FROM sub_account_balances WHERE canonical_user_id = 'prize:pid:0x123';

canonical_user_id | currency | available_balance
------------------+----------+------------------
prize:pid:0x123   | USD      | 100.00
prize:pid:0x123   | USDC     | 100.00  ← Same balance, different currency
```

### Why This Exists

**The Intended Design:**
- `sub_account_balances` was designed to support **multiple currencies**
- Table has a `currency` column to distinguish USD, USDC, EUR, etc.
- UNIQUE constraint on `(canonical_user_id, currency)` allows one row per currency
- This is a **proper multi-currency architecture**

**The Problem:**
- The system **only actually uses USD** in practice
- But something is creating **both USD and USDC rows**
- With the **same balance value** on each
- This is **redundant and confusing**

### Root Cause of Duplication

The broken trigger functions (that we're fixing) likely did this:

```sql
-- Trigger fires when canonical_users is updated
CREATE FUNCTION mirror_canonical_users_to_sub_balances()
RETURNS TRIGGER AS $$
BEGIN
  -- Try to sync balance to USD row
  INSERT INTO sub_account_balances (canonical_user_id, currency, available_balance)
  VALUES (NEW.canonical_user_id, 'USD', NEW.balance_usd)  -- ❌ Wrong column
  ON CONFLICT DO UPDATE SET available_balance = NEW.balance_usd;
  
  -- ALSO sync to USDC row (why???)
  INSERT INTO sub_account_balances (canonical_user_id, currency, available_balance)
  VALUES (NEW.canonical_user_id, 'USDC', NEW.balance_usd)  -- ❌ Wrong column
  ON CONFLICT DO UPDATE SET available_balance = NEW.balance_usd;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**Two problems:**
1. References wrong column name (`balance_usd` instead of `usdc_balance`)
2. Creates duplicate rows for both USD AND USDC with same value

### Why This Is Wasteful

1. **Doubles storage** - Every user has 2 rows instead of 1
2. **Causes confusion** - Which row is the "real" balance?
3. **Slows queries** - Need to filter by currency or risk double-counting
4. **No actual benefit** - If values are always the same, why have both?

### The Fix

**Immediate Fix** (to stop 500 errors):
- Drop the broken trigger functions
- File: `HOTFIX_DROP_BALANCE_USD_TRIGGERS.sql`

**Proper Fix** (to prevent future duplication):
```sql
-- Only create/update USD row, not USDC
CREATE FUNCTION mirror_canonical_users_to_sub_balances()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO sub_account_balances (canonical_user_id, currency, available_balance)
  VALUES (NEW.canonical_user_id, 'USD', NEW.usdc_balance)  -- ✅ Correct column
  ON CONFLICT (canonical_user_id, currency)
  DO UPDATE SET 
    available_balance = NEW.usdc_balance,
    updated_at = NOW();
  
  -- Don't create USDC row unless actually needed
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**Cleanup** (to remove existing duplicates):
```sql
-- Remove USDC rows if they're just duplicates of USD rows
DELETE FROM sub_account_balances
WHERE currency = 'USDC'
  AND EXISTS (
    SELECT 1 FROM sub_account_balances usd
    WHERE usd.canonical_user_id = sub_account_balances.canonical_user_id
      AND usd.currency = 'USD'
      AND usd.available_balance = sub_account_balances.available_balance
  );
```

### Should You Have Multiple Currency Rows?

**Keep separate rows IF:**
- You actually use multiple currencies (USD, USDC, EUR, etc.)
- Users can have different balances in each currency
- You need to track currency separately

**Use single currency IF:**
- You only use USD (or only USDC)
- All "currencies" always have the same value
- The duplication is just waste

### Recommendation

Based on your observation that rows have "same balance on each":

1. **Apply immediate fix** - Drop broken triggers NOW
2. **Check if USDC is used** - Query production data
3. **If USDC unused** - Delete duplicate USDC rows
4. **Recreate triggers** - Only sync to USD row
5. **Update queries** - Always filter `WHERE currency = 'USD'`

### Long-term Architecture

Consider consolidating to a single source of truth:

**Option A: Use canonical_users**
- Remove sub_account_balances entirely
- Simple, single row per user
- No currency confusion

**Option B: Use sub_account_balances only**
- Remove canonical_users.usdc_balance column
- Keep multi-currency support if needed
- Use only USD row if single currency

**Option C: Keep both with proper sync**
- Fix trigger functions
- Use only one currency
- Maintain sync for compatibility

---

## Summary

**Why duplication?** Over-engineered multi-currency design + broken sync function

**Is it needed?** Probably not if balances are always the same

**What to do?** 
1. Apply HOTFIX to stop errors (NOW)
2. Remove duplicate USDC rows (if unused)
3. Simplify to single currency
