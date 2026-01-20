# UUID to TEXT Migration - Implementation Summary

## Problem Statement
Backend errors occurred because `canonical_user_id` and related user-identifying fields were incorrectly typed as **UUID** instead of **TEXT**. The system uses text-format identifiers like `prize:pid:0x...` for users, but many database tables and functions were treating these as UUID, causing type mismatch errors.

### Error Symptoms
1. **"invalid input syntax for type uuid: \"0x2137af5047526a1180580ab02985a818b1d9c789\""**
   - Frontend queries failing when filtering by wallet addresses
   - Tables with `user_id UUID` columns rejecting TEXT values

2. **"operator does not exist: uuid = text"**
   - SQL functions comparing UUID columns with TEXT parameters
   - RPC functions with mismatched variable types

## Root Causes Identified
1. **Table Schemas**: `user_id` columns defined as UUID instead of TEXT
2. **Function Variables**: Local variables declared as `uuid` when should be `text`
3. **Edge Functions**: TypeScript code with outdated comments assuming UUID types

## Migrations Created

### Migration 1: `20260120160000_fix_uuid_text_type_mismatch_in_user_functions.sql`
**Fixed RPC Functions:**
- `upsert_canonical_user()` - Changed `v_user_id` from `uuid` to `text`
- `attach_identity_after_auth()` - Changed `v_user_id` from `uuid` to `text`

**Changes Made:**
- Variable declarations: `v_user_id uuid` → `v_user_id text`
- SELECT queries: `SELECT id INTO v_user_id` → `SELECT id::text INTO v_user_id`
- WHERE clauses: `WHERE id = v_user_id` → `WHERE id = v_user_id::uuid`

### Migration 2: `20260120170000_fix_user_id_columns_uuid_to_text.sql` ⭐ CRITICAL
**Fixed Table Schemas:**
- `tickets.user_id`: UUID → TEXT
- `user_transactions.user_id`: UUID → TEXT
- `pending_tickets.user_id`: UUID → TEXT
- `balance_ledger.user_id`: UUID → TEXT (if exists)
- `wallet_balances.user_id`: UUID → TEXT (if exists)

**Changes Made:**
- Converted columns: `ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT`
- Dropped UUID foreign key constraints
- Created case-insensitive indexes: `LOWER(user_id)`, `LOWER(canonical_user_id)`
- Added column comments documenting TEXT requirement

## Testing

### Test Script: `TEST_UUID_TEXT_FIXES.sql`
Comprehensive test suite verifying:
1. All `user_id` columns are TEXT type
2. Wallet addresses can be inserted without errors
3. Queries with TEXT identifiers succeed
4. RPC functions accept TEXT parameters
5. No remaining problematic `::uuid` casts

### Manual Testing Checklist
- [ ] Run migrations in Supabase dashboard
- [ ] Execute `TEST_UUID_TEXT_FIXES.sql` and verify all tests pass
- [ ] Test frontend dashboard at `/dashboard/entries`
- [ ] Verify no UUID casting errors in browser console
- [ ] Test balance operations (top-up, purchase)
- [ ] Test ticket queries with wallet addresses

## Impact Assessment

### Tables Modified
- ✅ `tickets` - Now accepts wallet addresses in `user_id`
- ✅ `user_transactions` - Now accepts TEXT identifiers
- ✅ `pending_tickets` - Now accepts TEXT identifiers
- ✅ `balance_ledger` - Now accepts TEXT identifiers (if column exists)
- ✅ `wallet_balances` - Now accepts TEXT identifiers (if column exists)

### Functions Modified
- ✅ `upsert_canonical_user` - Returns TEXT user_id
- ✅ `attach_identity_after_auth` - Returns TEXT user_id

### Frontend Impact
- ✅ Can now filter tickets by wallet address: `user_id.eq.0x...`
- ✅ Can query dashboard entries without UUID casting errors
- ✅ Can use canonical_user_id throughout without type mismatches

## Deployment Steps

1. **Apply Migrations** (in order):
   ```sql
   -- Run in Supabase SQL Editor
   \i supabase/migrations/20260120160000_fix_uuid_text_type_mismatch_in_user_functions.sql
   \i supabase/migrations/20260120170000_fix_user_id_columns_uuid_to_text.sql
   ```

2. **Run Tests**:
   ```sql
   -- Verify all fixes
   \i supabase/migrations/TEST_UUID_TEXT_FIXES.sql
   ```

3. **Monitor Logs**:
   - Check for UUID casting errors in application logs
   - Monitor Supabase logs for type mismatch errors
   - Verify dashboard queries succeed

4. **Rollback Plan** (if needed):
   - Revert column types: `ALTER COLUMN user_id TYPE UUID USING user_id::UUID`
   - Restore previous function versions
   - Note: Only safe if no TEXT data inserted yet

## Success Criteria

✅ All migrations apply without errors
✅ Test script shows all tests passing
✅ Frontend dashboard loads without UUID errors
✅ Ticket queries with wallet addresses succeed
✅ Balance operations work correctly
✅ No "operator does not exist: uuid = text" errors
✅ No "invalid input syntax for type uuid" errors

## Notes

- **Data Preservation**: Migrations use `USING user_id::TEXT` to safely convert existing UUID data
- **Backward Compatibility**: Functions still cast to UUID when comparing with `canonical_users.id`
- **Index Optimization**: New case-insensitive indexes improve TEXT query performance
- **Foreign Keys**: UUID foreign key constraints removed where they enforced UUID type

## Related Files

- `supabase/migrations/20260120160000_fix_uuid_text_type_mismatch_in_user_functions.sql`
- `supabase/migrations/20260120170000_fix_user_id_columns_uuid_to_text.sql`
- `supabase/migrations/TEST_UUID_TEXT_FIXES.sql`
- `supabase/types.ts` (regenerate after migration)

## Security Considerations

- ✅ RLS policies still enforce user isolation
- ✅ TEXT type doesn't weaken security (same data, different representation)
- ✅ Case-insensitive indexes use LOWER() for consistent matching
- ✅ No SQL injection risk (parameterized queries unchanged)
