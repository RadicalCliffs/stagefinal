# Commerce Top-Up Testing Guide

## Overview
This guide provides step-by-step instructions for testing the Commerce top-up functionality to ensure proper classification and tracking.

## Prerequisites
- Access to the application with a test account
- Access to Supabase dashboard to inspect database records
- Test Coinbase Commerce webhook secret configured

## Test Scenarios

### Test 1: Commerce Top-Up with First Deposit Bonus ✅

**Goal**: Verify that a first-time user gets 50% bonus and transactions are properly classified

**Steps**:
1. Create a new user account or use an account that has never topped up
2. Navigate to the Wallet/Top-Up page
3. Select "Other Crypto" or "Coinbase Commerce" payment method
4. Select amount (e.g., $50)
5. Click "Top Up" button
6. Complete payment in Coinbase Commerce checkout
7. Wait for webhook to process (usually <30 seconds)

**Expected Results**:
- ✅ Top-up button doesn't load forever (should redirect to checkout)
- ✅ `user_transactions` record created with:
  - `type = 'topup'`
  - `payment_provider = 'coinbase_commerce'`
  - `status = 'completed'`
  - `payment_status = 'completed'`
- ✅ `sub_account_balances` updated with:
  - `available_balance` increased by base amount ($50)
  - `bonus_balance` increased by 50% ($25)
  - Total balance = $75
- ✅ `balance_ledger` entry created with:
  - `type = 'topup'`
  - `payment_provider = 'coinbase_commerce'`
  - `transaction_type = 'deposit'`
  - `amount = $75` (total including bonus)
- ✅ `bonus_award_audit` record created with:
  - `amount = $25`
  - `reason = 'commerce_topup'`
- ✅ `canonical_users.has_used_new_user_bonus = true`

**SQL Verification Queries**:

```sql
-- Check user_transactions record
SELECT 
  id,
  canonical_user_id,
  type,
  payment_provider,
  amount,
  status,
  payment_status,
  created_at
FROM user_transactions
WHERE canonical_user_id = 'prize:pid:0x...'  -- Replace with actual user ID
  AND type = 'topup'
ORDER BY created_at DESC
LIMIT 1;

-- Check sub_account_balances
SELECT 
  canonical_user_id,
  available_balance,
  bonus_balance,
  available_balance + bonus_balance as total_balance,
  updated_at
FROM sub_account_balances
WHERE canonical_user_id = 'prize:pid:0x...';  -- Replace with actual user ID

-- Check balance_ledger
SELECT 
  canonical_user_id,
  transaction_type,
  amount,
  type,
  payment_provider,
  description,
  created_at
FROM balance_ledger
WHERE canonical_user_id = 'prize:pid:0x...'  -- Replace with actual user ID
  AND type = 'topup'
ORDER BY created_at DESC
LIMIT 1;

-- Check bonus award
SELECT 
  canonical_user_id,
  amount,
  reason,
  note,
  created_at
FROM bonus_award_audit
WHERE canonical_user_id = 'prize:pid:0x...'  -- Replace with actual user ID
  AND reason = 'commerce_topup'
ORDER BY created_at DESC
LIMIT 1;

-- Check bonus flag
SELECT 
  canonical_user_id,
  has_used_new_user_bonus,
  updated_at
FROM canonical_users
WHERE canonical_user_id = 'prize:pid:0x...';  -- Replace with actual user ID
```

---

### Test 2: Commerce Top-Up for Existing User (No Bonus) ✅

**Goal**: Verify that existing users don't get bonus but transactions are still properly classified

**Steps**:
1. Use an account that has already received first-deposit bonus
2. Navigate to the Wallet/Top-Up page
3. Select "Other Crypto" or "Coinbase Commerce" payment method
4. Select amount (e.g., $100)
5. Click "Top Up" button
6. Complete payment in Coinbase Commerce checkout
7. Wait for webhook to process

**Expected Results**:
- ✅ `user_transactions` record created with correct classification
- ✅ `sub_account_balances` updated:
  - `available_balance` increased by $100
  - `bonus_balance` unchanged
- ✅ `balance_ledger` entry created with correct type and provider
- ✅ NO new `bonus_award_audit` record created

---

### Test 3: Verify Both Provider Names Work ✅

**Goal**: Ensure both 'coinbase_commerce' and 'cdp_commerce' are recognized

**Steps**:
1. Check environment variable configuration supports both:
   - `COINBASE_COMMERCE_WEBHOOK_SECRET`
   - `CDP_COMMERCE_WEBHOOK_SECRET`
2. Verify webhook accepts both secret names
3. Test top-up flow works with either configuration

