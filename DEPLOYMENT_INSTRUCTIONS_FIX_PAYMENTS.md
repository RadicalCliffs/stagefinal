# Deployment Instructions: Fix Balance Payments and Top-Ups

## Problem Summary
1. **Balance Payments Broken**: Edge function `purchase-tickets-with-bonus` returns "Failed to fetch" error
2. **Top-Ups Not Working**: Onramp webhook not crediting balances

## Root Cause
The required RPC functions (`debit_sub_account_balance` and `credit_sub_account_balance`) are missing from the production database or have incorrect signatures.

## Solution

### Step 1: Apply Database Migration

The migration `20260201004000_restore_production_balance_functions.sql` restores the production versions of the balance functions.

**From your project root**, run:

```bash
# Option A: If using Supabase CLI locally
supabase db push

# Option B: If using remote deployment
# 1. Login to Supabase Dashboard
# 2. Go to SQL Editor
# 3. Copy and paste the contents of:
#    supabase/migrations/20260201004000_restore_production_balance_functions.sql
# 4. Click "Run"
```

### Step 2: Verify Functions Exist

Run this query in Supabase SQL Editor to verify the functions exist:

```sql
SELECT 
  routine_name, 
  routine_type,
  data_type
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND routine_name IN ('debit_sub_account_balance', 'credit_sub_account_balance')
ORDER BY routine_name;
```

You should see 2 rows returned (one for each function).

### Step 3: Test the Functions

Test credit function:
```sql
-- This should create a new balance record or update existing
SELECT * FROM credit_sub_account_balance(
  'prize:pid:0xtest123',  -- Test canonical user ID
  10.00,                   -- Amount to credit
  'USD'                    -- Currency
);

-- Should return success=true
```

Test debit function:
```sql
-- This should debit from the balance we just credited
SELECT * FROM debit_sub_account_balance(
  'prize:pid:0xtest123',  -- Same test canonical user ID
  5.00,                    -- Amount to debit
  'USD'                    -- Currency
);

-- Should return success=true, new_balance=5.00
```

### Step 4: Deploy Edge Function (if needed)

If the edge function isn't already deployed, deploy it:

```bash
# Deploy the purchase-tickets-with-bonus function
supabase functions deploy purchase-tickets-with-bonus

# Deploy the onramp-webhook function (for top-ups)
supabase functions deploy onramp-webhook
```

### Step 5: Test End-to-End

1. **Test Balance Payment**:
   - Ensure user has balance in their account
   - Try purchasing tickets with balance
   - Should complete successfully

2. **Test Top-Up**:
   - Initiate a top-up transaction via onramp
   - Webhook should credit balance
   - Check balance is updated in UI

## What This Migration Does

The migration:
1. **Drops** old versions of `credit_sub_account_balance` and `debit_sub_account_balance`
2. **Creates** production versions with proper signatures:
   - `credit_sub_account_balance(p_canonical_user_id, p_amount, p_currency, p_reference_id, p_description)`
   - `debit_sub_account_balance(p_canonical_user_id, p_amount, p_currency, p_reference_id, p_description)`
3. **Both functions**:
   - Handle wallet address normalization (prize:pid:0x... format)
   - Use row locking (`FOR UPDATE`) to prevent race conditions
   - Create audit trail in `balance_ledger` table
   - Return structured results with success/error messages
   - Are secured to `service_role` only

## Verification Checklist

- [ ] Migration applied successfully
- [ ] Both RPC functions exist in database
- [ ] Test credit function works
- [ ] Test debit function works
- [ ] Edge functions deployed
- [ ] Balance payment works in UI
- [ ] Top-up works and credits balance
- [ ] Balance updates reflect in real-time

## Troubleshooting

### "Failed to fetch" error persists
- Check that edge function is deployed: `supabase functions list`
- Check edge function logs: `supabase functions logs purchase-tickets-with-bonus`
- Verify SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are set

### "Function not found" error
- Migration wasn't applied - go back to Step 1
- Check if functions exist - run Step 2 verification query

### "Insufficient balance" error
- User actually doesn't have enough balance
- Check `sub_account_balances` table: 
  ```sql
  SELECT * FROM sub_account_balances 
  WHERE canonical_user_id = 'prize:pid:0x...'
  ```

## Next Steps

After deployment:
1. Monitor error logs for any issues
2. Verify balance payments are working
3. Verify top-ups are crediting correctly
4. Check that balance_ledger has proper audit trail
