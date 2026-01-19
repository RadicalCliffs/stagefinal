# Complete Migration Guide - Fix Competition Functionality

This document provides instructions for applying all migrations to fix the competition functionality issues.

## Overview

This migration set fixes the following issues:
1. ✅ End-to-end competition flow with entries displaying on live competition pages
2. ✅ Login/payment flows with all variations working
3. ✅ Dashboard fully populating with ORDERS, ENTRIES, and ACCOUNT info
4. ✅ VRF working properly for winner selection
5. ✅ Finished competition page with correct data (end date, VRF table, entries, notifications)
6. ✅ 50% balance bonus on first deposit

## Migration Files

### 1. Comprehensive Final Migration
**File:** `supabase/migrations/20260119000000_comprehensive_final_migration.sql`

This migration includes:
- All critical columns (uid, end_date, has_used_new_user_bonus, VRF columns)
- All performance indexes for optimal queries
- Core RPC functions:
  - `get_competition_entries_bypass_rls()` - Get all entries for a competition
  - `get_unavailable_tickets()` - Get sold/reserved ticket numbers
  - `get_competition_ticket_availability_text()` - Get ticket availability
  - `get_user_balance()` - Get user balance with bonus tracking
  - `get_user_transactions()` - Get user transaction history for dashboard

### 2. First Deposit Bonus Migration
**File:** `supabase/migrations/20260119100000_implement_first_deposit_bonus.sql`

This migration implements the 50% first deposit bonus:
- `credit_balance_with_first_deposit_bonus()` - Apply bonus on first topup
- `credit_sub_account_with_bonus()` - Sub-account compatible version
- `check_first_deposit_bonus_eligibility()` - Check if user eligible for bonus

### 3. Alternative Quick Fix (Optional)
**File:** `supabase/APPLY_TO_SUPABASE_NOW.sql`

This is a consolidated quick-fix file that addresses:
- Ticket availability showing 0 when all tickets available
- Entries not showing in competition pages
- HTTP 300 errors from multiple function overloads

## Application Instructions

### Step 1: Apply Comprehensive Final Migration

1. Go to **Supabase Dashboard** → **SQL Editor**
2. Create a new query
3. Copy the entire contents of `supabase/migrations/20260119000000_comprehensive_final_migration.sql`
4. Paste into the SQL Editor
5. Click **Run**
6. Verify the output shows:
   ```
   Critical RPC Functions: 5 (expected: 5)
   Critical Indexes: >= 5 (expected: >= 5)
   Critical Columns: 4 (expected: 4)
   Status: ✓ ALL CHECKS PASSED
   ```

### Step 2: Apply First Deposit Bonus Migration

1. In **Supabase Dashboard** → **SQL Editor**
2. Create a new query
3. Copy the entire contents of `supabase/migrations/20260119100000_implement_first_deposit_bonus.sql`
4. Paste into the SQL Editor
5. Click **Run**
6. Verify the output shows:
   ```
   Functions created: 3 (expected: 3)
   Status: ✓ ALL BONUS FUNCTIONS CREATED
   ```

### Step 3: Deploy Netlify Functions (if needed)

The following Netlify functions have been updated to support the bonus system:
- `netlify/functions/user-balance.mts` - Now applies bonus on topups
- `netlify/functions/instant-topup.mts` - Now applies bonus on wallet transfers

**To deploy:**
1. Commit the changes: `git push origin copilot/fix-comp-functionality`
2. Netlify will automatically deploy the updated functions

## Verification

### Test Competition Entries Display

1. Navigate to any live competition page
2. Purchase tickets (or use existing purchases)
3. Verify entries appear in the entries table on the competition page
4. Check that ticket numbers display correctly

### Test Dashboard

1. Log in to the application
2. Go to Dashboard
3. **ENTRIES Tab:** Verify all competition entries show with correct data
4. **ORDERS Tab:** Verify all purchases and top-ups show with amounts and dates
5. **ACCOUNT Tab:** Verify profile information displays and can be updated

### Test VRF on Finished Competitions

1. Navigate to a finished competition page
2. Verify the following display correctly:
   - Competition end date
   - VRF seed (random number)
   - VRF transaction hash (link to BaseScan)
   - Winning ticket calculation formula: `(VRF_SEED % tickets_sold) + 1`
   - Winner address

### Test 50% First Deposit Bonus

1. Create a new test user account
2. Top up wallet with $10 (any amount)
3. Verify you receive $15 total balance ($10 deposit + $5 bonus)
4. Check dashboard shows bonus was applied
5. Try topping up again - verify NO bonus is applied on second topup

### Test Payment Flows

Test each payment method:
- ✅ **Balance Payment:** Use wallet balance to purchase tickets
- ✅ **Crypto Payment:** Send USDC from wallet to purchase
- ✅ **Card Payment:** Use Coinbase Commerce for card payments
- ✅ **Wallet Top-up:** Test instant top-up via wallet transfer

## RPC Function Reference

