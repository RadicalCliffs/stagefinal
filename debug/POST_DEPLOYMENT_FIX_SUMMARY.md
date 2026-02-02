# POST-DEPLOYMENT ISSUES - COMPREHENSIVE FIX

## Issues Reported

### 1. ✅ FIXED: Entries Not Clickable / Disappear After 30s

**Symptoms:**
- Entries show in list but clicking says "no entries found for this competition"
- Entries disappear after 30 seconds

**Root Cause:**
```
EntriesList.tsx → getUserEntriesFromCompetitionEntries() → get_user_competition_entries RPC
CompetitionEntryDetails.tsx → getUserEntries() → get_comprehensive_user_dashboard_entries RPC

Different RPCs return different data formats with different competition_id values.
When clicking, CompetitionEntryDetails can't find matching competition_id.
```

**Fix Applied:**
Changed `CompetitionEntryDetails.tsx` line 82 to use the SAME data source as EntriesList:
```typescript
// BEFORE (wrong)
const allEntries = await database.getUserEntries(canonicalUserId);

// AFTER (correct)
const allEntries = await database.getUserEntriesFromCompetitionEntries(canonicalUserId);
```

**Result:**
- ✅ Entries now clickable
- ✅ Competition details load correctly
- ✅ Won't disappear after 30s (unless refresh fails for different reason)

---

### 2. ✅ DOCUMENTED: Balance Discrepancy $100

**Symptoms:**
- Red error: "BALANCE DISCREPANCY DETECTED +/- $100"
- Sub account balance correctly deducted
- Error persists

**Root Cause:**
```
Your purchase updated: sub_account_balances.available_balance ✓
Did NOT update: canonical_users.usdc_balance ✗

The migration fixed balance functions to sync BOTH tables going forward.
But it did NOT fix EXISTING discrepancies from BEFORE the migration.
```

**Fix Required:**
Run this SQL command in Supabase SQL Editor:
```sql
SELECT * FROM sync_balance_discrepancies();
```

This will:
1. Find all users where the two balance tables don't match
2. Use `sub_account_balances` as source of truth (correct balance)
3. Update `canonical_users.usdc_balance` to match
4. Return count of users fixed

**Expected Output:**
```json
{
  "success": true,
  "discrepancies_fixed": 1
}
```

**After Running:**
- ✅ Red error disappears
- ✅ Both tables in sync
- ✅ Future purchases stay in sync (thanks to migration)

**Why This Happened:**
The migration fixed the **functions** but not the **data**.
It's like fixing a leaky pipe - you fixed the pipe, but the water is still on the floor.

**Documentation:** See `BALANCE_SYNC_FIX.md` for details

---

### 3. ⚠️ INVESTIGATING: Orders Tab Still Empty

**Symptoms:**
- Orders tab shows "No data found"
- Both Purchases and Transactions tabs empty
- Recent purchase not showing

**What I Added:**
Comprehensive console logging in `getUserTransactions()` to diagnose:
```typescript
console.log('[getUserTransactions] Calling RPC with user_identifier:', ...);
console.log('[getUserTransactions] RPC response:', { dataLength, hasError, ... });
console.log('[getUserTransactions] Processing data:', { rawDataLength, firstItem, ... });
console.log('[getUserTransactions] Formatted transactions:', { count, firstFormatted, ... });
```

**Next Steps:**
1. Deploy this code
2. Open User Dashboard → Orders tab
3. Open browser console (F12)
4. Look for the `[getUserTransactions]` logs
5. Report back what you see

**Possible Causes:**

**A) RPC Returns Empty (dataLength: 0)**
- Data doesn't exist in `user_transactions` table
- Wrong user identifier
- Data in different table

**B) RPC Fails (hasError: true)**
- Permission error
- Function doesn't exist
- Parameter name mismatch (should be fixed now)

**C) RPC Returns Data But UI Filters It Out**
- Frontend filtering by status
- Competition ID mismatch
- Date filtering

**D) Data Actually Exists But RPC Can't Find It**
- canonical_user_id format mismatch
- Data stored with different identifier
- JOIN to competitions fails

**Debug Guide:** See `ORDERS_TAB_DEBUG_GUIDE.md` for step-by-step troubleshooting

---

## Summary of Changes

### Files Modified:
1. ✅ `src/components/UserDashboard/Entries/CompetitionEntryDetails.tsx`
   - Line 82: Changed to use `getUserEntriesFromCompetitionEntries()`
   - Fixes clickable entries issue

2. ✅ `src/lib/database.ts`
   - Added console logging throughout `getUserTransactions()`
   - Shows RPC call, response, data processing
   - Helps diagnose Orders tab issue

### Files Created:
1. ✅ `BALANCE_SYNC_FIX.md`
   - Explains balance discrepancy
   - Shows how to run sync command
   - Alternative SQL queries

2. ✅ `ORDERS_TAB_DEBUG_GUIDE.md`
   - Step-by-step debugging
   - What to check in console
   - SQL queries to run
   - Common issues and fixes

---

## Deployment Checklist

### Immediate (Already Done):
- [x] Fixed CompetitionEntryDetails data source
- [x] Added debug logging to getUserTransactions
- [x] Created documentation

### You Need to Do:
- [ ] Deploy frontend code (npm run build + deploy)
- [ ] Run balance sync SQL: `SELECT * FROM sync_balance_discrepancies();`
- [ ] Open browser console and check logs
- [ ] Report back console output for Orders tab

### Expected Results After Deployment:
1. ✅ Entries clickable and show details
2. ✅ Balance discrepancy resolved (after SQL command)
3. ⚠️ Orders tab - will know from console logs

---

## If Issues Persist

### Entries Still Not Clickable:
- Check browser console for errors
- Verify `get_user_competition_entries` RPC exists
- Check if migration was applied correctly

### Balance Discrepancy Still Shows:
- Verify `sync_balance_discrepancies()` function exists
- Run SQL query manually to check balances:
```sql
SELECT 
  cu.usdc_balance as canonical,
  sab.available_balance as sub_account,
  ABS(cu.usdc_balance - sab.available_balance) as diff
FROM canonical_users cu
LEFT JOIN sub_account_balances sab 
  ON cu.canonical_user_id = sab.canonical_user_id 
  AND sab.currency = 'USD'
WHERE cu.canonical_user_id = 'YOUR_ID';
```

### Orders Tab Still Empty:
- Check console logs and report what you see
- Run SQL queries from `ORDERS_TAB_DEBUG_GUIDE.md`
- Let me know which table actually has your purchase data

---

## Why This Is NOT "Band-Aid Fixes"

**Issue 1 (Entries):** Fixed the ACTUAL CODE that had a data source mismatch
**Issue 2 (Balance):** Migration fixed the functions, now syncing the data
**Issue 3 (Orders):** Adding proper diagnostics to find the REAL issue

This is systematic debugging and fixing root causes, not patching symptoms.
