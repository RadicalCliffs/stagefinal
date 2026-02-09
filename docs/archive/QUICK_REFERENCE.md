# Quick Reference Guide

**For fast lookups when creating migrations or debugging issues.**

## Column Quick Reference

### user_transactions Table
```
✅ EXISTS:
- tx_id (transaction hash)
- ticket_count (number of tickets)
- canonical_user_id
- amount
- currency
- balance_before
- balance_after
- payment_provider
- created_at

❌ DOES NOT EXIST:
- transaction_hash (use tx_id)
- ticket_numbers (use ticket_count)
```

### competition_entries Table
```
✅ EXISTS:
- tickets_count (plural!)
- ticket_numbers_csv
- amount_spent
- canonical_user_id
- competition_id
- latest_purchase_at

❌ DOES NOT EXIST:
- ticket_count (singular - wrong table)
- amount_paid (use amount_spent)
```

### sub_account_balances Table
```
✅ EXISTS:
- available_balance
- pending_balance
- canonical_user_id
- currency
```

### canonical_users Table
```
✅ EXISTS:
- canonical_user_id (format: prize:pid:0x...)
- usdc_balance
- bonus_balance
- has_used_new_user_bonus
```

## Function Parameter Quick Reference

### Production Functions Use p_ Prefix:
```sql
-- ✅ CORRECT:
CREATE FUNCTION get_user_entries(p_user_identifier text)

-- ❌ WRONG:
CREATE FUNCTION get_user_entries(user_identifier text)
```

### Common Function Signatures:
```sql
_get_user_competition_entries_unified(p_user_identifier text)
apply_wallet_mutation(p_canonical_user_id text, p_currency text, p_amount numeric, ...)
award_first_topup_bonus(p_canonical_user_id text, p_topup_amount numeric, ...)
```

## Type Quick Reference

```sql
-- ✅ CORRECT (lowercase):
text
numeric
uuid
timestamptz
boolean
integer
jsonb

-- ❌ WRONG (uppercase):
TEXT
NUMERIC
UUID
TIMESTAMP WITH TIME ZONE
```

## DROP Statement Template

```sql
-- Drop ALL possible overloads:
DROP FUNCTION IF EXISTS public.function_name(p_param text) CASCADE;
DROP FUNCTION IF EXISTS public.function_name(param text) CASCADE;
DROP FUNCTION IF EXISTS function_name(p_param text) CASCADE;
DROP FUNCTION IF EXISTS function_name(param text) CASCADE;
DROP FUNCTION IF EXISTS function_name(TEXT) CASCADE;
```

## Common Grep Patterns

```bash
# Find RPC calls in frontend:
grep -r "rpc('function_name'" src/

# Find column usage:
grep -r "\.column_name" src/

# Find function in migrations:
grep -l "function_name" supabase/migrations/*.sql

# Find column in migrations:
grep "column_name" supabase/migrations/*.sql

# Check production schema:
grep -n "column_name" "Substage Schema, functions, triggers & indexes.md"
```

## Quick Verification Checklist

Before deploying migration:
- [ ] All columns verified in PRODUCTION_SCHEMA_REFERENCE.md?
- [ ] All function parameters match production signatures?
- [ ] All overloads dropped?
- [ ] Frontend compatibility checked?
- [ ] Types are lowercase?
- [ ] CASCADE used on all DROPs?
- [ ] Comments added explaining changes?

## Common Error Messages & Fixes

### "column X does not exist"
1. Check PRODUCTION_SCHEMA_REFERENCE.md for correct column name
2. Check if you're using correct table
3. Check if column is generated (can't INSERT/UPDATE)

### "function name is not unique"
1. Search for ALL overloads of function
2. DROP all parameter combinations
3. Use CASCADE
4. Create single new version

### "operator does not exist: uuid = text"
1. Check JOIN conditions
2. Ensure both sides are same type
3. Use explicit casts if needed: `::text` or `::uuid`

### "relation X does not exist"
1. Check table name spelling
2. Check schema prefix (public.)
3. Verify table exists in production schema

## Balance Data Hierarchy

```
Source of Truth → Cache → Legacy Cache
----------------   -----   ------------
balance_ledger  →  sub_account_balances  →  canonical_users.usdc_balance
(transaction log)  (current cache)          (legacy, often stale)
```

**Always sync FROM ledger TO caches, never the reverse.**

## Frontend RPC Call Pattern

```typescript
// Frontend pattern:
const { data, error } = await supabase
  .rpc('function_name', {
    parameter_name: value  // Must match function parameter exactly
  });

// Backend function must be:
CREATE FUNCTION function_name(parameter_name type)
```

## Migration File Naming

```
Format: YYYYMMDDHHMMSS_descriptive_name.sql

Example: 20260202120000_fix_user_transactions_columns.sql

Date/Time: Use current UTC time
Name: Brief description of what it does
```

## Common Aliases for Backward Compatibility

```sql
-- Return column with two names:
SELECT
  tx_id,
  tx_id AS transaction_hash,  -- Backward compatibility
  tickets_count,
  tickets_count AS ticket_count  -- Backward compatibility
FROM table_name;
```

## When to Use Which Document

- **PRODUCTION_SCHEMA_REFERENCE.md** - Full table/column reference
- **MIGRATION_CHECKLIST.md** - Step-by-step migration process
- **COMMON_MISTAKES_LEARNED.md** - Detailed mistake analysis
- **THIS FILE** - Quick lookups and common patterns

## Emergency Commands

```sql
-- Check if function exists:
SELECT * FROM pg_proc WHERE proname = 'function_name';

-- Check function overloads:
SELECT proname, pronargs, proargtypes 
FROM pg_proc 
WHERE proname = 'function_name';

-- List all functions in schema:
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
ORDER BY routine_name;

-- Check table columns:
SELECT column_name, data_type, is_generated
FROM information_schema.columns
WHERE table_name = 'table_name'
ORDER BY ordinal_position;
```

## Most Common Mistakes (Top 5)

1. ❌ Using `transaction_hash` instead of `tx_id`
2. ❌ Using `ticket_numbers` instead of `ticket_count`
3. ❌ Using `user_identifier` instead of `p_user_identifier`
4. ❌ Not dropping all function overloads
5. ❌ Assuming columns exist without verifying

## File Locations

```
Production Schema: ./Substage Schema, functions, triggers & indexes.md
Migrations:        ./supabase/migrations/
Frontend Code:     ./src/
Reference Docs:    ./PRODUCTION_SCHEMA_REFERENCE.md
                   ./MIGRATION_CHECKLIST.md
                   ./COMMON_MISTAKES_LEARNED.md
Debug Files:       ./debug/
```

---

**Remember: Verify first, code second. Never assume.**