### Competition Entries
```sql
-- Get all entries for a competition (accepts UUID or uid)
SELECT * FROM get_competition_entries_bypass_rls('competition-id');
```

### Ticket Availability
```sql
-- Get unavailable ticket numbers
SELECT * FROM get_unavailable_tickets('competition-id');

-- Get full availability info
SELECT * FROM get_competition_ticket_availability_text('competition-id');
```

### User Dashboard
```sql
-- Get user's competition entries
SELECT * FROM get_comprehensive_user_dashboard_entries('user-id');

-- Get user's transaction history (orders)
SELECT * FROM get_user_transactions('user-id');

-- Get user balance with bonus status
SELECT * FROM get_user_balance('user-id');
```

### Balance & Bonus
```sql
-- Check bonus eligibility
SELECT * FROM check_first_deposit_bonus_eligibility('user-id');

-- Credit balance with bonus (for topups)
SELECT * FROM credit_balance_with_first_deposit_bonus(
  'user-id',        -- canonical user ID
  10.00,            -- amount
  'wallet_topup',   -- reason
  'tx-hash'         -- reference ID
);
```

## Indexes Created

The migrations create the following indexes for optimal performance:

**Competitions:**
- `idx_competitions_uid` - Fast lookups by uid
- `idx_competitions_status` - Filter by status
- `idx_competitions_end_date` - Filter by end date
- `idx_competitions_vrf_seed` - VRF lookups

**Canonical Users:**
- `idx_canonical_users_wallet_lower` - Case-insensitive wallet lookups
- `idx_canonical_users_base_wallet_lower` - Base wallet lookups
- `idx_canonical_users_canonical_user_id` - Canonical ID lookups

**Joincompetition:**
- `idx_joincompetition_competitionid` - Competition entries
- `idx_joincompetition_wallet_lower` - User entries
- `idx_joincompetition_canonical_user_id` - Canonical user entries

**Tickets:**
- `idx_tickets_competition_id` - Competition tickets
- `idx_tickets_user_id_lower` - User tickets
- `idx_tickets_canonical_user_id` - Canonical user tickets
- `idx_tickets_ticket_number` - Sold tickets

**User Transactions:**
- `idx_user_transactions_user_id` - User transactions
- `idx_user_transactions_canonical_user_id` - Canonical user transactions
- `idx_user_transactions_competition_id` - Competition transactions
- `idx_user_transactions_status` - Transaction status

**Pending Tickets:**
- `idx_pending_tickets_competition_id` - Pending competition tickets
- `idx_pending_tickets_user_id` - User pending tickets
- `idx_pending_tickets_status` - Pending status
- `idx_pending_tickets_expires_at` - Expiration management

## Troubleshooting

### If entries don't display:
1. Check if `get_competition_entries_bypass_rls()` function exists
2. Run: `SELECT * FROM get_competition_entries_bypass_rls('comp-id')` to test
3. Verify `competitions.uid` column exists

### If ticket availability is wrong:
1. Check `get_unavailable_tickets()` function
2. Verify it returns correct ticket numbers
3. Check both `joincompetition` and `tickets` tables have entries

### If dashboard is empty:
1. Verify `get_comprehensive_user_dashboard_entries()` exists
2. Test: `SELECT * FROM get_comprehensive_user_dashboard_entries('user-id')`
3. Check user has entries in `joincompetition` or `tickets` tables

### If bonus doesn't apply:
1. Verify `credit_balance_with_first_deposit_bonus()` function exists
2. Check `canonical_users.has_used_new_user_bonus` column exists
3. Verify user's `has_used_new_user_bonus` is `false` before first topup
4. Check Netlify function logs for errors

### If VRF data missing:
1. Verify columns exist: `outcomes_vrf_seed`, `vrf_pregenerated_tx_hash`
2. Check competition has been drawn and VRF data populated
3. Verify VRF contract address: `0x8ce54644e3313934D663c43Aea29641DFD8BcA1A`

## Support

If you encounter issues after applying these migrations:

1. **Check Supabase Logs:** Dashboard → Logs → Filter by function name
2. **Check Browser Console:** Look for errors when loading pages
3. **Test RPCs Directly:** Use SQL Editor to test RPC functions
4. **Verify Netlify Deploy:** Check that updated functions deployed successfully

## Rollback (Emergency Only)

If you need to rollback these changes:

1. The migrations use `DROP FUNCTION IF EXISTS` before creating functions
2. Columns are added with `IF NOT EXISTS` checks
3. To rollback, you would need to manually drop functions and columns
4. **Recommendation:** Test in staging environment first

## Summary

After applying these migrations, you should have:
- ✅ All competition entries displaying correctly on live pages
- ✅ Dashboard fully functional with ORDERS, ENTRIES, and ACCOUNT tabs
- ✅ VRF verification working on finished competitions
- ✅ 50% first deposit bonus applied automatically
- ✅ All payment flows working (balance, crypto, card)
- ✅ Optimal database performance with proper indexes

The system should now be running exactly like stage.theprize.io with all features functional.
