# Summary of Changes - Fix get_unavailable_tickets RPC Function

## Issue
The application was experiencing a 404 error when calling the `get_unavailable_tickets` RPC function:
```
POST .../rest/v1/rpc/get_unavailable_tickets 404 (Not Found)
Error Code: PGRST202
Details: "Searched for the function get_unavailable_tickets(p_competition_id) in the schema cache"
```

This prevented:
- Ticket reservation functionality
- Lucky Dip ticket purchases
- Proper calculation of available tickets

## Root Cause
The initial database schema (`00000000000000_initial_schema.sql`) contained an outdated version of the `get_unavailable_tickets` function that:
- Only queried the `tickets_sold` table
- Did not include pending/reserved tickets
- Did not query the `tickets` or `joincompetition` tables
- Lacked proper error handling

A migration file (`20260128082000_fix_get_unavailable_tickets_schema.sql`) existed with the correct implementation but had not been applied to the production database.

## Solution
Updated the initial schema to include the comprehensive version of the function that matches the migration file.

## Files Changed

### 1. `supabase/migrations/00000000000000_initial_schema.sql`
**Lines Changed**: 1950-2066 (function definition)

**Changes Made**:
- Replaced simple function with comprehensive version
- Added support for multiple data sources:
  - `joincompetition.ticketnumbers` (sold tickets)
  - `tickets.ticket_number` (sold tickets)
  - `pending_ticket_items.ticket_number` (pending/reserved tickets)
- Added UUID/UID/string competition ID handling
- Added proper NULL and empty input handling
- Added exception handling for missing tables
- Added permission grants for authenticated, anon, and service_role
- Changed return type from `INTEGER[]` to `INT4[]` (equivalent types, more explicit)
- Added `STABLE` qualifier for query optimization

**Impact**: Fresh database deployments will have the correct function from the start.

### 2. `supabase/HOTFIX_get_unavailable_tickets.sql` (New File)
**Purpose**: Standalone SQL script for immediate deployment to production

**Contents**:
- DROP statements to remove old function versions
- Complete function definition (same as in initial schema)
- Permission grants
- Verification checks
- Comments and documentation

**Usage**: Can be applied via:
- Supabase Dashboard SQL Editor (copy/paste and run)
- Supabase CLI: `supabase db execute -f supabase/HOTFIX_get_unavailable_tickets.sql`

**Impact**: Allows immediate fix to production database without full migration.

### 3. `FIX_GET_UNAVAILABLE_TICKETS_README.md` (New File)
**Purpose**: Comprehensive deployment and testing documentation

**Contents**:
- Problem description
- Root cause analysis
- Three deployment options
- Verification queries
- Testing procedures
- Function details and capabilities

**Impact**: Provides clear instructions for deploying and verifying the fix.

## Technical Details

### Function Signature
```sql
CREATE OR REPLACE FUNCTION get_unavailable_tickets(p_competition_id TEXT)
RETURNS INT4[]
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
```

### Data Sources Queried
1. **joincompetition table**: Sold tickets stored in `ticketnumbers` column (comma-separated or array)
2. **tickets table**: Sold tickets stored individually with `ticket_number` column
3. **pending_ticket_items table**: Reserved/pending tickets (joined with `pending_tickets` for validation)

### Validation Logic
For pending tickets, the function:
- Checks `pending_tickets.status` is 'pending' or 'confirming'
- Checks `pending_tickets.expires_at` is in the future
- Only includes non-expired, valid reservations

### Error Handling
- Returns empty array for NULL or empty input
- Handles invalid UUID gracefully (falls back to UID lookup)
- Catches undefined_table exceptions (returns empty for that source)
- Uses COALESCE to ensure arrays are never NULL

## Deployment Process

### Recommended Approach (Immediate Fix)
1. Open Supabase Dashboard
2. Navigate to SQL Editor
3. Copy contents of `supabase/HOTFIX_get_unavailable_tickets.sql`
4. Paste and execute
5. Verify success message: "✅ get_unavailable_tickets function created successfully!"

### Alternative Approach (Migration)
1. Ensure all migrations are in `supabase/migrations/` directory
2. Run `supabase db push` to apply all pending migrations
3. Verify function exists using the queries in README

### Long-term
The initial schema update ensures that:
- Fresh database setups have the correct function
- Database resets apply the correct version
- No manual intervention needed for new environments

## Verification

After deployment, run this query to verify:
```sql
SELECT 
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as parameters
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname = 'get_unavailable_tickets';
```

Expected result: One row showing `get_unavailable_tickets(p_competition_id text)`

## Testing

Test the function with a real competition ID:
```sql
SELECT get_unavailable_tickets('6f6eb8f6-b778-49c7-b1eb-90ac58c6dbb9');
```

Expected result: Array of integers (ticket numbers), may be empty if no tickets are unavailable.

## No Code Changes Required

The TypeScript code already:
- Has correct type definitions (`number[]`)
- Uses correct parameter names (`p_competition_id`)
- Has fallback logic for RPC failures
- Expects array of numbers as return value

No frontend changes are needed - only the database function needs to be deployed.

## Risk Assessment

**Risk Level**: Low

**Reasons**:
- Only changes one database function
- No breaking changes to function signature or return type
- TypeScript types already match
- Frontend has fallback logic
- Existing migration file validates the approach
- DROP CASCADE handles any dependent objects

**Rollback**: If issues occur, the old simple version can be restored:
```sql
CREATE OR REPLACE FUNCTION get_unavailable_tickets(p_competition_id TEXT)
RETURNS INTEGER[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unavailable INTEGER[];
BEGIN
  SELECT ARRAY_AGG(ticket_number) INTO v_unavailable
  FROM tickets_sold
  WHERE competition_id = p_competition_id;
  RETURN COALESCE(v_unavailable, ARRAY[]::INTEGER[]);
END;
$$;
```

## Success Criteria

✅ Function exists in database schema  
✅ No 404 errors when calling RPC endpoint  
✅ Ticket reservation works without errors  
✅ Lucky Dip functionality works  
✅ Available ticket counts are accurate  
✅ Frontend receives expected array of numbers  

## Follow-up Actions

After deployment:
1. Monitor application logs for any RPC errors
2. Test ticket reservation flow end-to-end
3. Verify Lucky Dip functionality
4. Check that available ticket counts are accurate
5. Confirm no regression in existing competitions

## Related Documentation
- `FIX_GET_UNAVAILABLE_TICKETS_README.md` - Detailed deployment guide
- `supabase/migrations/20260128082000_fix_get_unavailable_tickets_schema.sql` - Original migration
- `DEPLOYMENT_CHECKLIST.md` - General deployment procedures

---

**Prepared by**: GitHub Copilot
**Date**: 2026-01-30
**PR Branch**: copilot/fetch-wallet-balances
