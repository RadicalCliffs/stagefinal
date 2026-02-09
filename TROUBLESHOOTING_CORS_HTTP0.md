# CORS and "HTTP 0" Error - Complete Troubleshooting Guide

## Error Analysis

You're experiencing three types of errors:

1. **CORS preflight failure:**
   ```
   Access to fetch at 'https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/purchase-tickets-with-bonus' 
   from origin 'https://substage.theprize.io' has been blocked by CORS policy: 
   Response to preflight request doesn't pass access control check: It does not have HTTP ok status.
   ```

2. **Network error:**
   ```
   Failed to load resource: net::ERR_FAILED
   ```

3. **HTTP 0 error:**
   ```
   Message: HTTP 0:
   ```

## What "HTTP 0" Means

`HTTP 0:` indicates that the browser received **no HTTP response at all**. This happens when:

1. **The request never reached the server** (network error)
2. **The server didn't respond** (timeout, crash, or blocking)
3. **The preflight OPTIONS request failed** (most likely)

When OPTIONS preflight fails, the browser:
- Blocks the actual POST request
- Reports "Failed to fetch"
- Shows "HTTP 0" because no response was received
- Displays CORS error in console

## Root Causes and Solutions

### Issue #1: Edge Function Not Deployed ⚠️ MOST LIKELY

**Problem:**
The code fix exists in the repository but hasn't been deployed to Supabase production.

**Evidence:**
- Code shows proper CORS handling with HTTP 200
- Backup file shows old code with HTTP 204
- No deployment has been run since the fix

**Solution:**
```bash
# Deploy the edge function
supabase functions deploy purchase-tickets-with-bonus

# Or use the deployment script
./deploy-edge-functions.sh
```

**See:** [DEPLOYMENT_INSTRUCTIONS_CORS_FIX.md](./DEPLOYMENT_INSTRUCTIONS_CORS_FIX.md)

---

### Issue #2: Edge Function Returns HTTP 204 Instead of 200

**Problem:**
Old CORS implementation returns HTTP 204 for OPTIONS, which some browsers/security tools reject.

**Check:**
```bash
curl -i -X OPTIONS \
  https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/purchase-tickets-with-bonus \
  -H "Origin: https://substage.theprize.io"
```

**Expected:** `HTTP/2 200 OK`  
**If you see:** `HTTP/2 204 No Content` → Old code is deployed

