# Common Mistakes & Lessons Learned

**Purpose:** Document every mistake made so they're never repeated.

## Mistake #1: Incremental Discovery Instead of Upfront Analysis

### What Happened:
- Fixed `ticket_numbers` column error
- Deployed migration
- Got `transaction_hash` column error  
- Should have found BOTH errors before first migration

### Root Cause:
- Didn't scan ALL column references before creating migration
- Fixed one error when reported instead of finding all related errors
- Reactive instead of proactive

### Lesson Learned:
✅ **ALWAYS do complete scan FIRST:**
1. Search entire migration for ALL column references
2. Verify EACH column exists in production schema
3. Fix ALL errors in ONE migration
4. Don't fix errors one-at-a-time as they're discovered

### Prevention:
- Use checklist: "Verify Column References" section
- Grep for all `ut.`, `ce.`, `c.` prefixes in SQL
- Check each against PRODUCTION_SCHEMA_REFERENCE.md
- Document all issues before writing any fixes

---

## Mistake #2: Function Overload Conflicts

### What Happened:
```
ERROR: 42725: function name "get_comprehensive_user_dashboard_entries" is not unique
HINT: Specify the argument list to select the function unambiguously.
```

### Root Cause:
- Different migrations created functions with different parameter names:
  - `p_user_identifier TEXT`
  - `user_identifier text`
- PostgreSQL treats these as DIFFERENT functions (overloads)
- DROP statement didn't specify which version to drop
- Used: `DROP FUNCTION IF EXISTS get_comprehensive_user_dashboard_entries(TEXT)`
- Should drop ALL overloads explicitly

### Lesson Learned:
✅ **ALWAYS drop ALL possible overloads:**
```sql
DROP FUNCTION IF EXISTS public.function_name(p_param text) CASCADE;
DROP FUNCTION IF EXISTS public.function_name(param text) CASCADE;
DROP FUNCTION IF EXISTS function_name(TEXT) CASCADE;
DROP FUNCTION IF EXISTS function_name(text) CASCADE;
```

### Prevention:
- Search existing migrations for same function name
- List all parameter combinations used historically
- Drop every possible combination before CREATE
- Use CASCADE to handle dependencies

---

## Mistake #3: Assuming Column Names Without Verification

### What Happened:
- Referenced `transaction_hash` column
- Column doesn't exist in production
- Should be `tx_id`

### Root Cause:
- Made assumption based on what "makes sense"
- Didn't check production schema document
- Copied from another migration without verifying

### Lesson Learned:
✅ **NEVER assume, ALWAYS verify:**
1. Open PRODUCTION_SCHEMA_REFERENCE.md
2. Find exact table section
3. Verify column name spelling
4. Verify column type
5. Check if it's a generated column

### Prevention:
- Before writing SELECT with column name
- Before writing INSERT with column value
- Before writing WHERE with column filter
- Check production schema EVERY TIME

---

## Mistake #4: Ignoring Parameter Name Conventions

### What Happened:
- Created function with `user_identifier text` parameter
- Production uses `p_user_identifier text` (with `p_` prefix)
- Creates overload instead of replacing

### Root Cause:
- Didn't check existing function signature in production
- Assumed parameter names don't matter
- They DO matter - PostgreSQL uses them for overload resolution

### Lesson Learned:
✅ **Match parameter names EXACTLY:**
- Search production schema for existing function
- Copy parameter list exactly
- Include `p_` prefix if production uses it
- Match parameter order exactly

### Prevention:
- Section in checklist: "Check Existing Function Signatures"
- Search schema doc for function before modifying
- Copy-paste parameter list from production
- Don't change parameter names "for clarity"

---

## Mistake #5: Not Checking Frontend Impact

### What Happened:
- Modified RPC function return type
- Frontend expected different fields
- Orders tab stayed empty

### Root Cause:
- Changed backend without checking frontend code
- Didn't verify what fields frontend actually uses
- Assumed RPC changes wouldn't affect frontend

### Lesson Learned:
✅ **ALWAYS check frontend before changing RPCs:**
```bash
# Search for RPC calls
grep -r "rpc('function_name'" src/

# Search for field usage
grep -r "field_name" src/
```

### Prevention:
- Section in checklist: "Check Frontend Code"
- Search for `.rpc(` calls
- Note what parameters are passed
- Note what fields are accessed in response
- Ensure backward compatibility

---

## Mistake #6: Using Wrong Column in Wrong Table

### What Happened:
- Used `ticket_count` in `competition_entries` table
- That table has `tickets_count` (plural)
- `ticket_count` (singular) is in `user_transactions` table

### Root Cause:
- Similar column names in different tables
- Didn't check which table query was using
- Assumed column name is same everywhere

### Lesson Learned:
✅ **Column names vary by table:**
- `user_transactions.ticket_count` (singular)
- `competition_entries.tickets_count` (plural)
- Check WHICH table you're querying
- Verify column name for THAT specific table

### Prevention:
- PRODUCTION_SCHEMA_REFERENCE.md lists columns by table
- Always note which table alias in query
- Look up column in correct table section
- Don't assume same column name across tables

---

## Mistake #7: Forgetting About Generated Columns

### What Happened:
- Tried to INSERT into `provider` column
- Column is GENERATED from `metadata` jsonb
- Can't directly set generated columns

### Root Cause:
- Didn't check if column is generated
- Assumed all columns can be set
- Schema document marks generated columns

