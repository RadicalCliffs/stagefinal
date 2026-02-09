# Migration Verification Checklist

## Overview
This document lists all database migrations that should be deployed for the ticket reservation system to work correctly.

## ⚠️ IMPORTANT NOTE
**Migrations do NOT rebuild on every push.** They must be manually applied to the database.

---

## Required Migrations (Check These Are Deployed)

### 1. Wallet Hygiene Trigger
**File:** `supabase/migrations/20260202110900_fix_balance_trigger_skip_crypto_payments.sql`

**Purpose:** Prevents base_account payments from incorrectly crediting user balance

**Key Functions:**
- `post_user_transaction_to_balance()` - Skips crypto payments
- `user_transactions_post_to_wallet()` - Skips crypto payments

**How to Verify:**
```sql
-- Check trigger functions exist
SELECT proname, prosrc 
FROM pg_proc 
WHERE proname IN ('post_user_transaction_to_balance', 'user_transactions_post_to_wallet');

-- Check triggers are attached
SELECT tgname, tgrelid::regclass, tgfoid::regproc
FROM pg_trigger
WHERE tgname LIKE '%user_transaction%';
```

**Expected Behavior:**
- `payment_provider='base_account'` with `type='entry'` → `amount` should be 0 (or stored in metadata)
- `payment_provider='balance'` with `type='entry'` → `amount` should be negative (debit)
- `payment_provider='base_account'` should NOT modify `sub_account_balances.available_balance`

**Status:** 🟡 NEEDS VERIFICATION

---

### 2. pending_tickets Table
**Expected Schema:**
```sql
CREATE TABLE IF NOT EXISTS pending_tickets (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  competition_id UUID NOT NULL,
  ticket_numbers INTEGER[] NOT NULL,
  ticket_count INTEGER NOT NULL,
  ticket_price NUMERIC NOT NULL,
  total_amount NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  session_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**How to Verify:**
```sql
-- Check table exists
\d pending_tickets

-- Check indexes exist
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'pending_tickets';
```

**Expected Indexes:**
- `idx_pending_tickets_competition` on `competition_id`
- `idx_pending_tickets_user` on `user_id`
- `idx_pending_tickets_status` on `status`
- `idx_pending_tickets_expires` on `expires_at`

**Status:** 🟡 NEEDS VERIFICATION

---

### 3. user_transactions Table
**Expected Columns:**
```sql
-- Key columns for wallet hygiene
canonical_user_id TEXT NOT NULL
amount NUMERIC NOT NULL
type TEXT NOT NULL  -- 'entry', 'topup', 'purchase'
payment_provider TEXT  -- 'base_account', 'balance', 'onramp', etc.
status TEXT NOT NULL
metadata JSONB
posted_to_balance BOOLEAN DEFAULT FALSE
balance_before NUMERIC
balance_after NUMERIC
```

**How to Verify:**
```sql
-- Check table structure
\d user_transactions

-- Check trigger is attached
SELECT tgname, tgrelid::regclass 
FROM pg_trigger 
WHERE tgrelid = 'user_transactions'::regclass;

-- Test the trigger logic (should NOT error)
-- This should succeed (balance payment with negative amount)
BEGIN;
INSERT INTO user_transactions (
  canonical_user_id, amount, type, payment_provider, status
) VALUES (
  'prize:pid:test123', -5.00, 'entry', 'balance', 'completed'
);
ROLLBACK;

-- This should succeed (base_account payment with amount in metadata)
BEGIN;
INSERT INTO user_transactions (
  canonical_user_id, amount, type, payment_provider, status, metadata
) VALUES (
  'prize:pid:test123', 0, 'entry', 'base_account', 'completed', 
  '{"actual_amount": 5.00, "currency": "USDC"}'::jsonb
);
ROLLBACK;
```

**Status:** 🟡 NEEDS VERIFICATION

---

### 4. sub_account_balances Table
**Expected Schema:**
```sql
CREATE TABLE IF NOT EXISTS sub_account_balances (
  id UUID PRIMARY KEY,
  canonical_user_id TEXT NOT NULL UNIQUE,
  available_balance NUMERIC NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_updated TIMESTAMPTZ DEFAULT NOW()
);
```

**How to Verify:**
```sql
-- Check table exists
\d sub_account_balances

