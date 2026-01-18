# Payment Architecture Diagnostic Guide

## Executive Summary

This document details the complete payment architecture for theprize.io and identifies why test payments may go through successfully but not reflect in Coinbase Commerce or Supabase.

**Last Updated:** January 18, 2026

---

## 🏗️ Complete Payment Architecture

### Entry Purchases (Ticket Purchases)

#### Flow Diagram
```
User selects tickets
    ↓
Client: coinbase-commerce.ts - createEntryPurchase()
    ↓
Netlify Proxy: /api/create-charge-proxy
    ↓
Supabase Edge Function: create-charge
    ↓
[CREATES RECORDS IN SUPABASE]
├─ user_transactions (status: pending)
└─ pending_tickets (status: pending)
    ↓
Coinbase Commerce API: Create dynamic charge
    ↓
[UPDATES SUPABASE]
└─ user_transactions (tx_id: charge.id, session_id: charge.code)
    ↓
User completes payment in Coinbase widget
    ↓
[WEBHOOK SHOULD FIRE] ⚠️
Coinbase Commerce → Webhook: commerce-webhook
    ↓
[UPDATES SUPABASE]
├─ user_transactions (status: finished)
├─ pending_tickets (status: confirmed)
└─ Calls: confirm-pending-tickets function
    ↓
[CREATES FINAL RECORDS]
├─ tickets (individual ticket records)
├─ joincompetition (entry record)
└─ notifications (user notification)
```

#### Critical Checkpoints
1. ✅ **User initiates purchase** → Creates `user_transactions` (pending)
2. ✅ **Coinbase charge created** → Updates `user_transactions` with `tx_id`
3. ⚠️ **User completes payment** → Webhook MUST fire to Supabase
4. ⚠️ **Webhook processes** → Updates records and confirms tickets
5. ✅ **Tickets allocated** → Final records in `tickets` and `joincompetition`

---

### Top-Ups (Wallet Funding)

#### Flow Diagram
```
User selects amount
    ↓
Client: coinbase-commerce.ts - createTopUpTransaction()
    ↓
Netlify Proxy: /api/create-charge-proxy
    ↓
Supabase Edge Function: create-charge
    ↓
[CREATES RECORDS IN SUPABASE]
├─ user_transactions (status: pending, competition_id: null)
└─ pending_topups (status: pending) [OPTIMISTIC CREDIT]
    ↓
Coinbase Commerce API: Create dynamic charge
    ↓
[UPDATES SUPABASE]
└─ user_transactions (tx_id: charge.id)
    ↓
User completes payment
    ↓
[WEBHOOK SHOULD FIRE] ⚠️
Coinbase Commerce → Webhook: commerce-webhook
    ↓
[UPDATES SUPABASE - RETRY LOGIC]
├─ Attempt 1: credit_sub_account_balance RPC
├─ Attempt 2: credit_sub_account_balance RPC (retry)
├─ Attempt 3: credit_sub_account_balance RPC (retry)
└─ Fallback: Direct table update on sub_account_balances
    ↓
[FINAL STATE]
├─ sub_account_balances (available_balance += amount)
├─ pending_topups (status: confirmed)
└─ user_transactions (status: completed, wallet_credited: true)
```

#### Critical Checkpoints
1. ✅ **User initiates top-up** → Creates `user_transactions` (pending)
2. ✅ **Optimistic credit** → Creates `pending_topups` (shows pending in UI)
3. ⚠️ **User completes payment** → Webhook MUST fire
4. ⚠️ **Webhook credits balance** → Updates `sub_account_balances`
5. ✅ **Balance confirmed** → `pending_balance` → `available_balance`

---

## 🚨 Why Test Payments Aren't Being Reflected

### Root Cause Analysis

Based on the code architecture, there are **5 primary failure points** where payments can succeed but not reflect:

### 1. ⚠️ **Webhook Not Configured in Coinbase Commerce** (MOST LIKELY)

**Problem:** Coinbase Commerce doesn't know where to send webhook notifications.

