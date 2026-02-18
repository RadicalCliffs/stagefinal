# Lucky Dip 500 Ticket Limit Fix - Summary

## Problem
Users were getting a 500 error when trying to purchase more than 500 tickets via lucky dip:
```
"Count cannot exceed 500 per batch. Use multiple batches for larger purchases."
```

## Root Cause
The database function `allocate_lucky_dip_tickets_batch` had a hard-coded limit of 500 tickets per call. This limit was **arbitrary** - there is no technical PostgreSQL or Supabase limitation preventing higher values.

## Solution
Instead of implementing complex batching logic across frontend and backend, we simply **increased the limit from 500 to 999** to match the frontend's maximum tickets per purchase.

### Changes Made

#### 1. Database Migration
**File:** `supabase/migrations/20260218171200_increase_lucky_dip_batch_limit.sql`

- Dropped and recreated `allocate_lucky_dip_tickets_batch` function
- Changed validation from `p_count > 500` to `p_count > 999`
- Updated error message to reflect new limit
- Added comment explaining no technical reason for limitation

#### 2. Edge Function Validation
**File:** `supabase/functions/lucky-dip-reserve/index.ts`

- Updated frontend validation from 10,000 to 999 to match database function
- Changed error message to reflect correct limit

### Why 999 Works
The database function performs these operations:
1. Generates an array of available ticket numbers (e.g., `[1,3,5,7,...]`)
2. Randomly selects from that array
3. Inserts **ONE ROW** into `pending_tickets` with the array of ticket numbers

PostgreSQL handles arrays of 999 integers trivially:
- Memory: ~4KB for array of 999 integers
- Performance: Array operations are O(n) but n=999 is negligible
- Transaction: Single row insert regardless of array size

There's no technical reason this couldn't be 10,000+ tickets, but 999 matches the frontend's current per-purchase limit.

## Deployment Steps
1. Apply the database migration:
   ```bash
   supabase db push
   ```
2. Deploy the edge function:
   ```bash
   supabase functions deploy lucky-dip-reserve
   ```

## Testing
Test with various ticket counts to ensure no errors:
- 1 ticket
- 100 tickets  
- 500 tickets (previously the limit)
- 999 tickets (new maximum)

## Alternative Approaches Considered

### ❌ Frontend Batching
**Rejected:** Initial implementation added complex batching logic in `IndividualCompetitionHeroSection.tsx` to split >500 requests into multiple calls. This created issues with:
- Multiple pending_ticket records
- Payment confirmation only finding one reservation
- Complex error handling

### ❌ Edge Function Batching  
**Rejected:** Attempted to handle batching in the edge function, but this required:
- Multiple RPC calls
- Consolidation logic to merge pending_tickets
- Cancellation logic on partial failures
- Much more complex code

### ✅ Simple Limit Increase
**Chosen:** Just increase the database limit. Much simpler, no batching needed.

## Impact
- Users can now purchase up to 999 tickets in a single lucky dip request
- No more 500-ticket errors
- Cleaner, simpler code than batching approach
- Single pending_ticket record per reservation (proper payment flow)

## Related Files
- Database function: `allocate_lucky_dip_tickets_batch`
- Edge function: `supabase/functions/lucky-dip-reserve/index.ts`
- Frontend: `src/components/IndividualCompetition/IndividualCompetitionHeroSection.tsx`
- Migration: `supabase/migrations/20260218171200_increase_lucky_dip_batch_limit.sql`
