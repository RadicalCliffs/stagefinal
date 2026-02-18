# Lucky Dip CORS Fix - Deployment Guide

## Issue Summary

**Error:** CORS error when trying to reserve lucky dip tickets:
```
Access to fetch at 'https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/lucky-dip-reserve' 
from origin 'https://stage.theprize.io' has been blocked by CORS policy: 
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

**Root Cause:** The `lucky-dip-reserve` Edge Function is either:
1. Not deployed to Supabase
2. Has a runtime error that prevents it from returning CORS headers
3. Missing from the deployment

## Solution

The `lucky-dip-reserve` Edge Function has been updated with comprehensive error handling that ensures CORS headers are ALWAYS returned, even when errors occur.

### Changes Made

1. **Enhanced Error Handling**: Added a top-level try-catch that wraps the entire handler
2. **Guaranteed CORS Headers**: Even fatal errors now return proper CORS headers
3. **Better Error Logging**: All errors are logged with context for debugging

### Deployment Steps

#### Prerequisites

1. **Supabase CLI installed**:
   ```bash
   npm install -g supabase
   ```

2. **Login to Supabase**:
   ```bash
   supabase login
   ```

3. **Link to your project** (if not already linked):
   ```bash
   supabase link --project-ref YOUR_PROJECT_REF
   ```

#### Deploy the Function

**Option 1: Deploy just the lucky-dip-reserve function**:
```bash
cd /path/to/theprize.io
supabase functions deploy lucky-dip-reserve
```

**Option 2: Deploy all functions**:
```bash
cd /path/to/theprize.io
supabase functions deploy
```

#### Verify Deployment

After deployment, verify the function is accessible:

```bash
# Check if function exists
curl -I https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/lucky-dip-reserve
```

Expected response should include:
- Status: 405 (Method Not Allowed) or 200 (OK)
- `access-control-allow-origin` header should be present

### Testing the Fix

1. **Navigate to a competition page** on stage.theprize.io
2. **Select "Lucky Dip" mode** (if available)
3. **Choose a ticket count** (e.g., 5 tickets)
4. **Click "Enter Now"** or the reserve button
5. **Verify**:
   - No CORS error in browser console
   - Tickets are successfully reserved
   - Reservation ID is returned
   - Frontend shows reserved tickets

### Alternative: Manual Deployment via Supabase Dashboard

If you don't have access to Supabase CLI:

1. **Open Supabase Dashboard**: https://app.supabase.com
2. **Navigate to Edge Functions** in your project
3. **Click "New Function"** or select `lucky-dip-reserve` if it exists
4. **Copy the entire contents** of `supabase/functions/lucky-dip-reserve/index.ts`
5. **Paste into the editor**
6. **Click "Deploy"**

### Verification Queries

After deployment, you can verify the function using:

```bash
# Test OPTIONS request (CORS preflight)
curl -X OPTIONS \
  https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/lucky-dip-reserve \
  -H "Origin: https://stage.theprize.io" \
  -v

# Should return:
# - Status: 200 OK
# - Access-Control-Allow-Origin: https://stage.theprize.io
# - Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
```

## What Was Changed in the Code

### Before (Potential Issue)
```typescript
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return handleCorsOptions(req);
  }
  const corsHeaders = buildCorsHeaders(req.headers.get('origin'));
  // ... rest of code
  // If error occurs early, no CORS headers returned
});
```

### After (Fixed)
```typescript
Deno.serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") {
      return handleCorsOptions(req);
    }
    const corsHeaders = buildCorsHeaders(req.headers.get('origin'));
    // ... rest of code
  } catch (topLevelError) {
    // CRITICAL: Last resort error handler that ALWAYS returns CORS headers
    const origin = req.headers.get('origin');
    const safeCorsHeaders = buildCorsHeaders(origin);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: "Internal server error. Please try again.",
        // ... error details
      }),
      {
        status: 500,
        headers: { ...safeCorsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});
```

## Troubleshooting

### Still Getting CORS Errors After Deployment

1. **Check if function is deployed**:
   ```bash
   supabase functions list
   ```

2. **Check function logs**:
   ```bash
   supabase functions logs lucky-dip-reserve
   ```

3. **Verify ALLOWED_ORIGINS** in the function code includes your origin:
   - `https://stage.theprize.io`
   - `https://theprize.io`

4. **Clear browser cache** and hard refresh (Ctrl+Shift+R / Cmd+Shift+R)

5. **Check Network tab** in browser DevTools:
   - Look for the OPTIONS preflight request
   - Check if it returns 200 OK
   - Verify POST request headers

### Function Returns 500 Error

Check the function logs for detailed error messages:
```bash
supabase functions logs lucky-dip-reserve --tail
```

Common issues:
- Missing environment variables (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
- RPC function `allocate_lucky_dip_tickets_batch` doesn't exist
- Database permissions issues

### ImportError or Module Not Found

The function uses inline imports for userId utilities to avoid bundler issues. If you see import errors, ensure the `_shared/userId.ts` file exists at:
```
supabase/functions/_shared/userId.ts
```

## Related Files

- **Edge Function**: `supabase/functions/lucky-dip-reserve/index.ts`
- **Frontend Usage**: `src/components/IndividualCompetition/IndividualCompetitionHeroSection.tsx`
- **Shared CORS Config**: `supabase/functions/_shared/cors.ts`
- **Shared User ID Utils**: `supabase/functions/_shared/userId.ts`

## Additional Notes

### Why This Happened

The CORS error occurs when:
1. The Edge Function isn't deployed (404 Not Found)
2. The Edge Function crashes before returning a response
3. The Edge Function doesn't set CORS headers

The fix ensures that even if the function fails, it will ALWAYS return proper CORS headers, preventing the CORS error from appearing in the browser console.

### Function Dependencies

The `lucky-dip-reserve` function depends on:
- **RPC Function**: `allocate_lucky_dip_tickets_batch` (7-parameter version)
- **Environment Variables**: 
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SITE_URL` (optional, defaults to https://stage.theprize.io)

Ensure these are properly configured in your Supabase project.

## Support

If issues persist:
1. Check Supabase function logs for detailed errors
2. Verify all migrations are applied (especially for `allocate_lucky_dip_tickets_batch`)
3. Test the RPC function directly in Supabase SQL Editor
4. Contact support with function logs and browser console errors

---

**Last Updated**: 2026-02-18
**PR**: #372 Fix
