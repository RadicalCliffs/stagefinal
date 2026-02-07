# CRITICAL UPDATE: Understanding the Balance System Architecture

## The Balance Tables

### canonical_users (Legacy/Simple)
```sql
usdc_balance NUMERIC(20, 8) NOT NULL DEFAULT 0
bonus_balance NUMERIC(20, 8) NOT NULL DEFAULT 0
```
- Single row per user
- Simple balance column

### sub_account_balances (Modern/Multi-currency)
```sql
CREATE TABLE sub_account_balances (
  canonical_user_id TEXT NOT NULL,
  currency TEXT DEFAULT 'USD' NOT NULL,
  available_balance NUMERIC(20, 6) DEFAULT 0 NOT NULL,
  pending_balance NUMERIC(20, 6) DEFAULT 0 NOT NULL,
  bonus_balance NUMERIC(20, 6) DEFAULT 0 NOT NULL,
  UNIQUE(canonical_user_id, currency)
);
```
- Multiple rows per user (one per currency)
- Supports USD, USDC, etc.

## The Redundancy Problem

User observation: **"Every user has two rows with the same balance on each but just different identifiers"**

This means users have:
```
canonical_user_id | currency | available_balance
------------------+----------+------------------
prize:pid:0x123   | USD      | 100.00
prize:pid:0x123   | USDC     | 100.00  ← Same balance!
```

## Root Cause of Trigger Error

The broken trigger functions were likely doing this:

```sql
CREATE FUNCTION mirror_canonical_users_to_sub_balances()
RETURNS TRIGGER AS $$
BEGIN
  -- WRONG: References NEW.balance_usd (doesn't exist)
  INSERT INTO sub_account_balances (canonical_user_id, currency, available_balance)
  VALUES (NEW.canonical_user_id, 'USD', NEW.balance_usd)  -- ❌
  ON CONFLICT (canonical_user_id, currency)
  DO UPDATE SET available_balance = NEW.balance_usd;      -- ❌
  
  -- Might also create USDC row with same value
  INSERT INTO sub_account_balances (canonical_user_id, currency, available_balance)
  VALUES (NEW.canonical_user_id, 'USDC', NEW.balance_usd)  -- ❌
  ON CONFLICT (canonical_user_id, currency)
  DO UPDATE SET available_balance = NEW.balance_usd;       -- ❌
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### Issues:
1. References `NEW.balance_usd` - column doesn't exist
2. Should reference `NEW.usdc_balance`
3. Creates duplicate rows for USD and USDC with same value
4. Causes confusion and data redundancy

## The Fix Options

### Option 1: Drop the Broken Triggers (Current Fix)
**File**: `HOTFIX_DROP_BALANCE_USD_TRIGGERS.sql`

✅ Removes broken sync functions
✅ Stops 500 errors immediately
⚠️ No more auto-sync between tables

### Option 2: Recreate with Correct Column Names
Create new functions that:
- Reference `NEW.usdc_balance` (correct column)
- Only create USD row (not duplicate USDC row)
- Keep tables in sync

### Option 3: Consolidate Balance System
- Pick one table as source of truth
- Remove redundant syncing
- Simplify architecture

## Recommended Approach

### Immediate (NOW):
Apply `HOTFIX_DROP_BALANCE_USD_TRIGGERS.sql` to stop errors

### Short-term (Today):
Recreate sync functions with correct column name:

```sql
CREATE OR REPLACE FUNCTION mirror_canonical_users_to_sub_balances()
RETURNS TRIGGER AS $$
BEGIN
  -- Use NEW.usdc_balance (correct column)
  INSERT INTO sub_account_balances (canonical_user_id, currency, available_balance)
  VALUES (NEW.canonical_user_id, 'USD', NEW.usdc_balance)
  ON CONFLICT (canonical_user_id, currency)
  DO UPDATE SET 
    available_balance = NEW.usdc_balance,
    updated_at = NOW();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### Long-term (This Week):
1. Decide on single source of truth for balances
2. Remove redundant USDC rows (if not actually used)
3. Simplify balance architecture
4. Add migration to clean up duplicate currency rows

## Why the Duplication Exists

Likely scenarios:
1. **Multi-currency vision**: System designed to support multiple currencies
2. **Implementation gap**: Only USD actually used in practice
3. **Overzealous syncing**: Mirror function creates both USD and USDC rows
4. **Legacy migration**: Old system had different structure, new one overbuilt

## Impact Analysis

### Current State:
- ❌ Users can't purchase (500 error)
- ❌ Trigger functions reference wrong column
- ⚠️ Duplicate currency rows cause confusion
- ⚠️ Extra storage used for redundant rows

### After HOTFIX:
- ✅ Users can purchase
- ⚠️ No auto-sync between tables
- ⚠️ Duplicate currency rows still exist
- ⚠️ Manual sync needed if tables diverge

### After Proper Fix:
- ✅ Users can purchase
- ✅ Auto-sync works correctly
- ⚠️ Still have duplicate currency rows (unless cleaned)

### After Cleanup:
- ✅ Users can purchase
- ✅ Auto-sync works correctly
- ✅ No duplicate currency rows
- ✅ Clear architecture

---

**Immediate Action**: Apply `HOTFIX_DROP_BALANCE_USD_TRIGGERS.sql` NOW to unblock purchases.

**Follow-up Action**: Recreate sync functions with correct column name and currency strategy.