**Symptoms:**
- Payment completes successfully in Coinbase widget ✅
- User sees "Payment successful" ✅
- Records remain in `pending` state in Supabase ❌
- `user_transactions.status = "pending"` or `"waiting"` ❌
- `pending_tickets.status = "pending"` ❌
- No records in `tickets` or `joincompetition` ❌
- Balance not credited (top-ups) ❌

**How to Check:**
1. Log into Coinbase Commerce dashboard
2. Navigate to **Settings → Webhooks**
3. Verify webhook URL is configured:
   ```
   https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/commerce-webhook
   ```
4. Check that webhook secret is set in Supabase Edge Functions environment

**Fix:**
```bash
# In Coinbase Commerce Dashboard:
# Settings → Webhooks → Add endpoint
# URL: https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/commerce-webhook
# Events: Select all (especially charge:confirmed)
# Save webhook secret and add to Supabase secrets

# In Supabase Dashboard:
# Edge Functions → Secrets
# Add: COINBASE_COMMERCE_WEBHOOK_SECRET=<your_webhook_secret>
```

**Evidence in Logs:**
- No webhook events logged in `payment_webhook_events` table
- No `[commerce-webhook]` log entries in Supabase Edge Function logs

---

### 2. ⚠️ **Webhook Signature Verification Failing**

**Problem:** Webhook is being sent but signature verification fails, so events are rejected.

**Symptoms:**
- Webhook attempts appear in Coinbase Commerce dashboard ✅
- But show as "Failed" or "Invalid signature" ❌
- `payment_webhook_events` table may have failed entries ❌

**How to Check:**
```sql
-- Check for failed webhook events
SELECT * FROM payment_webhook_events 
WHERE provider = 'coinbase_commerce' 
ORDER BY created_at DESC 
LIMIT 10;
```

**Check Supabase Logs:**
```
Search for: "Invalid webhook signature" or "Signature verification error"
```

**Fix:**
1. Verify webhook secret matches between:
   - Coinbase Commerce Dashboard (Settings → Webhooks)
   - Supabase Edge Function environment variable: `COINBASE_COMMERCE_WEBHOOK_SECRET`
2. Ensure secret is NOT base64 encoded (should be raw hex string)

---

### 3. ⚠️ **User ID Mismatch Between Systems**

**Problem:** Charge metadata contains different user ID format than what's stored in Supabase.

**Symptoms:**
- Webhook fires successfully ✅
- `user_transactions` record updated ✅
- But `confirm-pending-tickets` fails to find reservation ❌
- Logs show: "Transaction not found" or "Reservation not found" ❌

**How to Check:**
```sql
-- Check for mismatched user IDs
SELECT 
  ut.id,
  ut.user_id as transaction_user_id,
  pt.user_id as pending_user_id,
  pt.status,
  ut.status as txn_status
FROM user_transactions ut
LEFT JOIN pending_tickets pt ON pt.session_id = ut.id
WHERE ut.payment_provider = 'coinbase'
  AND ut.status IN ('finished', 'completed')
  AND (pt.id IS NULL OR pt.status != 'confirmed')
ORDER BY ut.created_at DESC
LIMIT 20;
```

**Root Cause:**
The code uses canonical user ID format (`prize:pid:0x...`) but if metadata sent to Coinbase has raw wallet address (`0x...`), the lookup fails.

**Fix:** Already implemented in `create-charge` function (line 212-213):
```typescript
const canonicalUserId = toPrizePid(userId);
// Metadata includes both canonical ID and wallet address
```

**Verify Fix:**
Check that charges have both `user_id` (canonical) and `wallet_address` (raw) in metadata:
```javascript
metadata: {
  user_id: canonicalUserId,        // prize:pid:0x...
  wallet_address: walletAddress,   // 0x...
  // ...
}
```

---

### 4. ⚠️ **Smart Wallet Address Not Resolved**

**Problem:** User pays with a smart wallet (sub-account), but parent wallet address isn't found.