**Expected Results**:
- ✅ Webhook authenticates with either secret name
- ✅ Transactions classified correctly regardless of provider name used

---

### Test 4: Dashboard Display ✅

**Goal**: Verify top-ups show correctly in dashboard

**Steps**:
1. After completing a commerce top-up
2. Navigate to User Dashboard
3. Check "Transactions" or "Wallet History" section

**Expected Results**:
- ✅ Transaction appears in list
- ✅ Shows correct amount
- ✅ Shows payment provider as "coinbase_commerce" or "cdp_commerce"
- ✅ Shows correct status ("completed")
- ✅ Timestamp is accurate

---

### Test 5: Trigger Skip List ✅

**Goal**: Verify triggers don't double-credit commerce payments

**Steps**:
1. Complete a commerce top-up
2. Check that balance was credited only once
3. Verify `posted_to_balance = true` in user_transactions
4. Confirm no duplicate balance_ledger entries

**Expected Results**:
- ✅ Balance credited exactly once by webhook
- ✅ Trigger marked transaction as posted without modifying balance
- ✅ No duplicate entries in balance_ledger
- ✅ `posted_to_balance = true` in user_transactions

**SQL Verification**:
```sql
-- Check for duplicate credits (should be only 1 row)
SELECT 
  canonical_user_id,
  COUNT(*) as credit_count
FROM balance_ledger
WHERE reference_id = 'charge_xxx'  -- Replace with actual charge ID
GROUP BY canonical_user_id
HAVING COUNT(*) > 1;

-- Should return no rows (no duplicates)
```

---

## Troubleshooting

### Issue: Top-up button loads forever

**Possible Causes**:
1. Create-charge API endpoint not responding
2. Missing environment variables
3. Network connectivity issues

**Debug Steps**:
1. Check browser console for errors
2. Check Netlify function logs for create-charge-proxy
3. Check Supabase Edge Function logs for create-charge
4. Verify `COINBASE_COMMERCE_API_KEY` is set

---

### Issue: Balance not credited

**Possible Causes**:
1. Webhook not received
2. Webhook secret mismatch
3. Transaction not marked as completed

**Debug Steps**:
1. Check `payment_webhook_events` table for received webhook
2. Verify webhook signature validation passed
3. Check `user_transactions` status
4. Review commerce-webhook function logs

```sql
-- Check webhook events
SELECT 
  id,
  provider,
  event_type,
  status,
  signature_valid,
  created_at
FROM payment_webhook_events
WHERE event_id LIKE 'charge_%'  -- Coinbase Commerce charge ID
ORDER BY created_at DESC
LIMIT 5;
```

---

### Issue: Wrong payment_provider or type

**Possible Causes**:
1. Migration not applied
2. Webhook code not deployed
3. RPC function not updated

**Debug Steps**:
1. Check latest migrations are applied
2. Verify Edge Function deployment
3. Run migration verification queries

```sql
-- Check if cdp_commerce is in trigger skip list
SELECT routine_name, routine_definition 
FROM information_schema.routines 
WHERE routine_name = 'post_user_transaction_to_balance'
AND routine_definition LIKE '%cdp_commerce%';

-- Check if RPC function has payment provider logic
SELECT routine_name, routine_definition 
FROM information_schema.routines 
WHERE routine_name = 'credit_balance_with_first_deposit_bonus'
AND routine_definition LIKE '%commerce_topup%';
```

---

## Success Criteria

All tests must pass with the following criteria:

1. ✅ Top-up button redirects to checkout (doesn't load forever)
2. ✅ `type = 'topup'` set in user_transactions
3. ✅ `payment_provider` set to 'coinbase_commerce' or 'cdp_commerce'
4. ✅ Balance credited correctly (once, with bonus if applicable)
5. ✅ balance_ledger entries have correct type and payment_provider
6. ✅ No double-crediting from triggers
7. ✅ Dashboard displays transactions correctly
8. ✅ Both provider names ('coinbase_commerce' and 'cdp_commerce') work

---

## Regression Testing

After any changes to commerce payment flow, verify:

1. ✅ Existing top-ups still show in dashboard
2. ✅ Historical balance_ledger entries still query correctly
3. ✅ Bonus logic still works for new users
4. ✅ No impact on other payment methods (balance, onramp, etc.)

---

## Notes

- Commerce webhooks are asynchronous - allow up to 30 seconds for processing
- Signature validation is required in production (optional in dev)
- Both 'coinbase_commerce' and 'cdp_commerce' are whitelisted providers
- Triggers are designed to skip commerce payments to avoid double-crediting