-- Check RPC function exists
SELECT proname, prosrc 
FROM pg_proc 
WHERE proname = 'debit_sub_account_balance';
```

**Status:** 🟡 NEEDS VERIFICATION

---

### 5. Get Unavailable Tickets RPC
**File:** `supabase/migrations/20260128082000_fix_get_unavailable_tickets_schema.sql`

**Function:** `get_unavailable_tickets(p_competition_id TEXT)`

**How to Verify:**
```sql
-- Check function exists
SELECT proname, prosrc 
FROM pg_proc 
WHERE proname = 'get_unavailable_tickets';

-- Test it works
SELECT get_unavailable_tickets('your-competition-uuid-here');
```

**Expected Return:** Array of integers (ticket numbers that are unavailable)

**Status:** 🟡 NEEDS VERIFICATION

---

## Missing Migrations (If Any)

### None Required for This Fix
All changes are in application code (TypeScript/JavaScript). No new database migrations needed.

---

## Verification Commands Summary

Run these commands on your production database:

```sql
-- 1. Check all required functions exist
SELECT proname 
FROM pg_proc 
WHERE proname IN (
  'post_user_transaction_to_balance',
  'user_transactions_post_to_wallet',
  'debit_sub_account_balance',
  'get_unavailable_tickets'
);
-- Should return 4 rows

-- 2. Check all required tables exist
SELECT tablename 
FROM pg_tables 
WHERE tablename IN (
  'pending_tickets',
  'user_transactions',
  'sub_account_balances',
  'canonical_users'
) AND schemaname = 'public';
-- Should return 4 rows

-- 3. Check triggers are attached
SELECT tgname, tgrelid::regclass 
FROM pg_trigger 
WHERE tgrelid IN (
  'user_transactions'::regclass,
  'pending_tickets'::regclass
);
-- Should return at least 2 rows

-- 4. Test wallet hygiene trigger (should NOT error)
BEGIN;
  -- Test balance payment (should work)
  INSERT INTO user_transactions (
    canonical_user_id, amount, type, payment_provider, status
  ) VALUES (
    'prize:pid:test', -5.00, 'entry', 'balance', 'completed'
  );
  
  -- Test base_account payment (should work with amount=0)
  INSERT INTO user_transactions (
    canonical_user_id, amount, type, payment_provider, status, metadata
  ) VALUES (
    'prize:pid:test', 0, 'entry', 'base_account', 'completed',
    '{"actual_amount": 5.00}'::jsonb
  );
ROLLBACK;
-- Should complete without errors
```

---

## If Migrations Are Missing

If any of the above verifications fail, apply the missing migrations:

### Option 1: Via Supabase Dashboard
1. Go to SQL Editor in Supabase Dashboard
2. Open the migration file from `supabase/migrations/`
3. Execute the SQL
4. Verify with commands above

### Option 2: Via Supabase CLI
```bash
# Apply all pending migrations
supabase db push