**Solution:**
Deploy the updated edge function (see Issue #1)

---

### Issue #3: Missing CORS Headers on OPTIONS Response

**Problem:**
The OPTIONS response doesn't include required CORS headers.

**Check:**
Look for these headers in OPTIONS response:
```
access-control-allow-origin: https://substage.theprize.io
access-control-allow-credentials: true
access-control-allow-methods: GET, POST, PUT, DELETE, OPTIONS
access-control-allow-headers: authorization, x-client-info, apikey, content-type, cache-control, pragma, expires
```

**If missing:**
Deploy the updated edge function with shared CORS module.

---

### Issue #4: Database Schema - Missing updated_at Column

**Problem:**
Edge function tries to update `updated_at` column that doesn't exist in `sub_account_balances` table.

**Error:**
```
column "updated_at" of relation "sub_account_balances" does not exist
```

**Check:**
```sql
SELECT column_name 
FROM information_schema.columns
WHERE table_name = 'sub_account_balances' 
  AND column_name = 'updated_at';
```

**If empty:** Column is missing

**Solution:**
Run this SQL in Supabase SQL Editor:
```sql
ALTER TABLE sub_account_balances 
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

CREATE TRIGGER update_sub_account_balances_updated_at
  BEFORE UPDATE ON sub_account_balances
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

**Or use hotfix:**
```bash
# Copy and run in Supabase SQL Editor:
cat supabase/HOTFIX_add_updated_at_to_sub_account_balances.sql
```

---

### Issue #5: Environment Variables Not Set

**Problem:**
Edge function needs these environment variables:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SITE_URL` (for CORS)

**Check:**
In Supabase Dashboard:
1. Go to Edge Functions
2. Select `purchase-tickets-with-bonus`
3. Check Environment Variables section

**Required:**
```
SUPABASE_URL=https://mthwfldcjvpxjtmrqkqm.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
SITE_URL=https://substage.theprize.io
```

---

### Issue #6: CDN or Browser Cache

**Problem:**
Old CORS response is cached by CDN or browser.

**Solution:**

**Browser:**
- Hard refresh: `Ctrl + Shift + R` (Windows/Linux) or `Cmd + Shift + R` (Mac)
- Clear browser cache
- Try incognito/private mode

**CDN:**
- Wait for cache to expire (check `Access-Control-Max-Age` header)
- Manually purge cache if you have CDN access

---

### Issue #7: Wrong Origin Configuration

**Problem:**
The requesting origin is not in the allowed list.

**Check:**
Current allowed origins in `supabase/functions/_shared/cors.ts`:
```typescript
const ALLOWED_ORIGINS = [
  SITE_URL,
  'https://substage.theprize.io',
  'https://theprize.io',
  'https://theprizeio.netlify.app',
  'https://www.theprize.io',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8888',
];
```

**If your origin is different:**
Add it to the allowed list and redeploy.

---

### Issue #8: Edge Function Timeout or Crash

**Problem:**
Function takes too long to respond or crashes during execution.

**Check:**
1. Go to Supabase Dashboard
2. Navigate to Edge Functions
3. Select `purchase-tickets-with-bonus`
4. View Logs

**Look for:**
- Timeout errors
- Runtime exceptions
- Database connection errors
- Missing dependencies

**Common causes:**
- Database query too slow
- RPC function error
- Invalid data in request

---

## Diagnostic Workflow

Follow these steps in order:

### Step 1: Verify Code is Correct
```bash
# Check that shared CORS module is imported
grep "buildCorsHeaders" supabase/functions/purchase-tickets-with-bonus/index.ts

# Should show:
# import { buildCorsHeaders, handleCorsOptions } from "../_shared/cors.ts";
```

### Step 2: Check Shared CORS Module
```bash
# Verify it returns HTTP 200
grep "status: 200" supabase/functions/_shared/cors.ts

# Should show:
# status: 200,  // Use 200 instead of 204 for better compatibility
```

### Step 3: Deploy the Function
```bash
supabase functions deploy purchase-tickets-with-bonus
```

### Step 4: Test OPTIONS Request
```bash
./verify-cors-fix.sh
```

### Step 5: Check Supabase Logs
1. Open Supabase Dashboard
2. Go to Edge Functions → purchase-tickets-with-bonus
3. View recent invocations
4. Look for errors

### Step 6: Test in Browser
1. Open https://substage.theprize.io
2. Open DevTools (F12)
3. Go to Network tab
4. Try purchasing tickets
5. Check OPTIONS request

### Step 7: Verify Database Schema
```sql
-- Check updated_at column exists
SELECT column_name 
FROM information_schema.columns
WHERE table_name = 'sub_account_balances' 
  AND column_name = 'updated_at';

-- If empty, run:
ALTER TABLE sub_account_balances 
  ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
```

## Quick Fix Checklist

Go through this checklist:

- [ ] Code has shared CORS import: `import { buildCorsHeaders, handleCorsOptions }`
- [ ] Shared CORS module returns `status: 200`
- [ ] Edge function deployed to Supabase: `supabase functions deploy purchase-tickets-with-bonus`
- [ ] OPTIONS returns HTTP 200 (not 204): `curl -X OPTIONS <url>`
- [ ] CORS headers present on OPTIONS response
- [ ] CORS headers present on error responses
- [ ] Database has `updated_at` column in `sub_account_balances`
- [ ] Environment variables set correctly
- [ ] Browser cache cleared
- [ ] No errors in Supabase function logs

## Expected Behavior After Fix

### OPTIONS Preflight
```
Request:
  OPTIONS /functions/v1/purchase-tickets-with-bonus
  Origin: https://substage.theprize.io
  
Response:
  HTTP/2 200 OK ← Must be 200
  access-control-allow-origin: https://substage.theprize.io
  access-control-allow-credentials: true
  access-control-allow-methods: GET, POST, PUT, DELETE, OPTIONS
```

### POST Request (Error Case)
```
Request:
  POST /functions/v1/purchase-tickets-with-bonus
  Origin: https://substage.theprize.io
  Body: {}
  
Response:
  HTTP/2 400 Bad Request
  access-control-allow-origin: https://substage.theprize.io ← Present on errors too
  
  {"success":false,"error":"userId or walletAddress required"}
```

### Browser Console
```
✅ No CORS errors
✅ No "Failed to fetch" errors  
✅ No "HTTP 0:" errors
✅ Relevant error messages (if request invalid)
✅ Success messages (if request valid)
```

## Still Not Working?

If you've tried everything and it still doesn't work:

### 1. Check Supabase Status
Visit: https://status.supabase.com/
Edge Functions might be having issues.

### 2. Enable Verbose Logging
Add console.log statements to the edge function to see what's happening.

### 3. Test with curl
```bash
# Test OPTIONS
curl -v -X OPTIONS \
  https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/purchase-tickets-with-bonus \
  -H "Origin: https://substage.theprize.io"

# Test POST
curl -v -X POST \
  https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/purchase-tickets-with-bonus \
  -H "Origin: https://substage.theprize.io" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### 4. Compare with Working Function
If other edge functions work, compare their CORS implementation.

### 5. Review Recent Changes
Check git log for any recent changes that might have broken something:
```bash
git log --oneline supabase/functions/purchase-tickets-with-bonus/ | head -10
```

## Summary

**Most likely cause:** Edge function not deployed  
**Most likely solution:** Run `supabase functions deploy purchase-tickets-with-bonus`

**Second most likely cause:** Missing `updated_at` column  
**Second most likely solution:** Run `HOTFIX_add_updated_at_to_sub_account_balances.sql`

After applying both fixes, test with `./verify-cors-fix.sh` and verify in browser.

---

**Related Documentation:**
- [DEPLOYMENT_INSTRUCTIONS_CORS_FIX.md](./DEPLOYMENT_INSTRUCTIONS_CORS_FIX.md) - Deployment guide
- [CORS_DEPLOYMENT_URGENT.md](./CORS_DEPLOYMENT_URGENT.md) - Previous CORS issues
- [URGENT_ADD_UPDATED_AT_COLUMN.md](./URGENT_ADD_UPDATED_AT_COLUMN.md) - Database schema fix
