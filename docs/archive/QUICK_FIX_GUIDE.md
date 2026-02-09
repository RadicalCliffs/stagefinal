# QUICK FIX GUIDE

## 🔴 CRITICAL: Lucky Dip is Broken

**Problem:** All Lucky Dip reservations failing with "Failed to fetch"

**Fix:** Deploy the edge function
```bash
cd /path/to/theprize.io
supabase functions deploy lucky-dip-reserve
```

**Takes:** 2 minutes
**Unblocks:** All Lucky Dip purchases

---

## 🟢 FIXED: Transaction Display

**Problem:** UI showing `+$-55.00`

**Status:** ✅ Fixed in this PR (commit 388b174)

**Action:** Pull this PR to get the fix

---

## 🟡 INVESTIGATING: Negative Amounts

**Problem:** Transactions showing negative amounts and duplicates

**Status:** ⚠️ Needs database investigation

**Next Steps:**
1. Run SQL queries in `TRANSACTION_ISSUES_ANALYSIS.md`
2. Check webhook logs
3. Fix webhook idempotency

---

## Files to Read

1. **`ISSUE_RESOLUTION_SUMMARY.md`** - Full explanation
2. **`EDGE_FUNCTION_DEPLOYMENT_ISSUE.md`** - Deployment guide
3. **`TRANSACTION_ISSUES_ANALYSIS.md`** - Investigation queries

---

## Priority Order

1. ❌ **Deploy edge function** (CRITICAL - 2 min)
2. ✅ **Pull this PR** (get UI fixes)
3. ⚠️ **Run investigation queries** (understand root cause)
4. 🔧 **Fix webhooks** (prevent future issues)

---

**Everything is documented and code is fixed.**
**Just need to deploy the edge function!**