### Lesson Learned:
✅ **Check if column is generated:**
- PRODUCTION_SCHEMA_REFERENCE.md marks: `**GENERATED from metadata**`
- Can't use in INSERT or UPDATE
- Must set source column instead

### Prevention:
- Look for "GENERATED" marker in schema doc
- If column is computed, set its source instead
- Example: Set `metadata` not `provider`

---

## Mistake #8: Not Dropping Schema-Prefixed Functions

### What Happened:
- Dropped: `DROP FUNCTION get_user_transactions(text)`
- Function still existed as `public.get_user_transactions(text)`
- Need to drop both versions

### Root Cause:
- Functions can exist with and without schema prefix
- Need to drop both `function_name` and `schema.function_name`

### Lesson Learned:
✅ **Drop both versions:**
```sql
DROP FUNCTION IF EXISTS function_name(...) CASCADE;
DROP FUNCTION IF EXISTS public.function_name(...) CASCADE;
DROP FUNCTION IF EXISTS schema.function_name(...) CASCADE;
```

### Prevention:
- Always include schema prefix version
- Always include non-prefix version
- Use CASCADE for both

---

## Mistake #9: Case Sensitivity in Type Names

### What Happened:
- Used `TEXT` (uppercase)
- Production uses `text` (lowercase)
- PostgreSQL is case-insensitive for types BUT
- Function signature matching is case-sensitive for documentation

### Root Cause:
- Thought types are case-insensitive everywhere
- Overload resolution compares exact signatures
- Documentation should match production

### Lesson Learned:
✅ **Use lowercase types consistently:**
- `text` not `TEXT`
- `numeric` not `NUMERIC`
- `uuid` not `UUID`
- `timestamptz` not `TIMESTAMP WITH TIME ZONE`

### Prevention:
- Check production schema for type casing
- Use lowercase consistently
- Copy-paste types from schema doc

---

## Mistake #10: Not Testing Migration Before Deploy

### What Happened:
- Created migration with errors
- Deployed to production SQL editor
- Failed with column error
- Had to create another migration to fix

### Root Cause:
- Didn't test locally
- Assumed migration was correct
- Production became test environment

### Lesson Learned:
✅ **Test migrations before production:**
```bash
# Local Supabase
supabase db reset
supabase db push

# Or at minimum:
# Manually verify every column exists
# Manually verify every function signature
```

### Prevention:
- Migration checklist includes testing step
- Set up local Supabase for testing
- At minimum: manual verification of all references
- Never deploy untested migrations to production

---

## Mistake #11: Not Using Balance Ledger as Source of Truth

### What Happened:
- Used `sub_account_balances` to sync balances
- That table had stale data
- Should use `balance_ledger` (transaction log)
- Syncing from cache corrupted live data

### Root Cause:
- Didn't understand data architecture
- Assumed cache table is accurate
- Ledger is source of truth, cache can be stale

### Lesson Learned:
✅ **Balance data hierarchy:**
1. `balance_ledger` - SOURCE OF TRUTH (transaction log)
2. `sub_account_balances` - Cache (can be stale)
3. `canonical_users.usdc_balance` - Legacy cache (often stale)

Always rebuild FROM ledger, never FROM cache.

### Prevention:
- Document data architecture
- Understand which tables are source of truth
- Understand which are caches/computed
- Always sync FROM source of truth TO caches

---

## Mistake #12: Creating Multiple Migrations Instead of Comprehensive Fix

### What Happened:
- Migration 1: Fixed ticket_numbers
- Migration 2: Fixed transaction_hash
- Migration 3: Fixed function overload
- Should have been ONE comprehensive migration

### Root Cause:
- Reactive fixing (one error at a time)
- Not doing complete analysis upfront
- Each fix created new issues

### Lesson Learned:
✅ **Create comprehensive fixes:**
1. Find ALL related errors first
2. Document ALL issues
3. Create ONE migration fixing ALL issues
4. Test thoroughly
5. Deploy once

### Prevention:
- Do complete scan before any migration
- Document all findings
- Fix all issues together
- Resist urge to "quick fix" one thing

---

## How to Use This Document

**Before creating ANY migration:**
1. Read through all mistakes
2. Check if current work might make same mistake
3. Follow prevention steps for each relevant mistake
4. Use checklists to ensure mistakes aren't repeated

**When reviewing migrations:**
1. Check against each mistake category
2. Verify prevention steps were followed
3. Flag any potential issues before deployment

**When things go wrong:**
1. Add new mistake to this document
2. Document root cause
3. Document lesson learned
4. Create prevention checklist
5. Update MIGRATION_CHECKLIST.md if needed

---

## Summary: Golden Rules

1. ✅ **Check production schema FIRST** - Never assume
2. ✅ **Scan entire codebase for related issues** - Fix all at once
3. ✅ **Drop ALL function overloads** - Don't leave orphans
4. ✅ **Match parameter names exactly** - Include p_ prefix if production has it
5. ✅ **Verify every column exists** - No exceptions
6. ✅ **Check frontend before changing RPCs** - Ensure compatibility
7. ✅ **Use lowercase types** - Match production conventions
8. ✅ **Test before production** - Always
9. ✅ **Use source of truth** - Ledger not cache
10. ✅ **Think comprehensive, not incremental** - Fix all issues together

**When in doubt, stop and verify. It's faster than fixing mistakes.**
