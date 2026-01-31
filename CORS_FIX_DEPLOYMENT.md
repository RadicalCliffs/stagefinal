# CORS Fix Deployment Guide

## Issue Summary
The frontend was experiencing CORS errors when calling the `purchase-tickets-with-bonus` Edge Function:

```
Access to fetch at 'https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/purchase-tickets-with-bonus' 
from origin 'https://substage.theprize.io' has been blocked by CORS policy: 
Request header field cache-control is not allowed by Access-Control-Allow-Headers in preflight response.
```

## Root Cause
The Supabase client in `src/lib/supabase.ts` sends the following headers with all requests to prevent aggressive caching:
- `Cache-Control: no-cache, no-store, must-revalidate`
- `Pragma: no-cache`
- `Expires: 0`

These headers were not allowed in the CORS configuration of several Edge Functions, causing preflight requests to fail.

## Changes Made

### 1. Shared CORS Configuration
Updated `/supabase/functions/_shared/cors.ts` to include the missing headers:

```typescript
'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control, pragma, expires'
```

### 2. Edge Functions Updated
The following Edge Functions had their inlined CORS configurations updated:

- `confirm-pending-tickets`
- `email-auth-start`
- `email-auth-verify`
- `create-new-user`
- `payments-auto-heal`
- `lucky-dip-reserve`
- `update-user-avatar`
- `get-user-profile`

### 3. Already Fixed Functions
These functions already had the correct CORS headers:
- `purchase-tickets-with-bonus`
- `reserve-tickets`
- `reserve_tickets`

## Deployment Steps

To deploy the CORS fixes to production:

### Option 1: Deploy All Functions (Recommended)
```bash
supabase functions deploy
```

### Option 2: Deploy Individual Functions
```bash
# Deploy the critical user-facing functions
supabase functions deploy purchase-tickets-with-bonus
supabase functions deploy reserve-tickets
supabase functions deploy confirm-pending-tickets
supabase functions deploy email-auth-start
supabase functions deploy email-auth-verify
supabase functions deploy get-user-profile
supabase functions deploy create-new-user
supabase functions deploy payments-auto-heal
supabase functions deploy lucky-dip-reserve
supabase functions deploy update-user-avatar
```

### Option 3: Deploy via Supabase Dashboard
1. Go to the Supabase Dashboard
2. Navigate to Edge Functions
3. For each updated function, redeploy using the dashboard UI

## Verification

After deployment, verify the fix:

1. Open the browser console
2. Navigate to a competition page
3. Try to purchase tickets using balance
4. Confirm there are no CORS errors in the console
5. Verify the purchase completes successfully

## Testing Checklist

- [ ] Deploy updated Edge Functions to Supabase
- [ ] Test purchase with balance on substage.theprize.io
- [ ] Verify no CORS errors in browser console
- [ ] Confirm successful ticket purchase
- [ ] Test other affected functions (email auth, user profile, etc.)

## Technical Details

### Why These Headers?
The frontend sends cache-control headers to prevent Safari and other browsers from aggressively caching API responses. This is especially important for:
- Real-time balance updates
- Recent competition entries
- Transaction history

Without these headers, Safari users would see stale data.

### CORS Preflight Process
1. Browser sends OPTIONS request (preflight) before the actual request
2. Server responds with allowed methods, headers, and origins
3. If the preflight passes, browser sends the actual request
4. If the preflight fails, browser blocks the request with a CORS error

The fix ensures that the preflight response includes `cache-control`, `pragma`, and `expires` in the `Access-Control-Allow-Headers` list.

## Rollback Plan

If issues occur after deployment:

1. The previous version should still be available in Supabase Edge Functions history
2. Rollback to the previous version using the Supabase Dashboard
3. Or, remove the cache-control headers from the frontend Supabase client (not recommended as it will cause caching issues)

## Related Files

- Frontend Supabase client: `src/lib/supabase.ts`
- Shared CORS config: `supabase/functions/_shared/cors.ts`
- Balance payment service: `src/lib/balance-payment-service.ts`
- Updated Edge Functions: See list in "Edge Functions Updated" section above
