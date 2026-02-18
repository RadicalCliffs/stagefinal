# Lucky Dip Edge Function RPC Fix Summary

## Problem Statement

Users encountered HTTP 500 errors when attempting to reserve tickets using the Lucky Dip feature:

```
Error: Failed to reserve tickets
HTTP Status: 500
Error Detail: insufficient_available_tickets (or RPC-related errors)
```

Console logs showed:
```
[ErrorMonitor] APIERROR
Message: HTTP 500: 
Context: {
  body: {
    "success": false,
    "error": "Failed to reserve tickets",
    "errorCode": 500,
    "retryable": true,
    "errorDetail": "insufficient_available_tickets"
  }
}
```

## Root Cause Analysis

The `lucky-dip-reserve` edge function (`supabase/functions/lucky-dip-reserve/index.ts`) was attempting to call a non-existent RPC function named `reserve_lucky_dip`:

```typescript
// ❌ OLD CODE (BROKEN)
const { data: rpcResult, error: rpcError } = await supabase.rpc(
  'reserve_lucky_dip',  // This RPC doesn't exist in the database
  {
    p_competition_id: competitionId,
    p_canonical_user_id: canonicalUserId,
    p_wallet_address: walletAddress,
    p_ticket_count: normalizedCount,
    p_hold_minutes: holdMins
  }
);
```

### Why This Happened

1. The edge function was written to call `reserve_lucky_dip` RPC
2. This RPC function was never created in the database
3. When the edge function tried to invoke it, the database returned an error
4. This caused the edge function to return a 500 error to the frontend

### Investigation Process

1. **Examined error logs**: Showed 500 errors from the edge function
2. **Reviewed edge function code**: Found call to `reserve_lucky_dip`
3. **Searched database functions**: `reserve_lucky_dip` not found in production CSV exports
4. **Identified correct RPC**: `allocate_lucky_dip_tickets_batch` exists and is used by frontend library
5. **Verified parameters**: Compared expected vs actual RPC signatures

## Solution

Updated the edge function to call the correct, existing RPC function `allocate_lucky_dip_tickets_batch`:

### Changes Made

#### 1. Updated RPC Call (Line 212)
```typescript
// ✅ NEW CODE (FIXED)
const { data: rpcResult, error: rpcError } = await supabase.rpc(
  'allocate_lucky_dip_tickets_batch',  // Correct RPC that exists
  {
    p_user_id: canonicalUserId,
    p_competition_id: competitionId,
    p_count: normalizedCount,
    p_ticket_price: validTicketPrice,
    p_hold_minutes: holdMins,
    p_session_id: sessionId || null,
    p_excluded_tickets: null
  }
);
```

#### 2. Updated Response Field Mapping

The RPC returns different field names than what the edge function was expecting:

**Before (expected from reserve_lucky_dip):**
- `result.pending_ticket_id`
- `result.allocated_numbers`

**After (actual from allocate_lucky_dip_tickets_batch):**
- `result.reservation_id`
- `result.ticket_numbers`

```typescript
// ✅ Updated to use correct field names
return successResponse({
  reservationId: result.reservation_id,  // Changed from pending_ticket_id
  ticketNumbers: result.ticket_numbers,  // Changed from allocated_numbers
  ticketCount: allocatedNumbers.length,
  totalAmount: allocatedNumbers.length * validTicketPrice,
  expiresAt: new Date(Date.now() + holdMins * MINUTES_TO_MS).toISOString(),
  algorithm: 'allocate-lucky-dip-batch',
  message: `Successfully reserved ${allocatedNumbers.length} lucky dip tickets.`
}, corsHeaders);
```

#### 3. Added Error Handling for JSON Parsing

Added try-catch block to handle malformed JSON responses:

```typescript
let result;
try {
  result = typeof rpcResult === 'string' ? JSON.parse(rpcResult) : rpcResult;
} catch (parseError) {
  console.error(`[${requestId}] Failed to parse RPC result:`, parseError);
  return errorResponse(
    "Invalid response format from reservation system",
    500,
    corsHeaders,
    { retryable: true }
  );
}
```

