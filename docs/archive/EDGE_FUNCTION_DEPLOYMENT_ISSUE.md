# Edge Function Deployment Issue - CRITICAL

## Problem

Lucky Dip reservations are failing with:
```
FunctionsFetchError: Failed to send a request to the Edge Function
TypeError: Failed to fetch
URL: https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/lucky-dip-reserve
```

## Root Cause

The `lucky-dip-reserve` edge function code has been updated in the Git repository but **has NOT been deployed** to Supabase.

Recent changes:
1. JWT validation was added (commit aa2076e)
2. JWT validation was reverted (commit 265cd2b) because the app doesn't use Supabase Auth
3. Code is now in a working state in Git
4. **BUT the deployed version on Supabase is still the broken JWT validation version**

## Why It's Failing

The deployed edge function (on Supabase) has JWT validation code that:
1. Expects a JWT in the Authorization header
2. Tries to validate it with `userClient.auth.getUser()`
3. Returns 401 "Missing bearer token" for all requests

But this app doesn't use Supabase Auth, so no JWTs exist. The result:
- Function returns 401 before even getting to CORS
- Client sees "Failed to fetch" (network error due to CORS rejection)

## Solution

**Deploy the latest `lucky-dip-reserve` function to Supabase.**

### Deployment Command

```bash
# Navigate to project root
cd /path/to/theprize.io

# Deploy the specific function
supabase functions deploy lucky-dip-reserve

# Or deploy all functions
supabase functions deploy
```

### Prerequisites

1. **Supabase CLI installed:**
   ```bash
   npm install -g supabase
   ```

2. **Authenticated with Supabase:**
   ```bash
   supabase login
   ```

3. **Linked to project:**
   ```bash
   supabase link --project-ref mthwfldcjvpxjtmrqkqm
   ```

### Verification

After deployment, test the function:

```bash
curl -X POST https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/lucky-dip-reserve \
  -H "Authorization: ******" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "prize:pid:test",
    "competitionId": "22786f37-66a1-4bf1-aa15-910ddf8d4eb4",
    "count": 5,
    "ticketPrice": 1
  }'
```

Should return:
- **Not:** 401 Unauthorized or Failed to fetch
- **Instead:** Either success response or validation error (missing fields, etc.)

## Current State

**Git Repository:**
- ✅ `lucky-dip-reserve/index.ts` is correct (JWT validation removed)
- ✅ Code will work when deployed

**Supabase Deployment:**
- ❌ Edge function has old code with JWT validation
- ❌ All reservation requests failing
- ❌ Blocks all Lucky Dip purchases

## Impact

**Broken:**
- All Lucky Dip ticket reservations
- Users cannot purchase random tickets
- "Failed to fetch" error in browser console

**Working:**
- Manual ticket selection (uses different edge function)
- Balance payments (different code path)
- Other functionality

## Action Required

**IMMEDIATELY:** Deploy the edge function using the command above.

**Alternative:** If deployment access isn't available:
1. Copy the contents of `supabase/functions/lucky-dip-reserve/index.ts`
2. Log into Supabase Dashboard
3. Go to Edge Functions
4. Edit `lucky-dip-reserve`
5. Paste the updated code
6. Deploy

## Files Affected

- `supabase/functions/lucky-dip-reserve/index.ts` - Latest version in Git is correct
- Deployed version on Supabase - Needs update

## Timeline

- **Commit aa2076e** (Feb 5, 17:19): JWT validation added (broken)
- **Commit 265cd2b** (Feb 5, 17:24): JWT validation reverted (fixed in Git)
- **Current**: Git has correct code, Supabase has broken code
- **Status**: Waiting for deployment

---

**Priority:** CRITICAL - Blocks primary user flow
**Time to Fix:** 2 minutes (just need to run deployment command)
