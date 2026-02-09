# Migration Creation Checklist

**ALWAYS follow this checklist BEFORE creating any migration.**

## Pre-Migration: Research Phase

### 1. Check Production Schema Document ✓
- [ ] Open `Substage Schema, functions, triggers & indexes.md`
- [ ] Find the EXACT table schema you're modifying (with line numbers)
- [ ] Note ALL column names with EXACT spelling
- [ ] Note ALL column types with EXACT casing
- [ ] Document any generated columns (these can't be directly set)

### 2. Check Existing Function Signatures ✓
If modifying a function:
- [ ] Search for function name in schema document
- [ ] Note EXACT parameter names (e.g., `p_user_identifier` vs `user_identifier`)
- [ ] Note EXACT parameter types (lowercase: `text`, `numeric`, `uuid`)
- [ ] Note return type
- [ ] Check if function has multiple overloads (different parameter lists)
- [ ] Note schema (public, auth, etc)

### 3. Scan All Existing Migrations ✓
- [ ] List all migrations: `ls supabase/migrations/*.sql`
- [ ] Search for same function/table: `grep -l "function_name" supabase/migrations/*.sql`
- [ ] Identify which migrations created/modified the same objects
- [ ] Note if any created overloads (same name, different parameters)

### 4. Check Frontend Code ✓
If modifying RPC functions:
- [ ] Search frontend for function calls: `grep -r "rpc('function_name'" src/`
- [ ] Note what parameters frontend passes
- [ ] Note what fields frontend expects in return
- [ ] Ensure backward compatibility

### 5. Check for Function Overloads ✓
- [ ] Will this create a function with same name but different parameters?
- [ ] If yes, you MUST drop ALL existing overloads first
- [ ] List all parameter combinations to drop

## Migration Creation Phase

### 6. Write DROP Statements ✓
For functions being replaced:
```sql
-- Drop ALL possible overloads
DROP FUNCTION IF EXISTS public.function_name(param1 text) CASCADE;
DROP FUNCTION IF EXISTS public.function_name(p_param1 text) CASCADE;
DROP FUNCTION IF EXISTS public.function_name(TEXT) CASCADE;
-- Repeat with different parameter names/types
```

**CRITICAL:** 
- Always use `CASCADE` to drop dependent objects
- Drop from both `public` and without schema prefix
- Drop all possible parameter name variations

### 7. Write CREATE Statement ✓
```sql
CREATE OR REPLACE FUNCTION public.function_name(
  p_param1 text,  -- Match production parameter names!
  p_param2 numeric
)
RETURNS TABLE (
  column1 text,
  column2 numeric
) AS $$
BEGIN
  -- Function body
END;
$$ LANGUAGE plpgsql;
```

**CRITICAL:**
- Match production parameter names EXACTLY
- Use lowercase types: `text`, `numeric`, `uuid`, `timestamptz`
- Add comments explaining what changed

### 8. Verify Column References ✓
For each column referenced in migration:
- [ ] Check column exists in PRODUCTION_SCHEMA_REFERENCE.md
- [ ] Spelling matches exactly (case-sensitive)
- [ ] Type matches exactly
- [ ] Not a generated column (can't be in INSERT/UPDATE)

**Common Mistakes:**
- ❌ `transaction_hash` → ✅ `tx_id`
- ❌ `ticket_numbers` → ✅ `ticket_count` or `tickets_count`
- ❌ `ticket_count` (in competition_entries) → ✅ `tickets_count`

### 9. Test Migration Locally ✓
```bash
# If possible, test in local Supabase
supabase db reset
supabase db push
```

### 10. Add Migration Comments ✓
```sql
-- Migration: Fix column references in get_user_transactions
-- Date: 2026-02-02
-- Issue: Column 'transaction_hash' doesn't exist, should be 'tx_id'
-- Changes:
--   - Dropped all overloads of get_user_transactions
--   - Created new version using tx_id column
--   - Maintains backward compatibility by aliasing tx_id AS transaction_hash in SELECT
```

## Post-Migration: Verification Phase

### 11. Verify Migration File ✓
- [ ] File named correctly: `YYYYMMDDHHMMSS_descriptive_name.sql`
- [ ] Contains DROP statements for all overloads
- [ ] Contains CREATE statement with correct signature
- [ ] Has comments explaining changes
- [ ] No references to non-existent columns
- [ ] No references to generated columns in INSERT/UPDATE

### 12. Check for Breaking Changes ✓
- [ ] Does frontend expect different field names?
- [ ] Does return type match frontend expectations?
- [ ] Are all expected fields still returned?
- [ ] Add backward compatibility aliases if needed

### 13. Document Expected Results ✓
Add to migration file or commit message:
- What was broken before
- What this fixes
- Expected behavior after migration
- How to verify it worked

## Emergency Rollback Plan

### If Migration Fails:
1. **Don't panic** - Supabase doesn't auto-apply failed migrations
2. Check error message for exact issue
3. Fix and create new migration (don't edit existing)
4. Previous version still running in production

### If Migration Breaks Production:
1. Create rollback migration immediately
2. Restore previous function definitions
3. Test rollback locally first
4. Apply rollback to production

## Example: Complete Migration Workflow

```sql
-- ============================================
-- Migration: 20260202120000_fix_user_transactions.sql
-- ============================================
-- Issue: get_user_transactions references non-existent columns
-- Columns that DON'T exist: transaction_hash, ticket_numbers
-- Columns that DO exist: tx_id, ticket_count
-- ============================================

-- Step 1: Drop ALL overloads
DROP FUNCTION IF EXISTS public.get_user_transactions(user_identifier text) CASCADE;
DROP FUNCTION IF EXISTS public.get_user_transactions(p_user_identifier text) CASCADE;
DROP FUNCTION IF EXISTS get_user_transactions(text) CASCADE;

-- Step 2: Create new version matching production schema
CREATE OR REPLACE FUNCTION public.get_user_transactions(
  user_identifier text  -- Parameter name from production
)
RETURNS TABLE (
  id uuid,
  canonical_user_id text,
  amount numeric,
  tx_id text,  -- Correct column name
  transaction_hash text,  -- Backward compatibility alias
  ticket_count integer,  -- Correct column name
  created_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ut.id,
    ut.canonical_user_id,
    ut.amount,
    ut.tx_id,
    ut.tx_id AS transaction_hash,  -- Alias for backward compatibility
    ut.ticket_count,
    ut.created_at
  FROM user_transactions ut
  WHERE ut.canonical_user_id = user_identifier
  ORDER BY ut.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Step 3: Add verification query as comment
-- Verify with: SELECT * FROM get_user_transactions('prize:pid:0x...');
```

## Quick Reference

**Before ANY migration:**
1. ✅ Check PRODUCTION_SCHEMA_REFERENCE.md
2. ✅ Check existing migrations for same objects
3. ✅ Search frontend code for usage
4. ✅ List all function overloads to drop
5. ✅ Verify every column exists
6. ✅ Match parameter names exactly
7. ✅ Test locally if possible

**Never assume anything. Always verify.**
