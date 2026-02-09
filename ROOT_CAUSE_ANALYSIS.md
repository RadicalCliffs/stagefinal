# Root Cause Analysis: CORS and HTTP 0 Errors

## Executive Summary

**Problem:** CORS errors blocking ticket purchases  
**Root Cause:** Edge function not deployed with CORS fix  
**Solution:** Deploy edge function  
**Time to Fix:** 2 minutes  
**Complexity:** Low (one command)

## Error Chain

### 1. Browser Makes OPTIONS Preflight Request
```
OPTIONS /functions/v1/purchase-tickets-with-bonus
Origin: https://substage.theprize.io
Access-Control-Request-Method: POST
```

### 2. Edge Function Returns Wrong Status (Currently)
```
HTTP/2 204 No Content  ← WRONG (should be 200)
```
OR
```
HTTP/2 500 Internal Server Error  ← Function error
```
OR
```
(no response)  ← Function timeout/crash
```

### 3. Browser Rejects Response
Because the status is not HTTP 200 (or 2xx), browser:
- ❌ Blocks the actual POST request
- ❌ Reports "CORS policy error"
- ❌ Shows "Failed to fetch"
- ❌ Shows "HTTP 0:" (no response received)

### 4. User Sees Errors
```javascript
[ErrorMonitor] APIERROR
Message: Failed to fetch
Message: HTTP 0:
```

## Why Is This Happening?

### The Code Timeline

**Before (deployed, currently live):**
```typescript
// In purchase-tickets-with-bonus/index.ts (OLD CODE)
function handleCorsOptions(req: Request): Response {
  return new Response(null, {
    status: 204,  // ← THIS IS THE PROBLEM
    headers: buildCorsHeaders(origin),
  });
}
```

**After (in repository, NOT deployed):**
```typescript
// In _shared/cors.ts (NEW CODE)
export function handleCorsOptions(req: Request): Response {
  return new Response(null, {
    status: 200,  // ← THIS IS THE FIX
    headers: buildCorsHeaders(origin),
  });
}
```

### Why Status 204 Is Rejected

While HTTP 204 is technically valid per RFC 7231, some:
- Browser implementations
- Security tools
- Proxies
- CDNs

...require HTTP 200 for CORS preflight responses.

Modern best practice: **ALWAYS use HTTP 200 for OPTIONS**

## Technical Details

### OPTIONS Preflight Flow

```
┌──────────┐                           ┌─────────────┐
│ Browser  │                           │ Edge Func   │
└────┬─────┘                           └──────┬──────┘
     │                                        │
     │  OPTIONS (preflight)                   │
     ├────────────────────────────────────────>
     │  Origin: https://substage.theprize.io  │
     │                                        │
     │                                        │
     │  HTTP 204 No Content ❌                │
     <────────────────────────────────────────┤
     │  access-control-allow-origin: ...      │
     │                                        │
     │  ❌ REJECTED BY BROWSER                │
     │  (Status not HTTP 200)                 │
     │                                        │
     X  POST request BLOCKED                  │
     │                                        │
     │  User sees: "Failed to fetch"          │
     │  User sees: "HTTP 0:"                  │
     │  User sees: "CORS policy error"        │
     └                                        └
```

### Correct Flow (After Fix)

```
┌──────────┐                           ┌─────────────┐
│ Browser  │                           │ Edge Func   │
└────┬─────┘                           └──────┬──────┘
     │                                        │
     │  OPTIONS (preflight)                   │
     ├────────────────────────────────────────>
     │  Origin: https://substage.theprize.io  │
     │                                        │
     │                                        │
     │  HTTP 200 OK ✅                        │
     <────────────────────────────────────────┤
     │  access-control-allow-origin: ...      │
     │                                        │
     │  ✅ ACCEPTED BY BROWSER                │
     │  (Status is HTTP 200)                  │
     │                                        │
     │  POST (actual request)                 │
     ├────────────────────────────────────────>
     │  { userId, competitionId, ... }        │
     │                                        │
     │  HTTP 200 OK                           │
     <────────────────────────────────────────┤
     │  { success: true, tickets: [...] }     │
     │                                        │
     │  ✅ Purchase successful                │
     └                                        └
```

## Why "HTTP 0:"?

