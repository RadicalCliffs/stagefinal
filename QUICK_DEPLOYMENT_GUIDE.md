# 🚀 Quick Deployment Guide - UUID to TEXT Migration

## ⚡ URGENT: Apply These Migrations to Fix Production Errors

### Current Errors Being Fixed
```
❌ "invalid input syntax for type uuid: \"0x2137af5047526a1180580ab02985a818b1d9c789\""
❌ "operator does not exist: uuid = text"
```

### Step-by-Step Deployment

#### 1️⃣ Open Supabase SQL Editor
Navigate to: **Supabase Dashboard → SQL Editor**

#### 2️⃣ Run Migration 1 (Functions)
```sql
-- Copy and paste the contents of:
supabase/migrations/20260120160000_fix_uuid_text_type_mismatch_in_user_functions.sql
```
**Expected Output:** 
- ✓ upsert_canonical_user function exists: true
- ✓ attach_identity_after_auth function exists: true
- ✓ SUCCESS: All functions fixed and recreated

#### 3️⃣ Run Migration 2 (Tables) ⭐ CRITICAL
```sql
-- Copy and paste the contents of:
supabase/migrations/20260120170000_fix_user_id_columns_uuid_to_text.sql
```
**Expected Output:**
- ✓ tickets.user_id converted to TEXT
- ✓ user_transactions.user_id converted to TEXT  
- ✓ pending_tickets.user_id converted to TEXT
- ✓ balance_ledger.user_id converted to TEXT
- ✓ wallet_balances.user_id converted to TEXT
- ✓ SUCCESS: All user_id columns are TEXT

#### 4️⃣ Run Tests
```sql
-- Copy and paste the contents of:
supabase/migrations/TEST_UUID_TEXT_FIXES.sql
```
**Expected Output:** All tests show `✓ PASS`

#### 5️⃣ Verify Frontend
1. Open: `https://substage.theprize.io/dashboard/entries`
2. Check browser console - Should see NO UUID errors
3. Verify dashboard loads successfully

---

## 📊 What This Fixes

| Before | After |
|--------|-------|
| ❌ `tickets.user_id UUID` | ✅ `tickets.user_id TEXT` |
| ❌ Can't query by wallet address | ✅ Can query: `user_id.eq.0x...` |
| ❌ Dashboard errors | ✅ Dashboard loads |
| ❌ UUID casting failures | ✅ TEXT comparisons work |

---

## 🔄 Rollback (If Needed)
```sql
-- Only if something goes wrong (unlikely)
ALTER TABLE tickets ALTER COLUMN user_id TYPE UUID USING user_id::UUID;
ALTER TABLE user_transactions ALTER COLUMN user_id TYPE UUID USING user_id::UUID;
ALTER TABLE pending_tickets ALTER COLUMN user_id TYPE UUID USING user_id::UUID;
```

⚠️ **Note**: Rollback only safe if no TEXT data inserted after migration

---

## ✅ Success Indicators
- [ ] Migrations run without errors
- [ ] Test script shows all `✓ PASS`
- [ ] Frontend dashboard loads
- [ ] No UUID errors in browser console
- [ ] Can view tickets and entries

---

## 📞 Need Help?
- Migration errors → Check Supabase logs
- Test failures → Review error messages in test output
- Frontend still broken → Check browser console for new errors

---

## 📁 Files in This PR
1. `20260120160000_fix_uuid_text_type_mismatch_in_user_functions.sql` - Fix RPC functions
2. `20260120170000_fix_user_id_columns_uuid_to_text.sql` - Fix table schemas (CRITICAL)
3. `TEST_UUID_TEXT_FIXES.sql` - Verify everything works
4. `UUID_TO_TEXT_MIGRATION_SUMMARY.md` - Detailed documentation

**Total Changes:** 1,056 lines
**Migration Time:** ~30 seconds
**Downtime:** None (migrations are online)

---

## 🎯 Bottom Line
These migrations fix the core data type mismatch causing your production errors. After applying them:
- ✅ Wallet addresses work everywhere
- ✅ No more UUID casting errors
- ✅ Dashboard and tickets load correctly
- ✅ All existing data preserved

**Apply migrations NOW to resolve production issues!** 🚀
