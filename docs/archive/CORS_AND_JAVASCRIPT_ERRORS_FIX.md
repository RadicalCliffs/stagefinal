# CORS and JavaScript Errors Fix - Deployment Guide

## Summary of Issues Fixed

### 1. `h.startsWith is not a function` Error ✅
**Location:** `src/lib/database.ts` line 1329

**Root Cause:** 
The `winner.competitionprize` field from the database could be stored as either:
- A string (e.g., "$1000", "1 BTC")
- A number (e.g., 1000)
- null/undefined

When the filter function tried to call `.startsWith('$')` on a number, JavaScript threw the error "h.startsWith is not a function".

**Fix Applied:**
Changed line 1329 from:
```typescript
const prize = winner.competitionprize || '';
```
to:
```typescript
const prize = String(winner.competitionprize || '');
```

This ensures `prize` is always a string, regardless of the database value type.

### 2. CORS Preflight Error ✅
**Location:** `supabase/functions/_shared/cors.ts`

**Root Cause:**
The edge function was returning HTTP status 204 (No Content) for OPTIONS preflight requests. While 204 is technically valid according to the CORS spec, some stricter CORS implementations (browsers, proxies, or security tools) require a 200 (OK) status for preflight responses.

**Error Message:**
```
Access to fetch at 'https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/purchase-tickets-with-bonus' 
from origin 'https://substage.theprize.io' has been blocked by CORS policy: 
Response to preflight request doesn't pass access control check: It does not have HTTP ok status.
```

**Fix Applied:**
Changed the OPTIONS handler to return status 200 instead of 204:
```typescript
export function handleCorsOptions(req: Request): Response {
  const origin = req.headers.get('origin');
  return new Response(null, {
    status: 200,  // Changed from 204 to 200
    headers: buildCorsHeaders(origin),
  });
}
```

### 3. Winners Display Issue ✅
**Resolved by:** Fix #1 above

The "winners error" mentioned in the logs was actually caused by the same `h.startsWith` error, which occurred when filtering winner data to display on the landing page.

## Deployment Steps

### Step 1: Database Migration (Optional)
A migration file has been created for documentation purposes:
```bash
supabase/migrations/20260209051700_edge_function_cors_fix.sql
```

This migration doesn't change the database schema but serves as a deployment marker. Apply it using:
```bash
supabase db push
```

### Step 2: Deploy Edge Functions (CRITICAL)
The CORS fix requires redeploying the edge functions. Use the provided deployment script:

```bash
./deploy-edge-functions.sh
```

Or manually deploy each function:
```bash
supabase functions deploy purchase-tickets-with-bonus
supabase functions deploy update-user-avatar
supabase functions deploy upsert-user
```

**Important:** Edge functions MUST be redeployed for the CORS fix to take effect. The code changes alone are not sufficient until the functions are redeployed to Supabase.

### Step 3: Frontend Deployment
The frontend fix (database.ts) will be automatically deployed when the application is built and deployed:
```bash
npm run build
```

The build process will include the fixed version of `database.ts` with the `String()` conversion.

## Testing Verification

### Test 1: Verify h.startsWith Fix
1. Navigate to the landing page: https://substage.theprize.io/
2. Open browser console (F12)
3. Check for the error: `h.startsWith is not a function`
4. **Expected:** No such errors should appear

### Test 2: Verify CORS Fix
1. Navigate to a competition page
2. Attempt to purchase tickets using "Pay with Balance"
3. Open browser console and Network tab
4. Look for the OPTIONS preflight request to `purchase-tickets-with-bonus`
5. **Expected:** 
   - OPTIONS request should return status 200 (not 204)
   - No CORS errors in console
   - Purchase should succeed

### Test 3: Verify Winners Display
1. Navigate to the landing page
2. Check the "Recent Activity" section
3. **Expected:** 
   - Winners should display correctly
   - No JavaScript errors related to prize display
   - Winners with monetary prizes ($), crypto prizes (BTC, ETH), or numeric prizes should all display

## Files Changed

### Frontend Changes
- `src/lib/database.ts` - Fixed string conversion for prize filtering

### Backend Changes  
- `supabase/functions/_shared/cors.ts` - Changed OPTIONS status from 204 to 200
- `supabase/migrations/20260209051700_edge_function_cors_fix.sql` - Documentation migration

## Rollback Plan

If issues occur after deployment:

### Frontend Rollback
Revert the change in `src/lib/database.ts`:
```typescript
// Change back to:
const prize = winner.competitionprize || '';
```

### Backend Rollback
Revert the CORS change and redeploy:
```typescript
// In supabase/functions/_shared/cors.ts, change back to:
return new Response(null, {
  status: 204,
  headers: buildCorsHeaders(origin),
});
```
Then redeploy: `./deploy-edge-functions.sh`

## Notes

- The TypeScript build has pre-existing type errors unrelated to these fixes
- The fixes are minimal and surgical, addressing only the specific issues reported
- No database schema changes are required
- The fixes are backward compatible and won't affect existing functionality