**Symptoms:**
- Payment succeeds ✅
- Webhook processes ✅
- But tickets/balance assigned to wrong user ❌
- Or lookup fails completely ❌

**How to Check:**
```sql
-- Check for smart wallet addresses that aren't mapped
SELECT DISTINCT wallet_address
FROM user_transactions
WHERE payment_provider = 'coinbase_commerce'
  AND created_at > NOW() - INTERVAL '7 days'
  AND wallet_address NOT IN (
    SELECT wallet_address FROM canonical_users
    UNION
    SELECT smart_wallet_address FROM canonical_users WHERE smart_wallet_address IS NOT NULL
  );
```

**Fix:** Already implemented in `commerce-webhook` (lines 174-209):
```typescript
// Check if this is a smart contract wallet and resolve to parent wallet
if (walletAddress && supabaseUrl && supabaseServiceKey) {
  const smartWalletLookup = await fetch(
    `${supabaseUrl}/rest/v1/canonical_users?smart_wallet_address=eq.${walletAddress}...`
  );
  // Resolves smart wallet → parent wallet
}
```

**Verify in Database:**
```sql
-- Ensure smart wallet mappings exist
SELECT 
  canonical_user_id,
  wallet_address,
  smart_wallet_address
FROM canonical_users
WHERE smart_wallet_address IS NOT NULL;
```

---

### 5. ⚠️ **Confirm-Pending-Tickets Function Failing**

**Problem:** Webhook processes successfully, but ticket allocation fails.

**Symptoms:**
- `user_transactions.status = "needs_reconciliation"` ⚠️
- `pending_tickets.status = "confirmed"` ✅
- But NO records in `tickets` table ❌
- NO records in `joincompetition` table ❌

**How to Check:**
```sql
-- Find transactions needing reconciliation
SELECT 
  ut.id,
  ut.user_id,
  ut.competition_id,
  ut.ticket_count,
  ut.status,
  ut.payment_status,
  pt.status as pending_status
FROM user_transactions ut
LEFT JOIN pending_tickets pt ON pt.session_id = ut.id
WHERE ut.status = 'needs_reconciliation'
ORDER BY ut.created_at DESC;
```

**Common Causes:**
- Competition sold out (not enough tickets available)
- RPC function timeout
- Database constraint violation (duplicate tickets)
- Network timeout between Edge Functions

**Fix:** Check Supabase Edge Function logs:
```
Search for: "[Confirm Tickets]" and errors
Look for: "assignTickets: competition is sold out"
Look for: "RPC error:"
```

---

## 🔍 Diagnostic Checklist

Use this checklist to diagnose why test payments aren't reflected:

### Step 1: Verify Coinbase Commerce Configuration

- [ ] **Webhook URL configured in Coinbase Commerce Dashboard**
  - URL: `https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/commerce-webhook`
  - Events: `charge:confirmed`, `charge:failed`, `charge:pending`, `charge:delayed`
  
- [ ] **Webhook secret configured in Supabase**
  ```bash
  # Check in Supabase Dashboard → Edge Functions → Secrets
  COINBASE_COMMERCE_WEBHOOK_SECRET=<your_secret>
  COINBASE_COMMERCE_API_KEY=<your_api_key>
  ```

- [ ] **Webhook is active and not paused**

### Step 2: Check Supabase Records

Run these SQL queries:

