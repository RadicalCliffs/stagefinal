# 🚨 CORS Fix Deployment Instructions

## Problem Statement
The edge function `purchase-tickets-with-bonus` is returning CORS errors:
- `Access to fetch has been blocked by CORS policy`
- `Response to preflight request doesn't pass access control check`
- `HTTP 0:` errors indicating function is not responding

## Root Cause
The edge function code has been updated with CORS fixes but **has not been deployed to Supabase production**. The live function still has the old code that:
1. Returns HTTP 204 for OPTIONS (should be 200)
2. May be missing proper CORS headers
3. Not handling all response paths correctly

## Current State

### ✅ What's Fixed in Code
- [x] Edge function updated to use shared CORS module
- [x] OPTIONS returns HTTP 200 (not 204)
- [x] Proper origin validation
- [x] CORS headers on all responses (success, error, OPTIONS)
- [x] Code is committed to branch `copilot/fix-cors-policy-issue`

### ❌ What's NOT Fixed Yet
- [ ] Edge function NOT deployed to Supabase
- [ ] Live function still running old code
- [ ] Users still experiencing CORS errors
- [ ] Database schema may be missing `updated_at` column

## Deployment Steps

### Prerequisites
You need ONE of the following:
1. **Supabase CLI** (recommended) - Install with `npm install -g supabase`
2. **Supabase Dashboard Access** - Manual upload via web UI
3. **CI/CD Pipeline** - Automated deployment (if configured)

### Option 1: Deploy via Supabase CLI (Recommended)

```bash
# 1. Navigate to project root
cd /home/runner/work/theprize.io/theprize.io

# 2. Login to Supabase (if not already logged in)
supabase login

# 3. Link to project (if not already linked)
supabase link --project-ref mthwfldcjvpxjtmrqkqm

# 4. Deploy the critical function
supabase functions deploy purchase-tickets-with-bonus

# Expected output:
# ✓ Deployed function purchase-tickets-with-bonus
# Function URL: https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/purchase-tickets-with-bonus
```

### Option 2: Deploy via Supabase Dashboard

