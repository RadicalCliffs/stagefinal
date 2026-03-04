# FIX: Lucky Dip Randomization + Active Entries Count

## Issues Fixed

### Issue 1: Consecutive Ticket Allocation in Lucky Dip

**Problem:** Lucky dip purchases were allocating consecutive blocks of tickets instead of random scattered tickets.

**Example:** User buys 73 tickets via lucky dip and gets: 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 1, 2, 3, 4, 5, 6, 7, 8, 9, 92...

**Root Cause:** The `allocate_lucky_dip_tickets_batch` function used a randomization approach with `ORDER BY (n + v_random_offset) % v_total_tickets + random()` which created patterns and consecutive blocks.

**Solution:** Replaced with pure `ORDER BY random()` for true random shuffling of available tickets.

### Issue 2: Active Entries Count Always Shows 0

**Problem:** The user dropdown modal displays "0 active entries" even when the user has active competition entries.

**Root Cause:** The `get_user_active_tickets` RPC function was called by the frontend (AuthContext.tsx) but was never created in the database. The TypeScript types showed it existed, but there was no SQL implementation.

**Solution:** Created the missing `get_user_active_tickets` RPC function that queries the tickets table joined with competitions, filtering for only active competitions.

---

## Files Created

1. **CREATE_MISSING_GET_USER_ACTIVE_TICKETS.sql** - Creates the missing RPC function
2. **FIX_LUCKY_DIP_RANDOMIZATION.sql** - Fixes the ticket randomization logic
3. **APPLY_BOTH_FIXES.sql** - Combined script that applies both fixes in one transaction
4. **verify-both-fixes.mjs** - Node.js script to verify both fixes are working
5. **README_FIXES.md** - This file

---

## How to Apply the Fixes

### Option 1: Apply Both Fixes at Once (Recommended)

Run the combined script against your production database:

```bash
# Using psql
psql "YOUR_DATABASE_URL" -f APPLY_BOTH_FIXES.sql

# Or using Supabase SQL Editor
# Copy and paste the contents of APPLY_BOTH_FIXES.sql into the SQL Editor and execute
```

### Option 2: Apply Fixes Individually

If you prefer to apply fixes one at a time:

1. First, create the missing RPC:

   ```bash
   psql "YOUR_DATABASE_URL" -f CREATE_MISSING_GET_USER_ACTIVE_TICKETS.sql
   ```

2. Then, fix the randomization:
   ```bash
   psql "YOUR_DATABASE_URL" -f FIX_LUCKY_DIP_RANDOMIZATION.sql
   ```

---

## Verification

After applying the fixes, run the verification script:

```bash
node verify-both-fixes.mjs
```

This will:

1. Check that `get_user_active_tickets` RPC exists and is callable
2. Test `allocate_lucky_dip_tickets_batch` to verify randomization is working
3. Analyze the distribution of allocated tickets (should be <30% consecutive)

---

## Testing in Production

### Test 1: Active Entries Count

1. Log in as a user who has active competition entries
2. Click on the user profile dropdown in the top right
3. Verify the dropdown shows the correct number of "active entries"
4. Expected: Shows number of competitions entered (e.g., "3 active entries" if entered into 3 competitions)
5. Note: This counts competitions, NOT total tickets. 73 tickets in 1 competition = 1 entry

### Test 2: Lucky Dip Randomization

1. Make a lucky dip purchase (10+ tickets recommended for testing)
2. View the ticket numbers allocated
3. Expected: Tickets should be scattered randomly (e.g., 42, 7, 156, 91, 23...)
4. Not expected: Consecutive blocks (e.g., 12, 13, 14, 15, 16...)

---

## Technical Details

### get_user_active_tickets Function

**Signature:**

```sql
get_user_active_tickets(p_user_identifier TEXT)
RETURNS TABLE(competitionid UUID, ticketnumbers INTEGER[])
```

**What it does:**

- Takes a user identifier (canonical user ID or wallet address)
- Queries the `tickets` table joined with `competitions`
- Filters for active competitions only (`status = 'active'`, not past `end_date`)
- Groups tickets by competition
- Returns ONE ROW per competition (regardless of ticket count)
- The number of rows = number of active entries (competitions entered)
- Example: User has 73 tickets in "Win BTC" + 10 tickets in "Win ETH" = 2 rows returned = 2 active entries

**Used by:**

- `AuthContext.tsx` - Fetches entry count for the user dropdown
- Dashboard components - May use this for displaying active entries

### allocate_lucky_dip_tickets_batch Function

**Key Change:**

```sql
-- OLD (caused consecutive blocks):
SELECT array_agg(n ORDER BY (n + v_random_offset) % v_total_tickets + random())
INTO v_available_tickets
FROM generate_series(1, v_total_tickets) AS n
WHERE n != ALL(v_unavailable_set);

-- NEW (true random distribution):
SELECT array_agg(n ORDER BY random())
INTO v_available_tickets
FROM generate_series(1, v_total_tickets) AS n
WHERE n != ALL(v_unavailable_set);
```

**Why this works better:**

- Pure `random()` provides true random shuffling
- No offset/modulo patterns that could create consecutive sequences
- Each call produces independently random results
- Performance is similar (both are O(n log n) for sorting)

---

## Impact

### Active Entries Count

- **Before:** Always showed "0 active entries"
- **After:** Shows correct count, updates in real-time
- **User Experience:** Users can now see their entry count at a glance

### Lucky Dip Ticket Distribution

- **Before:** Consecutive blocks (e.g., 12-21, 1-9)
- **After:** Truly random scatter (e.g., 42, 7, 156, 91, 23)
- **Fairness:** Better distribution across ticket range
- **User Experience:** More exciting, feels more random

---

## Rollback (If Needed)

If you need to rollback these changes:

### Rollback get_user_active_tickets

```sql
DROP FUNCTION IF EXISTS public.get_user_active_tickets(TEXT) CASCADE;
```

### Rollback allocate_lucky_dip_tickets_batch

You would need to restore the previous version from your database backups or version control.

---

## Questions or Issues

If you encounter any problems with these fixes:

1. Check the PostgreSQL logs for error messages
2. Verify the functions exist:
   ```sql
   SELECT proname, prosrc FROM pg_proc WHERE proname IN ('get_user_active_tickets', 'allocate_lucky_dip_tickets_batch');
   ```
3. Test with the verification script: `node verify-both-fixes.mjs`
4. Check frontend console for RPC call errors

---

## Related Files

- Frontend: `src/contexts/AuthContext.tsx` (calls get_user_active_tickets)
- Frontend: `src/components/LoggedInUserBtn.tsx` (displays active entries count)
- Edge Function: `supabase/functions/lucky-dip-reserve/index.ts` (calls allocate_lucky_dip_tickets_batch)
- Types: `supabase/types.ts` (TypeScript definitions for RPC functions)
