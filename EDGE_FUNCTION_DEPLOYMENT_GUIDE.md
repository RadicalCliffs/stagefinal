# Edge Function Deployment Guide - READY TO DEPLOY

## Problem Summary

The `lucky-dip-reserve` edge function was failing to deploy due to import issues and now is ready for deployment.

### Original Issues

1. **Module Import Error** (FIXED ✅)
   - Error: `Module not found "_shared/userId.ts"`
   - Solution: Inlined helper functions (bundler doesn't support shared imports)

2. **Supabase-js Version** (FIXED ✅)
   - Recommendation: Use `npm:@supabase/supabase-js@2.45.4`
   - Updated from `jsr:@supabase/supabase-js@2` to pinned npm version

### Current Status

✅ **Code Fixed**: All deployment blockers resolved
✅ **Dependencies Inlined**: No shared module imports
✅ **Version Updated**: Using recommended npm package
⏳ **Deployment Required**: Function ready but needs to be deployed

## Solution

Deploy the `lucky-dip-reserve` edge function to Supabase.

### Prerequisites

1. **Supabase CLI** installed:
   ```bash
   npm install -g supabase
   ```

2. **Authentication**:
   ```bash
   supabase login
   ```

3. **Project linked**:
   ```bash
   supabase link --project-ref YOUR_PROJECT_REF
   ```
   
   To find your project ref:
   - Visit [Supabase Dashboard](https://app.supabase.com)
   - Select your project
   - Look in the URL: `app.supabase.com/project/YOUR_PROJECT_REF`
   - Or find it in Settings → General → Reference ID

### Deployment Steps

#### Option 1: Deploy Single Function (Recommended)

```bash
cd /path/to/theprize.io
./scripts/deploy-lucky-dip-reserve.sh
```

This script will:
- Verify Supabase CLI is installed
- Check authentication status
- Deploy only the `lucky-dip-reserve` function
- Provide verification instructions

#### Option 2: Deploy All Edge Functions

```bash
cd /path/to/theprize.io
./scripts/deploy-edge-functions.sh
```

Use this if you want to ensure all edge functions are up to date.

#### Option 3: Manual Deployment

```bash
cd /path/to/theprize.io
supabase functions deploy lucky-dip-reserve
```

### Expected Output

```
Deploying Function (project-ref: YOUR_PROJECT_REF)
  ✓ Deployed function lucky-dip-reserve
Function URL: https://YOUR_PROJECT_REF.supabase.co/functions/v1/lucky-dip-reserve
```

## Verification

### 1. Test CORS (Pre-flight Request)

```bash
curl -X OPTIONS \
  https://YOUR_PROJECT_REF.supabase.co/functions/v1/lucky-dip-reserve \
  -H 'Origin: https://stage.theprize.io' \
  -v
```

**Expected Response:**
- HTTP 200 OK
- Header: `Access-Control-Allow-Origin: https://stage.theprize.io`
- Header: `Access-Control-Allow-Credentials: true`

### 2. Test Function Invocation

```bash
curl -X POST \
  https://YOUR_PROJECT_REF.supabase.co/functions/v1/lucky-dip-reserve \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://stage.theprize.io' \
  -d '{
    "userId": "prize:pid:test",
    "competitionId": "VALID_COMPETITION_UUID",
    "count": 5,
    "ticketPrice": 1,
    "holdMinutes": 15
  }' \
  -v
```

**Expected Response (on success):**
```json
{
  "success": true,
  "reservationId": "...",
  "ticketNumbers": [123, 456, 789, ...],
  "ticketCount": 5,
  "totalAmount": 5,
  "expiresAt": "2026-02-18T16:30:00.000Z",
  "algorithm": "allocate-lucky-dip-batch",
  "message": "Successfully reserved 5 lucky dip tickets..."
}
```

**Expected Response (on error):**
```json
{
  "success": false,
  "error": "Competition not found, not active, or temporarily locked",
  "errorCode": 500,
  "retryable": true
}
```

### 3. Check Function Logs

```bash
supabase functions logs lucky-dip-reserve --tail
```

Then try to reserve tickets on the frontend. You should see logs like:
```
[abc12345] Lucky dip reserve request started
[abc12345] Canonical user ID: prize:pid:...
[abc12345] Allocating 472 lucky dip tickets for competition: e94f8f02...
[abc12345] Calling allocate_lucky_dip_tickets_batch RPC
[abc12345] Successfully reserved 472 tickets
```

### 4. Test on Frontend

1. Navigate to a competition page (e.g., `https://stage.theprize.io/competition/...`)
2. Select number of tickets using the Lucky Dip slider
3. Click "Enter Now"
4. Complete CAPTCHA
5. Check browser console logs

**Expected Console Output:**
```
[TicketReservation] Invoking lucky-dip-reserve edge function {ticketCount: 472}
[TicketReservation] Server-side Lucky Dip reservation successful ✓
```

**NOT** what we see currently:
```
[TicketReservation] Invoking lucky-dip-reserve edge function {ticketCount: 472}
... (silence)
```

## Troubleshooting

### Function Still Not Responding

1. **Check deployment status:**
   ```bash
   supabase functions list
   ```
   Verify `lucky-dip-reserve` is in the list.

2. **Check environment variables:**
   - Visit Supabase Dashboard → Edge Functions → `lucky-dip-reserve` → Settings
   - Verify these are set:
     - `SUPABASE_URL` - Your project URL
     - `SUPABASE_SERVICE_ROLE_KEY` - Service role key (from Project Settings → API)
     - `SITE_URL` - Your site URL (e.g., `https://stage.theprize.io`)

3. **Check RPC function exists:**
   ```sql
   SELECT proname, pronargs
   FROM pg_proc
   WHERE proname = 'allocate_lucky_dip_tickets_batch';
   ```
   Should return exactly 1 row with `pronargs = 7`.

4. **Check function logs for errors:**
   ```bash
   supabase functions logs lucky-dip-reserve --limit 100
   ```

### Database RPC Function Issues

If the edge function deploys but returns errors about the RPC function:

1. **Deploy database migrations:**
   ```bash
   supabase db push
   ```

2. **Verify RPC function:**
   ```sql
   SELECT 
     p.proname,
     p.pronargs,
     pg_get_function_arguments(p.oid) as args
   FROM pg_proc p
   JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public'
     AND p.proname = 'allocate_lucky_dip_tickets_batch';
   ```

   **Expected:**
   - `proname`: `allocate_lucky_dip_tickets_batch`
   - `pronargs`: `7`
   - `args`: Should include `p_user_id text, p_competition_id uuid, p_count integer, ...`

### CORS Errors

If you see CORS errors in the browser console:

1. The edge function has CORS headers built-in (lines 18-44 in `index.ts`)
2. Verify your origin is in the allowed list (lines 7-16)
3. Redeploy the function after any CORS changes

## Related Documentation

- **Edge Function Code**: `supabase/functions/lucky-dip-reserve/index.ts`
- **RPC Function**: `debug/HOTFIX_allocate_lucky_dip_tickets_batch_uuid_casting.sql`
- **Frontend Code**: `src/components/IndividualCompetition/IndividualCompetitionHeroSection.tsx` (line 152)
- **Deployment Script**: `scripts/deploy-lucky-dip-reserve.sh`
- **Issue Analysis**: `LUCKY_DIP_ISSUE_ANALYSIS.md`
- **CORS Fix**: `LUCKY_DIP_CORS_FIX.md`

## Priority

**CRITICAL** - This issue blocks all Lucky Dip ticket reservations. Users cannot purchase tickets using the Lucky Dip flow.

## Success Criteria

✅ Edge function deploys without errors
✅ CORS preflight returns 200 OK
✅ Function logs show successful reservations
✅ Frontend shows "Server-side Lucky Dip reservation successful"
✅ Users can complete Lucky Dip ticket purchases

---

**Next Steps After Deployment:**
1. Monitor function logs for errors
2. Test Lucky Dip reservations on staging
3. Verify reservations expire after 15 minutes
4. Test with various ticket counts (1, 10, 100, 500)
5. Deploy to production once staging is verified
