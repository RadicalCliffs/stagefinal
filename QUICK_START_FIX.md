# QUICK START: Deploy Fixed Lucky Dip Edge Function

## Status: READY TO DEPLOY ✅

The edge function has been **fixed** and is ready for deployment.

### What Was Fixed

✅ Module import errors resolved (inlined dependencies)
✅ Supabase-js version updated to recommended npm package
✅ All deployment blockers removed

## Deploy Now (5 Minutes)

### Step 1: Deploy Edge Function (5 min)

```bash
cd /path/to/theprize.io
./scripts/deploy-lucky-dip-reserve.sh
```

**Expected output:**
```
✓ Deployed function lucky-dip-reserve
Function URL: https://YOUR_PROJECT.supabase.co/functions/v1/lucky-dip-reserve
```

### Step 2: Verify Deployment (2 min)

```bash
./scripts/verify-lucky-dip-deployment.sh YOUR_PROJECT_REF
```

**Expected output:**
```
✓ CORS Configuration: PASSED
✓ Error Handling: PASSED
✓ ALL TESTS PASSED
```

### Step 3: Test on Frontend (3 min)

1. Go to: `https://stage.theprize.io/competition/SOME_ID`
2. Select lucky dip tickets (e.g., 10 tickets)
3. Click "Enter Now"
4. Complete CAPTCHA
5. **Check browser console**

**Before fix (BROKEN):**
```
[TicketReservation] Invoking lucky-dip-reserve edge function
... (silence)
```

**After fix (WORKING):**
```
[TicketReservation] Invoking lucky-dip-reserve edge function
[TicketReservation] Server-side Lucky Dip reservation successful ✓
```

## Need Help?

- **Detailed guide**: See `EDGE_FUNCTION_DEPLOYMENT_GUIDE.md`
- **Troubleshooting**: Same file, bottom section
- **Technical details**: See `LUCKY_DIP_RESERVE_FIX_SUMMARY.md`

## Prerequisites

If you get errors, you may need to:

```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link project
supabase link --project-ref YOUR_PROJECT_REF
```

## That's It!

Once deployed and verified, lucky dip reservations will work immediately. No other changes needed.

---

**Status**: Code is ready ✅ | Deployment pending ⏳ | ETA: 10 min ⚡
