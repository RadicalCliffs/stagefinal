# 🚨 CRITICAL: Deploy Commerce Webhook Fix

## The Problem
The commerce-webhook idempotency bug is **STILL HAPPENING IN PRODUCTION** because the fixed code has not been deployed to Supabase Edge Functions.

**Every new topup will continue to get stuck until you deploy this.**

## What Was Fixed
- [commerce-webhook/index.ts](supabase/functions/commerce-webhook/index.ts#L937-L943)
- **Old bug**: Checked `transaction.status === 'finished'` as "already credited" indicator
- **Fixed**: Only checks `posted_to_balance` and `wallet_credited` flags (our source of truth)

## Deploy Command

```bash
# 1. Make sure you're logged in to Supabase CLI
supabase login

# 2. Link to your production project (if not already linked)
supabase link --project-ref mthwfldcjvpxjtmrqkqm

# 3. Deploy the fixed webhook function
supabase functions deploy commerce-webhook

# Expected output:
# Deploying Function (project ref: mthwfldcjvpxjtmrqkqm)…
# Function commerce-webhook deployed successfully
```

## Verification

After deployment, test with a small topup ($1-2):
1. Make a new topup payment
2. Wait for Coinbase confirmation
3. Check balance updates immediately
4. Verify topup appears in dashboard
5. Check transaction has `posted_to_balance=true` in database

## Why This Matters

**Without this deployment:**
- ❌ Highblock's issue will happen to EVERY new user
- ❌ Payments will be taken but balances won't update
- ❌ You'll need to manually run recovery scripts for each stuck topup
- ❌ Users will lose trust in the platform

**After deployment:**
- ✅ Topups credit immediately and reliably
- ✅ Dashboard visibility works automatically
- ✅ No more stuck topups
- ✅ Idempotency works correctly

## Deployment Order

1. **FIRST**: `supabase functions deploy commerce-webhook` ⬅️ **DO THIS NOW**
2. **THEN**: Run `DEPLOY_50_PERCENT_BONUS_NOW.sql` (deploy updated bonus function)
3. **FINALLY**: Run `FIX_STUCK_TOPUPS.sql` (recover Highblock & Luxe)

## Finding Other Stuck Topups

If you want to check for other affected users:

```sql
-- Find all potentially stuck topups
SELECT 
  id,
  canonical_user_id,
  user_id,
  amount,
  status,
  payment_status,
  posted_to_balance,
  wallet_credited,
  created_at
FROM user_transactions
WHERE type = 'topup'
  AND payment_status = 'confirmed'
  AND posted_to_balance IS NOT TRUE
ORDER BY created_at DESC;
```

If this query returns more than just Highblock and Luxe, we need a generic recovery script.