The "HTTP 0:" error means **no HTTP response was received**. This happens when:

1. **Preflight fails** → Browser blocks request before it's sent
2. **Network error** → Request never reaches server
3. **Function timeout** → Server doesn't respond in time
4. **Function crash** → Server error before response

In this case: **#1 - Preflight fails**

The browser tries OPTIONS, gets rejected, blocks POST, and reports "HTTP 0" because the POST never happened.

## Why Still Seeing Errors?

### Deployment State

| Component | Status | State |
|-----------|--------|-------|
| Code in Repository | ✅ Fixed | Returns HTTP 200 |
| Code in Supabase | ❌ Old | Returns HTTP 204 |
| Browser | ❌ Failing | Blocked by CORS |

**The gap:** Code is fixed locally but not deployed remotely.

### How Supabase Edge Functions Work

Edge functions require **separate deployment**:

```bash
# Frontend deployment (automatic)
git push origin main
→ Netlify/Vercel builds and deploys
→ Updates website

# Edge function deployment (manual)
supabase functions deploy <function-name>
→ Uploads code to Supabase
→ Updates live edge function
```

**Important:** Pushing to git does NOT deploy edge functions automatically.

## Secondary Issue: Database Schema

The edge function also references a column that might not exist:

```typescript
.update({ available_balance: newBalance, updated_at: new Date().toISOString() })
```

If `updated_at` column is missing from `sub_account_balances` table:
- Function will crash with 500 error
- CORS preflight might succeed
- But actual purchase will fail

**Solution:** Run `HOTFIX_add_updated_at_to_sub_account_balances.sql`

## The Complete Fix

### Step 1: Deploy Edge Function
```bash
supabase functions deploy purchase-tickets-with-bonus
```

**Effect:**
- ✅ OPTIONS returns HTTP 200
- ✅ CORS preflight succeeds
- ✅ Browser allows POST request

### Step 2: Fix Database Schema (if needed)
```sql
ALTER TABLE sub_account_balances 
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
```

**Effect:**
- ✅ Function doesn't crash on update
- ✅ Purchase completes successfully

## Verification

### Before Fix
```bash
curl -i -X OPTIONS https://.../.../purchase-tickets-with-bonus
HTTP/2 204 No Content  ← WRONG
```

### After Fix
```bash
curl -i -X OPTIONS https://.../.../purchase-tickets-with-bonus
HTTP/2 200 OK  ← CORRECT
access-control-allow-origin: https://substage.theprize.io
access-control-allow-credentials: true
```

## Why This Keeps Happening

Previous sessions:
1. ✅ Fixed the code
2. ✅ Committed to repository
3. ❌ Forgot to deploy

This session:
1. ✅ Fixed the code (already done)
2. ✅ Committed to repository (already done)
3. ⏳ **Deploy required** ← YOU ARE HERE

## Prevention

To avoid this in the future:

### 1. Add Deployment Step to PR Checklist
```markdown
- [ ] Code changes committed
- [ ] Edge functions deployed  ← ADD THIS
- [ ] Tested in production
```

### 2. Automate Deployment
Create GitHub Action:
```yaml
- name: Deploy Edge Functions
  run: supabase functions deploy purchase-tickets-with-bonus
```

### 3. Add Verification Test
```bash
./verify-cors-fix.sh
```

### 4. Document Deployment
```markdown
# After merging PR:
1. git pull main
2. supabase functions deploy <function-name>
3. ./verify-cors-fix.sh
4. Test in browser
```

## Summary

**Current State:**
- ✅ Code is correct
- ✅ Fix is implemented
- ✅ Tests are written
- ❌ **NOT DEPLOYED** ← The problem

**Required Action:**
```bash
supabase functions deploy purchase-tickets-with-bonus
```

**Expected Result:**
- ✅ OPTIONS returns HTTP 200
- ✅ No CORS errors
- ✅ No "Failed to fetch" errors
- ✅ No "HTTP 0:" errors
- ✅ Purchases work

**Time:** 2 minutes  
**Difficulty:** Easy  
**Risk:** Low  
**Priority:** P0 - CRITICAL

---

**Next Step:** Run `./deploy-cors-fix.sh` or manually deploy via Supabase CLI/Dashboard.