1. Open [Supabase Dashboard](https://app.supabase.com/project/mthwfldcjvpxjtmrqkqm)
2. Navigate to **Edge Functions** section
3. Find `purchase-tickets-with-bonus` function
4. Click **Deploy New Version**
5. Upload the contents of `supabase/functions/purchase-tickets-with-bonus/index.ts`
6. Confirm deployment

### Option 3: Use Deployment Script

```bash
# Run the deployment script
./deploy-edge-functions.sh

# This will deploy:
# - purchase-tickets-with-bonus
# - update-user-avatar
# - upsert-user
```

## Verification Steps

### 1. Test OPTIONS Preflight Request

```bash
curl -i -X OPTIONS \
  https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/purchase-tickets-with-bonus \
  -H "Origin: https://substage.theprize.io" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```

**Expected Response:**
```
HTTP/2 200 OK  ← Must be 200, not 204 or 5xx
access-control-allow-origin: https://substage.theprize.io
access-control-allow-credentials: true
access-control-allow-methods: GET, POST, PUT, DELETE, OPTIONS
access-control-allow-headers: authorization, x-client-info, apikey, content-type, cache-control, pragma, expires
access-control-max-age: 86400
vary: Origin
```

**❌ If you see:**
- `HTTP/2 204 No Content` → Old code still deployed
- `HTTP/2 500` → Function has errors
- `HTTP/2 404` → Function not found
- No response → Function not accessible

### 2. Test Actual Purchase Request

```bash
curl -i -X POST \
  https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/purchase-tickets-with-bonus \
  -H "Origin: https://substage.theprize.io" \
  -H "Content-Type: application/json" \
  -H "apikey: YOUR_ANON_KEY" \
  -d '{}'
```

**Expected Response:**
```
HTTP/2 400 Bad Request  ← Any 4xx is fine (we sent empty body)
access-control-allow-origin: https://substage.theprize.io
access-control-allow-credentials: true
content-type: application/json

{"success":false,"error":"userId or walletAddress required"}
```

**✅ Success if:**
- CORS headers are present
- Error message makes sense
- No "blocked by CORS policy" message

### 3. Test in Browser

1. Open browser console on https://substage.theprize.io
2. Run this JavaScript:

```javascript
fetch('https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/purchase-tickets-with-bonus', {
  method: 'OPTIONS',
  headers: {
    'Content-Type': 'application/json'
  }
})
.then(r => {
  console.log('✅ SUCCESS - Status:', r.status);
  console.log('Headers:', [...r.headers.entries()]);
})
.catch(e => {
  console.error('❌ FAILED:', e.message);
});
```

**Expected Output:**
```
✅ SUCCESS - Status: 200
Headers: [
  ['access-control-allow-origin', 'https://substage.theprize.io'],
  ['access-control-allow-credentials', 'true'],
  ...
]
```

### 4. Test Full Purchase Flow

1. Go to https://substage.theprize.io/competitions/22786f37-66a1-4bf1-aa15-910ddf8d4eb4
2. Open browser console (F12)
3. Try to purchase tickets with balance
4. Check console for errors

**Expected:**
- No CORS errors
- No "Failed to fetch" errors
- No "HTTP 0:" errors
- Either successful purchase or relevant error message

## Database Schema Fix (Required)

If you see error: `column "updated_at" of relation "sub_account_balances" does not exist`

### Run this SQL in Supabase Dashboard:

```sql
-- Add missing updated_at column
ALTER TABLE sub_account_balances 
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

-- Create auto-update trigger
DROP TRIGGER IF EXISTS update_sub_account_balances_updated_at ON sub_account_balances;
CREATE TRIGGER update_sub_account_balances_updated_at
  BEFORE UPDATE ON sub_account_balances
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

Or run the prepared hotfix:
```bash
# Copy contents of this file to Supabase SQL Editor
cat supabase/HOTFIX_add_updated_at_to_sub_account_balances.sql
```

## Troubleshooting

### Issue: Still seeing HTTP 204
**Cause:** Old function still deployed  
**Fix:** Redeploy function, clear CDN cache if applicable

### Issue: Still seeing CORS errors
**Possible causes:**
1. Function not deployed → Deploy it
2. Wrong origin → Check SITE_URL environment variable
3. CDN cache → Wait or manually purge cache
4. Browser cache → Hard refresh (Ctrl+Shift+R)

### Issue: Function returns 500 error
**Check:**
1. Supabase function logs for error details
2. Database schema (updated_at column exists?)
3. Environment variables (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

### Issue: "Failed to fetch" errors
**Causes:**
1. CORS preflight failing (check OPTIONS response)
2. Function timing out
3. Network issues
4. Wrong function URL

## Post-Deployment Checklist

- [ ] OPTIONS returns HTTP 200
- [ ] CORS headers present on all responses
- [ ] Browser console shows no CORS errors
- [ ] Purchase flow works end-to-end
- [ ] No "HTTP 0:" errors
- [ ] No "Failed to fetch" errors
- [ ] Database has updated_at column
- [ ] Trigger auto-updates timestamp

## Timeline

1. **Code Fixed:** ✅ COMPLETE (in branch copilot/fix-cors-policy-issue)
2. **Deployment:** ⏳ PENDING (you are here)
3. **Verification:** ⏳ PENDING (after deployment)
4. **User Testing:** ⏳ PENDING (after verification)

## Next Steps

1. **Deploy the function** using one of the methods above
2. **Run verification tests** to confirm deployment
3. **Test in browser** to ensure errors are gone
4. **Apply database fix** if updated_at column is missing
5. **Monitor** for any remaining issues

## Need Help?

If deployment fails or errors persist:
1. Check Supabase function logs
2. Verify environment variables
3. Ensure database schema is up to date
4. Check network connectivity
5. Review error messages in browser console

---

**Status:** Ready for deployment  
**Priority:** P0 - CRITICAL  
**Estimated Time:** 5-10 minutes  
**Risk:** Low (code is tested and committed)
