# 🚨 URGENT: Fix CORS and HTTP 0 Errors

## The Problem

You're seeing these errors:
```
Access to fetch has been blocked by CORS policy
Failed to fetch
HTTP 0:
```

## The Solution (2 Minutes)

### Option A: One-Line Quick Fix
```bash
./deploy-cors-fix.sh
```

### Option B: Manual Deployment
```bash
supabase functions deploy purchase-tickets-with-bonus
```

### Option C: Via Dashboard
1. Go to https://app.supabase.com/project/mthwfldcjvpxjtmrqkqm
2. Click "Edge Functions"
3. Find "purchase-tickets-with-bonus"
4. Click "Deploy New Version"
5. Upload `supabase/functions/purchase-tickets-with-bonus/index.ts`

## What's the Issue?

The CORS fix is **in the code** but **not deployed to Supabase**.

✅ Code is fixed (uses shared CORS module with HTTP 200)  
❌ Live function still has old code (returns HTTP 204)

## After Deployment

### 1. Verify Fix
```bash
./verify-cors-fix.sh
```

### 2. Test in Browser
1. Go to https://substage.theprize.io
2. Open DevTools (F12)
3. Try purchasing tickets
4. Should see NO CORS errors

### 3. If Still Errors

**Database Issue:**
If you see `column "updated_at" does not exist`:

```bash
# Run this SQL in Supabase SQL Editor:
cat supabase/HOTFIX_add_updated_at_to_sub_account_balances.sql
```

## Documentation

- **Quick Start:** This file
- **Full Deployment Guide:** [DEPLOYMENT_INSTRUCTIONS_CORS_FIX.md](./DEPLOYMENT_INSTRUCTIONS_CORS_FIX.md)
- **Troubleshooting:** [TROUBLESHOOTING_CORS_HTTP0.md](./TROUBLESHOOTING_CORS_HTTP0.md)

## Status

- ✅ Code fixed in repository
- ✅ Deployment scripts ready
- ✅ Verification scripts ready
- ⏳ **Waiting for deployment** ← YOU ARE HERE
- ⏳ Testing and verification

## Questions?

1. **Why still seeing errors?**  
   → Function not deployed yet
   
2. **How to deploy?**  
   → Run `./deploy-cors-fix.sh`
   
3. **Still not working?**  
   → Check [TROUBLESHOOTING_CORS_HTTP0.md](./TROUBLESHOOTING_CORS_HTTP0.md)
   
4. **Database errors?**  
   → Run `HOTFIX_add_updated_at_to_sub_account_balances.sql`

---

**Time to fix:** 2-5 minutes  
**Priority:** P0 - CRITICAL  
**Status:** Ready to deploy