```sql
-- 1. Check recent transactions
SELECT 
  id,
  user_id,
  competition_id,
  amount,
  status,
  payment_status,
  tx_id,
  created_at,
  completed_at
FROM user_transactions
WHERE created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 20;

-- 2. Check pending tickets
SELECT 
  id,
  user_id,
  competition_id,
  status,
  ticket_numbers,
  session_id,
  created_at,
  confirmed_at
FROM pending_tickets
WHERE created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 20;

-- 3. Check webhook events
SELECT 
  id,
  provider,
  status,
  payload,
  created_at
FROM payment_webhook_events
WHERE provider = 'coinbase_commerce'
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 20;

-- 4. Check confirmed entries (tickets)
SELECT 
  t.id,
  t.user_id,
  t.competition_id,
  t.ticket_number,
  t.order_id,
  t.created_at
FROM tickets t
WHERE t.created_at > NOW() - INTERVAL '24 hours'
ORDER BY t.created_at DESC
LIMIT 20;

-- 5. Check user balances (for top-ups)
SELECT 
  canonical_user_id,
  available_balance,
  pending_balance,
  currency,
  last_updated
FROM sub_account_balances
WHERE last_updated > NOW() - INTERVAL '24 hours'
ORDER BY last_updated DESC
LIMIT 20;
```

### Step 3: Check Supabase Edge Function Logs

1. Go to **Supabase Dashboard → Edge Functions → Logs**
2. Filter by function: `commerce-webhook`
3. Look for recent webhook invocations
4. Check for errors:
   - "Invalid signature"
   - "Transaction not found"
   - "Reservation not found"
   - "RPC error"
   - "needs_reconciliation"

### Step 4: Test Webhook Manually

If payments complete but no webhook logs appear:

```bash
# Test if webhook endpoint is accessible
curl -X POST https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/commerce-webhook \
  -H "Content-Type: application/json" \
  -H "X-CC-Webhook-Signature: test" \
  -d '{"event": {"type": "charge:pending"}}'

# Expected: Should return 200 or 401 (signature verification)
# Should NOT return 404 or 500
```

---

## 🛠️ Common Fixes

### Fix 1: Webhook Not Configured (MOST COMMON)

**Symptoms:** Payments complete, but nothing happens in Supabase.

**Solution:**
1. Log into Coinbase Commerce: https://commerce.coinbase.com
2. Go to **Settings → Webhooks**
3. Click **"Add endpoint"**
4. Enter webhook URL:
   ```
   https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/commerce-webhook
   ```
5. Select events:
   - `charge:confirmed` (CRITICAL)
   - `charge:failed`
   - `charge:pending`
   - `charge:delayed`
   - `charge:resolved`
6. Save and copy webhook secret
7. Add secret to Supabase:
   - Dashboard → Edge Functions → Secrets
   - Key: `COINBASE_COMMERCE_WEBHOOK_SECRET`
   - Value: (paste webhook secret)
8. Test with a small payment

---

### Fix 2: Reconcile Pending Payments

If you have payments that completed but aren't reflected, run manual reconciliation:

```sql
-- Find all completed payments that need reconciliation
SELECT 
  ut.id as transaction_id,
  ut.user_id,
  ut.competition_id,
  ut.amount,
  ut.tx_id as coinbase_charge_id,
  pt.id as pending_ticket_id,
  pt.ticket_numbers
FROM user_transactions ut
LEFT JOIN pending_tickets pt ON pt.session_id = ut.id
WHERE ut.payment_provider = 'coinbase'
  AND ut.status IN ('finished', 'completed')
  AND ut.created_at > NOW() - INTERVAL '7 days'
  AND (
    -- Entry purchases not confirmed
    (ut.competition_id IS NOT NULL AND pt.status != 'confirmed')
    OR
    -- Top-ups not credited
    (ut.competition_id IS NULL AND ut.wallet_credited != true)
  );
```

For each record, manually call `confirm-pending-tickets`:

```bash
curl -X POST https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/confirm-pending-tickets \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>" \
  -d '{
    "reservationId": "<pending_ticket_id>",
    "transactionHash": "<coinbase_charge_id>",
    "paymentProvider": "coinbase_commerce"
  }'
```

---

### Fix 3: Enable Debug Logging

Add temporary debug logging to track webhook flow:

```sql
-- Check if webhook events are being logged
SELECT COUNT(*) as webhook_event_count
FROM payment_webhook_events
WHERE provider = 'coinbase_commerce'
  AND created_at > NOW() - INTERVAL '24 hours';

-- If 0, webhook is NOT reaching Supabase
-- If >0, webhook is reaching Supabase, check logs for errors
```

