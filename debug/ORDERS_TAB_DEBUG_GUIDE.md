# DEBUGGING: Orders Tab Empty

## What to Check

### Step 1: Open Browser Console
Open the User Dashboard → Orders tab and check the browser console (F12).

You should see these logs:
```
[getUserTransactions] Calling RPC with user_identifier: prize:pid:0x...
[getUserTransactions] RPC response: { dataLength: X, hasError: false, ... }
[getUserTransactions] Processing data: { rawDataLength: X, firstItem: {...} }
[getUserTransactions] Formatted transactions: { count: X, firstFormatted: {...} }
```

### Step 2: Check What's Happening

**If you see `dataLength: 0` or `rawDataLength: 0`:**
- RPC returned empty array
- This means NO data in database OR wrong user_identifier
- **Fix:** Check database directly (see Step 3)

**If you see `hasError: true`:**
- RPC call failed
- Check `errorCode` and `errorMessage` in the logs
- **Fix:** Depends on error (see Step 4)

**If you see data but still empty in UI:**
- Frontend is filtering it out
- Check OrdersList.tsx filtering logic
- **Fix:** Check what filters are applied

### Step 3: Check Database Directly

Run this in Supabase SQL Editor:

```sql
-- Check if you have any transactions
SELECT 
  id,
  user_id,
  canonical_user_id,
  competition_id,
  amount,
  currency,
  status,
  payment_status,
  created_at,
  type
FROM user_transactions
WHERE canonical_user_id = 'YOUR_CANONICAL_USER_ID'
   OR user_id = 'YOUR_CANONICAL_USER_ID'
ORDER BY created_at DESC
LIMIT 10;
```

**If this returns rows:**
- Data exists, RPC might not be finding it
- **Fix:** Check RPC parameter matching

**If this returns nothing:**
- No transactions recorded
- Purchases might be going to a different table
- **Fix:** Check where purchase data is actually stored

### Step 4: Test RPC Directly

Run this in Supabase SQL Editor:

```sql
-- Test the RPC with your user ID
SELECT * FROM get_user_transactions('YOUR_CANONICAL_USER_ID');
```

Replace `YOUR_CANONICAL_USER_ID` with your actual ID (starts with `prize:pid:0x...`)

**Expected result:** Array of transactions with:
- `id`, `type`, `amount`, `currency`, `status`
- `competition_id`, `ticket_count`, `created_at`
- `competition_name`, `competition_image` (from JOIN)
- `payment_method`, `payment_provider`, `tx_id`

**If empty:**
- RPC has logic issue OR data doesn't match
- Check the WHERE clause in the RPC

**If returns data:**
- RPC works! Frontend just isn't calling it correctly
- Check the logs from Step 1

### Step 5: Common Issues

**Issue: RPC parameter name mismatch**
- Frontend calls: `user_identifier`
- RPC expects: `p_user_identifier` (with p_ prefix)
- **Status:** FIXED in latest code

**Issue: canonical_user_id format**
- Frontend sends: `prize:pid:0xABC...`
- Database has: `0xABC...` (without prefix)
- **Fix:** Check toPrizePid() conversion

**Issue: Data in wrong table**
- Looking in: `user_transactions`
- Data actually in: `joincompetition` or `orders` or `tickets`
- **Fix:** Check which table has your purchase data

### Step 6: What Data Should Exist

After you bought tickets with sub_account_balance, you should see:

**In `user_transactions` table:**
```sql
type: 'entry' or 'purchase'
competition_id: <uuid>
amount: <amount you paid>
status: 'completed' or 'finished'
canonical_user_id: 'prize:pid:0x...'
```

**In `sub_account_balances` table:**
```sql
available_balance: <your balance after deduction>
```

**In `balance_ledger` table:**
```sql
transaction_type: 'debit'
amount: <amount deducted>
balance_after: <new balance>
```

### Step 7: Force Refresh

If data exists but UI shows empty:
1. Clear browser cache
2. Hard refresh (Ctrl+Shift+R)
3. Re-login
4. Check if data appears

### Step 8: Report Back

Include in your report:
1. Console logs from Step 1
2. SQL query results from Step 3
3. RPC test results from Step 4
4. What table actually has your purchase data
5. Your canonical_user_id format

This will help me pinpoint the EXACT issue.