# Or apply specific migration
supabase db execute --file supabase/migrations/20260202110900_fix_balance_trigger_skip_crypto_payments.sql
```

### Option 3: Manual SQL
Copy the SQL from the migration files and execute directly in your database client.

---

## Post-Verification Actions

Once all migrations are verified:

- [ ] Mark all items as ✅ (change 🟡 to ✅)
- [ ] Run test payment with base_account
- [ ] Run test payment with balance
- [ ] Verify both complete successfully
- [ ] Check logs for any trigger errors
- [ ] Monitor for 24 hours

---

## Troubleshooting

### Error: "AAA_CHECKTHISFIRST__AAA: base_account entry must not change internal balance"

**Solution:** The wallet hygiene trigger is correctly enforcing the rule. Ensure your application:
1. Sets `amount=0` for base_account entries
2. Stores actual amount in `metadata` field
3. Does NOT try to modify `sub_account_balances` for crypto payments

### Error: "Function get_unavailable_tickets does not exist"

**Solution:** Apply migration:
```bash
supabase db execute --file supabase/migrations/20260128082000_fix_get_unavailable_tickets_schema.sql
```

### Error: "Table pending_tickets does not exist"

**Solution:** Check initial schema migration is applied:
```bash
supabase db execute --file supabase/migrations/00000000000000_initial_schema.sql
```

---

## Status Summary

| Component | Status | Notes |
|-----------|--------|-------|
| Wallet Hygiene Trigger | 🟡 Needs Verification | Check functions exist |
| pending_tickets Table | 🟡 Needs Verification | Check schema matches |
| user_transactions Table | 🟡 Needs Verification | Check trigger attached |
| sub_account_balances Table | 🟡 Needs Verification | Check RPC exists |
| get_unavailable_tickets RPC | 🟡 Needs Verification | Test function works |

**Legend:**
- 🟡 Needs Verification
- ✅ Verified Working
- ❌ Missing/Broken

---

## Quick Verification Script

Save this as `verify_migrations.sql` and run it:

```sql
-- Quick verification script
-- Run this in Supabase SQL Editor or psql

\echo '=== Checking Functions ==='
SELECT 
  CASE 
    WHEN COUNT(*) = 4 THEN '✅ All functions exist'
    ELSE '❌ Missing functions: ' || (4 - COUNT(*)::text)
  END as status
FROM pg_proc 
WHERE proname IN (
  'post_user_transaction_to_balance',
  'user_transactions_post_to_wallet',
  'debit_sub_account_balance',
  'get_unavailable_tickets'
);

\echo '=== Checking Tables ==='
SELECT 
  CASE 
    WHEN COUNT(*) = 4 THEN '✅ All tables exist'
    ELSE '❌ Missing tables: ' || (4 - COUNT(*)::text)
  END as status
FROM pg_tables 
WHERE tablename IN (
  'pending_tickets',
  'user_transactions',
  'sub_account_balances',
  'canonical_users'
) AND schemaname = 'public';

\echo '=== Checking Triggers ==='
SELECT 
  CASE 
    WHEN COUNT(*) >= 2 THEN '✅ Triggers attached'
    ELSE '⚠️ Expected at least 2 triggers, found: ' || COUNT(*)::text
  END as status
FROM pg_trigger 
WHERE tgrelid IN (
  'user_transactions'::regclass,
  'pending_tickets'::regclass
);

\echo '=== Testing Wallet Hygiene ==='
DO $$
BEGIN
  -- Test balance payment
  BEGIN
    INSERT INTO user_transactions (
      canonical_user_id, amount, type, payment_provider, status
    ) VALUES (
      'prize:pid:test', -5.00, 'entry', 'balance', 'completed'
    );
    RAISE NOTICE '✅ Balance payment test passed';
    ROLLBACK;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '❌ Balance payment test failed: %', SQLERRM;
    ROLLBACK;
  END;
  
  -- Test base_account payment
  BEGIN
    INSERT INTO user_transactions (
      canonical_user_id, amount, type, payment_provider, status, metadata
    ) VALUES (
      'prize:pid:test', 0, 'entry', 'base_account', 'completed',
      '{"actual_amount": 5.00}'::jsonb
    );
    RAISE NOTICE '✅ Base account payment test passed';
    ROLLBACK;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '❌ Base account payment test failed: %', SQLERRM;
    ROLLBACK;
  END;
END $$;
```

Run with:
```bash
psql <your-connection-string> < verify_migrations.sql
```