---

## 📊 Monitoring Queries

### Daily Health Check

```sql
-- Payments completed vs tickets confirmed (last 24h)
SELECT 
  'Completed Payments' as metric,
  COUNT(*) as count
FROM user_transactions
WHERE status IN ('finished', 'completed')
  AND created_at > NOW() - INTERVAL '24 hours'

UNION ALL

SELECT 
  'Confirmed Entries' as metric,
  COUNT(*) as count
FROM joincompetition
WHERE purchasedate > NOW() - INTERVAL '24 hours'

UNION ALL

SELECT 
  'Webhook Events' as metric,
  COUNT(*) as count
FROM payment_webhook_events
WHERE provider = 'coinbase_commerce'
  AND created_at > NOW() - INTERVAL '24 hours';
```

### Stuck Payments Report

```sql
-- Find payments stuck in pending/processing for >30 minutes
SELECT 
  ut.id,
  ut.user_id,
  ut.competition_id,
  ut.amount,
  ut.status,
  ut.payment_status,
  ut.created_at,
  EXTRACT(EPOCH FROM (NOW() - ut.created_at))/60 as minutes_stuck
FROM user_transactions ut
WHERE ut.status IN ('pending', 'processing', 'waiting')
  AND ut.created_at < NOW() - INTERVAL '30 minutes'
  AND ut.created_at > NOW() - INTERVAL '24 hours'
ORDER BY ut.created_at DESC;
```

---

## 🔧 Recommended Actions

### Immediate Actions (Do Now)

1. **Verify Webhook Configuration**
   - [ ] Check Coinbase Commerce webhook is configured
   - [ ] Verify webhook secret is set in Supabase
   - [ ] Test webhook endpoint is accessible

2. **Check Recent Test Payments**
   - [ ] Run diagnostic SQL queries above
   - [ ] Check Supabase Edge Function logs
   - [ ] Identify stuck transactions

3. **Manual Reconciliation**
   - [ ] For stuck entry purchases: Call `confirm-pending-tickets`
   - [ ] For stuck top-ups: Manually credit `sub_account_balances`

### Short-term Improvements (This Week)

1. **Add Webhook Monitoring**
   - Create alert if no webhooks received in 1 hour during business hours
   - Add webhook health dashboard

2. **Implement Auto-Reconciliation**
   - Scheduled job to find stuck payments
   - Automatic retry for `needs_reconciliation` status

3. **Enhanced Logging**
   - Log every webhook attempt (even failures)
   - Add correlation ID between charge and confirmation

### Long-term Improvements (This Month)

1. **Payment Status Dashboard**
   - Real-time view of payment pipeline health
   - Stuck payment alerts

2. **Automated Testing**
   - End-to-end payment flow tests
   - Webhook delivery verification

3. **Fallback Payment Verification**
   - Poll Coinbase Commerce API for charge status
   - Don't rely solely on webhooks

---

## 📝 Summary

**Most Likely Issue:** Webhook not configured or webhook secret mismatch

**Quick Fix:**
1. Configure webhook URL in Coinbase Commerce Dashboard
2. Set webhook secret in Supabase Edge Functions environment
3. Test with a small payment

**Verification:**
- Check `payment_webhook_events` table has recent entries
- Check `user_transactions` status changes from `pending` → `finished`
- Check `tickets` and `joincompetition` tables have new entries

**Still Not Working?**
- Check Supabase Edge Function logs for errors
- Run diagnostic SQL queries
- Contact support with transaction IDs for investigation

---

## 🆘 Support

If issues persist after following this guide:

1. Collect diagnostic data:
   - Transaction ID(s) from `user_transactions`
   - Coinbase charge ID(s)
   - Supabase Edge Function logs (last 100 lines)
   - Result of diagnostic SQL queries

2. Check GitHub Issues for similar problems
3. Contact development team with collected data

**Last Updated:** January 18, 2026
