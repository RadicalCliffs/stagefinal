# Fix for Missing get_unavailable_tickets RPC Function

## Problem
The frontend application is calling the `get_unavailable_tickets` RPC function but receiving a 404 error:
```
POST https://mthwfldcjvpxjtmrqkqm.supabase.co/rest/v1/rpc/get_unavailable_tickets 404 (Not Found)
Error: PGRST202 - Function not found in schema cache
```

This occurs during ticket reservation when trying to fetch available tickets.

## Root Cause
The database migration `20260128082000_fix_get_unavailable_tickets_schema.sql` exists but has not been applied to the production database.

## Solution
The function has been updated in two places:
1. **Initial Schema** (`00000000000000_initial_schema.sql`) - Updated for fresh deployments
2. **Migration File** (`20260128082000_fix_get_unavailable_tickets_schema.sql`) - For existing databases

## Immediate Hotfix (Manual Application)

### Option 1: Via Supabase Dashboard (Recommended)
1. Open Supabase Dashboard → SQL Editor
2. Copy the contents of `supabase/HOTFIX_get_unavailable_tickets.sql`
3. Paste into SQL Editor
4. Click "Run"
5. Verify success message: "✅ get_unavailable_tickets function created successfully!"

### Option 2: Via Supabase CLI
```bash
# Run from the project root directory
supabase db execute -f supabase/HOTFIX_get_unavailable_tickets.sql
```

### Option 3: Apply Migration
```bash
# Run from the project root directory
supabase db push
```

## Verification

After applying the fix, verify the function exists:

```sql
-- Check if function exists
SELECT 
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as parameters,
  pg_get_functiondef(p.oid) as definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname = 'get_unavailable_tickets';
```

Expected result: One row showing the function with parameter `p_competition_id text`

## Testing

Test the function with a competition ID:

```sql
-- Test with a real competition ID
SELECT get_unavailable_tickets('6f6eb8f6-b778-49c7-b1eb-90ac58c6dbb9');
```

Expected result: Array of ticket numbers (may be empty if no tickets are unavailable)

## Function Details

**Function Name:** `get_unavailable_tickets`

**Parameters:**
- `p_competition_id` (TEXT) - Competition UUID or UID

**Returns:** `INT4[]` (array of integers)

**Description:** Returns an array of unavailable ticket numbers for a competition by querying:
1. Sold tickets from `joincompetition.ticketnumbers`
2. Sold tickets from `tickets.ticket_number`
3. Pending/reserved tickets from `pending_ticket_items.ticket_number` (with validation via `pending_tickets`)

**Permissions:** Granted to `authenticated`, `anon`, and `service_role` roles

## Long-term Solution

For future deployments, the function is now included in:
1. The initial schema (`00000000000000_initial_schema.sql`) - Lines 1950-2066
2. The migration file (`20260128082000_fix_get_unavailable_tickets_schema.sql`)

Both fresh database setups and migration-based updates will have the correct function.

## Related Files
- `supabase/migrations/00000000000000_initial_schema.sql` (updated)
- `supabase/migrations/20260128082000_fix_get_unavailable_tickets_schema.sql` (existing)
- `supabase/HOTFIX_get_unavailable_tickets.sql` (standalone hotfix)
- `src/lib/supabase-rpc-helpers.ts` (TypeScript wrapper: `getUnavailableTickets`)
- `src/lib/database.types.ts` (TypeScript type definitions)

## Impact

Once applied, this fix will:
- ✅ Resolve the 404 error when fetching unavailable tickets
- ✅ Enable ticket reservation functionality
- ✅ Allow proper calculation of available tickets
- ✅ Support Lucky Dip and regular ticket purchases
