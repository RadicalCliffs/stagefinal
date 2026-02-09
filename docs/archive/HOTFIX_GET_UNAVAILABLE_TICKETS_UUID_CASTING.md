# Fix for "operator does not exist: uuid = text" Error

## Problem

The application was encountering a PostgreSQL error when calling `get_unavailable_tickets` RPC function:

```
POST https://mthwfldcjvpxjtmrqkqm.supabase.co/rest/v1/rpc/get_unavailable_tickets 404 (Not Found)

Error code: 42883
Error message: "operator does not exist: uuid = text"
Hint: "No operator matches the given name and argument types. You might need to add explicit type casts."
```

This occurred during ticket reservation when trying to fetch available tickets on the competition detail page.

## Root Cause

The issue was in the migration file `20260205203100_align_production_schema_functions.sql`:

1. **Type mismatch**: The function `get_competition_unavailable_tickets` accepts a `UUID` parameter but the table columns (`tickets.competition_id`, `pending_tickets.competition_id`, `pending_ticket_items.competition_id`) are all of type `TEXT`.

2. **Direct comparison**: PostgreSQL doesn't allow direct comparison between UUID and TEXT types without explicit casting:
   - Line 81: `WHERE t.competition_id = p_competition_id` (TEXT = UUID ❌)
   - Line 91: `WHERE pt.competition_id = p_competition_id` (TEXT = UUID ❌)

3. **Non-existent column**: The function tried to query `pending_tickets.ticket_numbers` which doesn't exist in the schema. The correct approach is to use the `pending_ticket_items` table instead.

## Solution

Created migration `20260207113700_fix_get_unavailable_tickets_uuid_casting.sql` that:

1. **Adds explicit UUID to TEXT casting** by converting the UUID parameter to TEXT before comparison:
   ```sql
   v_competition_id_text := p_competition_id::TEXT;
   WHERE t.competition_id = v_competition_id_text  -- TEXT = TEXT ✅
   ```

2. **Fixes both functions**:
   - `get_competition_unavailable_tickets(UUID)` - Returns TABLE with ticket_number and source
   - `get_unavailable_tickets(TEXT)` - Returns INTEGER[] array

3. **Uses the correct table** for pending tickets:
   ```sql
   FROM pending_ticket_items pti
   INNER JOIN pending_tickets pt ON pti.pending_ticket_id = pt.id
   WHERE pti.competition_id = v_competition_id_text
   ```

## Files Changed

1. **Migration**: `supabase/migrations/20260207113700_fix_get_unavailable_tickets_uuid_casting.sql`
   - Production migration file that will be applied automatically

2. **Hotfix**: `supabase/HOTFIX_get_unavailable_tickets_uuid_casting.sql`
   - Can be applied manually via Supabase SQL Editor for immediate fix

## How to Apply

### Option 1: Automatic (via Supabase migrations)
The migration will be applied automatically when the PR is merged and deployed.

### Option 2: Manual (via Supabase Dashboard) - IMMEDIATE
1. Open [Supabase Dashboard](https://app.supabase.com) → SQL Editor
2. Copy contents of `supabase/HOTFIX_get_unavailable_tickets_uuid_casting.sql`
3. Paste into SQL Editor
4. Click "Run"
5. Verify success message: "✅ All functions created successfully!"

### Option 3: Via Supabase CLI
```bash
supabase db execute -f supabase/HOTFIX_get_unavailable_tickets_uuid_casting.sql
```

## Testing

After applying the fix, test with a real competition ID:

```sql
-- Should return an array of integers (may be empty)
SELECT get_unavailable_tickets('47354b08-8167-471e-959a-5fc114dcc532');

-- Should return a table with ticket_number and source columns
SELECT * FROM get_competition_unavailable_tickets('47354b08-8167-471e-959a-5fc114dcc532'::UUID);
```

Expected result: No errors, returns array of ticket numbers.

## Verification

Verify the functions exist:

```sql
SELECT 
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as parameters
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname IN ('get_unavailable_tickets', 'get_competition_unavailable_tickets')
ORDER BY p.proname, p.oid;
```

Expected result: 3 functions total:
- `get_competition_unavailable_tickets(p_competition_id uuid)`
- `get_competition_unavailable_tickets(p_competition_id text)`
- `get_unavailable_tickets(p_competition_id text)`

## Impact

Once applied, this fix will:
- ✅ Resolve the 404/42883 error when fetching unavailable tickets
- ✅ Enable ticket reservation functionality (Lucky Dip and manual selection)
- ✅ Allow proper calculation of available tickets
- ✅ Fix the competition detail page ticket display

## Related Issues

This error was causing:
- Ticket selector to show "Failed to load available tickets. Please try again." error
- Lucky Dip reservations to fail
- Competition detail page to display incorrect ticket availability
- Console errors: `[ErrorMonitor] APIERROR` with HTTP 404 status

## Schema Reference

Relevant table schemas:
```sql
-- All these columns are TEXT, not UUID
tickets.competition_id              -> TEXT
pending_tickets.competition_id      -> TEXT  
pending_ticket_items.competition_id -> TEXT
competitions.id                     -> UUID (via gen_random_uuid()::text stored as TEXT)
```

The functions accept UUID but must cast to TEXT when comparing with these columns.
