# Dashboard Amount Issue - Investigation Report

## Executive Summary

**Issue**: Dashboard entries showing $0.00 instead of $62.70 for 627 tickets in competition `799a8e12-38f2-4989-ad24-15c995d673a6`

**Root Causes Identified**:

1. **Primary**: 626 out of 627 tickets have `purchase_price = $0` or `NULL` in the tickets table
2. **Secondary**: RPC function `get_comprehensive_user_dashboard_entries` references non-existent database columns

**Status**: ✅ Root cause identified, fix available

---

## Investigation Details

### User Information

- **User ID**: `prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363`
- **Wallet**: `0x0ff51ec0ecc9ae1e5e6048976ba307c849781363`
- **Competition**: `799a8e12-38f2-4989-ad24-15c995d673a6` (Win 1 ETH!)
- **Ticket Price**: $0.10 per ticket

### Issue Description

- User has 627 tickets that should show **$62.70** total spent
- Dashboard currently shows **$0.00**
- Recent 10¢ purchase (1 ticket) shows correctly

---

## Database Investigation Results

### 1. Competition Table ✅

```
Title: Win 1 ETH!
Ticket Price: $0.10
Tickets Sold: 630
Total Tickets: 1000
Status: active
```

**Finding**: Ticket price is correctly set to $0.10

### 2. joincompetition Table ✅

```
Found 1 entry for this user:
- Entry ID: 08d751d2-b912-4741-b1ef-51a3ceee67e2
- Tickets: 420
- Amount Spent: $42.00
- Status: active
- Created: 2026-03-02 12:05:07
```

**Finding**: This is an OLDER entry (420 tickets, $42) that is working correctly

### 3. tickets Table ❌ **PRIMARY ISSUE**

```
Found 627 tickets for this user

Purchase Price Distribution:
- $0.10:  1 ticket  (total: $0.10)  ← Recent purchase, working correctly
- $0.00:  626 tickets (total: $0.00) ← MISSING PURCHASE PRICES

Total: $0.10
Expected: $62.70
Missing: $62.60
```

**Finding**:

- 626 tickets have `purchase_price = 0` or `NULL`
- Only ticket #267 has correct `purchase_price = 0.10` (the recent 10¢ purchase)
- These tickets were created without proper purchase_price values

### 4. RPC Function ❌ **SECONDARY ISSUE**

```
Error: column cu.wallet_base does not exist
Code: 42703
```

**Finding**:

- The `get_comprehensive_user_dashboard_entries()` RPC function references:
  - `cu.wallet_base`
  - `cu.wallet_eth`
- These columns don't exist in the `canonical_users` table
- This causes the RPC to fail completely
- The function was likely created from `FIX_DASHBOARD_AND_TX_HASH.sql` which assumes a different schema

---

## Root Cause Analysis

### Why are 626 tickets showing $0.00?

**Cause**: When tickets were created in the `tickets` table, the `purchase_price` column was not populated correctly. This could be due to:

1. **Missing data in ticket creation flow**: When tickets are created from pending_tickets or other sources, the purchase_price is not being set
2. **Trigger failure**: If there's a trigger that should set purchase_price, it may be failing or not executing
3. **Bulk insert without price**: Tickets may have been bulk-inserted without price data

### Why does joincompetition work but tickets doesn't?

The `joincompetition` table is the **legacy** system and has `amount_spent` properly set. The newer `tickets` table approach is missing the price data.

### RPC Function Logic

The RPC function was supposed to calculate amount_spent as:

```sql
COALESCE(jc.amountspent, jc.numberoftickets * c.ticket_price, 0)
```

For the tickets table, it should sum:

```sql
COALESCE(t.purchase_price, c.ticket_price, 0)
```

But since purchase_price is 0/NULL and the RPC is failing due to schema mismatch, neither calculation works.

---

## Fix Implementation

### Fix 1: Update Missing purchase_price Values ✅

**SQL Fix**:

```sql
UPDATE tickets t
SET
  purchase_price = c.ticket_price,
  updated_at = NOW()
FROM competitions c
WHERE t.competition_id = c.id
  AND t.competition_id = '799a8e12-38f2-4989-ad24-15c995d673a6'
  AND (t.canonical_user_id = 'prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
       OR LOWER(t.wallet_address) = '0x0ff51ec0ecc9ae1e5e6048976ba307c849781363')
  AND (t.purchase_price IS NULL OR t.purchase_price = 0 OR t.purchase_price != c.ticket_price);
```

**Impact**:

- Updates 626 tickets from $0 to $0.10
- Total will change from $0.10 to $62.70
- Dashboard will show correct amount

### Fix 2: Repair RPC Function ✅

**Changes**:

1. Remove references to `cu.wallet_base` and `cu.wallet_eth`
2. Simplify user resolution logic (don't need canonical_users table lookup)
3. Group tickets by competition (not individual tickets)
4. Properly sum purchase_price values
5. Handle both legacy column names and new column names

**Impact**:

- RPC will no longer fail with schema errors
- Dashboard entries will load correctly
- Amount calculations will work properly

---

## Recommended Action

**Apply the fix**: `supabase/FIX_DASHBOARD_AMOUNT_ISSUE.sql`

This script:

1. ✅ Updates all 626 tickets with correct purchase_price ($0.10)
2. ✅ Fixes the RPC function to remove schema mismatches
3. ✅ Includes verification queries to confirm success
4. ✅ Is safe to run (uses BEGIN/COMMIT transaction)
5. ✅ Includes detailed logging of changes

**How to Apply**:

1. Go to Supabase Dashboard → SQL Editor
2. Paste the contents of `FIX_DASHBOARD_AMOUNT_ISSUE.sql`
3. Click "Run"
4. Review the output notices to confirm success

**Expected Result**:

- User will see $62.70 for their 627-ticket entry
- Dashboard will load without errors
- All entries will show correct amounts

---

## Prevention Recommendations

To prevent this issue in the future:

1. **Add database constraint** to ensure purchase_price is never NULL:

   ```sql
   ALTER TABLE tickets ALTER COLUMN purchase_price SET NOT NULL;
   ```

2. **Add trigger** to auto-populate purchase_price on insert:

   ```sql
   CREATE TRIGGER set_default_purchase_price
   BEFORE INSERT ON tickets
   FOR EACH ROW
   EXECUTE FUNCTION set_purchase_price_from_competition();
   ```

3. **Update ticket creation code** to always include purchase_price

4. **Add validation** in the application layer to ensure purchase_price is set

---

## Files Created

1. **diagnose-dashboard-amount.mjs** - Initial diagnostic script
2. **diagnose-dashboard-amount-v2.mjs** - Comprehensive diagnostic script
3. **analyze-ticket-prices.mjs** - Detailed purchase_price analysis
4. **supabase/FIX_DASHBOARD_AMOUNT_ISSUE.sql** - Complete fix script
5. **DASHBOARD_AMOUNT_ISSUE_REPORT.md** - This investigation report

---

## Test Results

### Before Fix:

```
✅ Competition ticket_price: $0.10
✅ joincompetition: 420 tickets, $42.00 (old entry, working)
❌ tickets table: 627 tickets, $0.10 total (626 missing prices)
❌ RPC function: FAILING (schema mismatch)
❌ Dashboard display: $0.00 shown
```

### After Fix (Expected):

```
✅ Competition ticket_price: $0.10
✅ joincompetition: 420 tickets, $42.00 (unchanged)
✅ tickets table: 627 tickets, $62.70 total (all prices set)
✅ RPC function: WORKING (schema fixed)
✅ Dashboard display: $62.70 shown
```

---

## Conclusion

The issue has been fully diagnosed:

- **626 tickets** are missing purchase_price values (stored as $0)
- **RPC function** has schema mismatch preventing dashboard from loading
- **Fix is ready** to apply via SQL script

The fix will:

- ✅ Correct all missing purchase_price values
- ✅ Repair the RPC function
- ✅ Restore dashboard functionality
- ✅ Show correct $62.70 amount for 627 tickets

**Next Step**: Apply `supabase/FIX_DASHBOARD_AMOUNT_ISSUE.sql` to production database.