#### 4. Fixed Retryable Flag Logic

Changed from `||` to `??` operator to respect explicit `false` values:

```typescript
// Before: Would always default to true even if retryable was explicitly false
{ retryable: result?.retryable || true, errorDetail }

// After: Only defaults to true if retryable is null or undefined
{ retryable: result?.retryable ?? true, errorDetail }
```

#### 5. Removed Unused Constants

Removed constants that were only needed for the non-existent `reserve_lucky_dip` RPC:
- `PRIZE_PID_PREFIX`
- `ETHEREUM_WALLET_REGEX`

### Files Modified

1. **`supabase/functions/lucky-dip-reserve/index.ts`**
   - Updated RPC call
   - Updated response mapping
   - Added error handling
   - Removed unused code

2. **`DEPLOYMENT_LUCKY_DIP_FIX.md`**
   - Updated documentation to reflect the fix

## Verification

### Code Review
- ✅ Passed code review with no issues
- ✅ All review comments addressed

### Security Scan
- ✅ CodeQL scan: 0 alerts
- ✅ No security vulnerabilities found

### Expected Behavior After Fix

1. User navigates to competition page
2. Selects lucky dip tickets
3. Clicks "Enter Now"
4. Edge function successfully calls `allocate_lucky_dip_tickets_batch`
5. Tickets are reserved successfully
6. No 500 errors occur

## Deployment Notes

### Edge Function Deployment

The edge function will need to be deployed to Supabase:

```bash
# Deploy the updated function
supabase functions deploy lucky-dip-reserve
```

### No Database Changes Required

This fix only updates the edge function code. No database migrations are needed because:
- The `allocate_lucky_dip_tickets_batch` RPC already exists in the database
- No schema changes are required
- No new functions need to be created

## Testing Recommendations

### Manual Testing
1. Navigate to a competition page
2. Select Lucky Dip mode
3. Choose a ticket count (e.g., 5 tickets)
4. Click "Reserve Tickets"
5. Verify:
   - ✅ No HTTP 500 errors
   - ✅ Tickets are successfully reserved
   - ✅ Reservation ID is returned
   - ✅ Frontend displays reserved ticket numbers
   - ✅ Countdown timer shows reservation expiry

### Monitoring
After deployment, monitor for:
- Reduction in 500 errors from `lucky-dip-reserve` function
- Successful ticket reservations in logs
- No new error patterns

## Related Documentation

- **LUCKY_DIP_OVERLOAD_FIX_SUMMARY.md** - Documents the function overload issue
- **DEPLOYMENT_LUCKY_DIP_FIX.md** - Deployment guide for database migration
- **Frontend Implementation** - `src/components/IndividualCompetition/IndividualCompetitionHeroSection.tsx`
- **Batch Allocation Library** - `src/lib/bulk-lucky-dip.ts`

## Impact

- **Before:** Users unable to reserve lucky dip tickets, 100% failure rate with 500 errors
- **After:** Users can successfully reserve lucky dip tickets through the edge function
- **User Experience:** Seamless ticket reservation without errors
- **Revenue Impact:** Unblocks ticket purchases, restores revenue stream

## Prevention

To prevent similar issues in the future:

1. **Always verify RPC existence** before deploying edge functions
2. **Test edge functions** against production database schema
3. **Document RPC contracts** with parameter and return type definitions
4. **Use type-safe RPC calls** where possible
5. **Add integration tests** for edge function → RPC interactions

## Status

- [x] Problem identified
- [x] Root cause analyzed
- [x] Solution implemented
- [x] Code review passed
- [x] Security scan passed
- [x] Documentation updated
- [ ] Edge function deployed to production
- [ ] Fix verified in production
- [ ] User testing completed
- [ ] Monitoring confirmed fix

## Next Steps

1. Deploy the updated edge function to Supabase production
2. Verify deployment success
3. Test lucky dip reservations
4. Monitor error logs for 24 hours
5. Mark issue as resolved
