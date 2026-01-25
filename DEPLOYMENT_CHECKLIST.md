# Deployment & Verification Checklist

## Pre-Deployment ✅

- [x] Migration file created: `20260125200000_godlike_super_migration_fix_all_critical_rpcs.sql`
- [x] Documentation complete: `GODLIKE_MIGRATION_SUMMARY.md`
- [x] Quick reference created: `QUICK_REFERENCE.md`
- [x] Original SQL files archived: `supabase/archived_sql_fixes/`
- [x] All 7 functions included in migration
- [x] RLS policies defined for 3 tables
- [x] Verification checks included at end of migration

## Deployment Steps

### Option 1: Automatic (Recommended)
```bash
# Push to main branch - Supabase auto-applies migrations
git merge copilot/create-super-migration
git push origin main
```

### Option 2: Supabase CLI
```bash
# Apply migration using Supabase CLI
supabase db push
```

### Option 3: Manual SQL
1. Go to Supabase Dashboard → SQL Editor
2. Copy contents of `20260125200000_godlike_super_migration_fix_all_critical_rpcs.sql`
3. Paste and click "Run"
4. Check logs for verification output

## Post-Deployment Verification

### 1. Check Migration Applied ✓
In Supabase SQL Editor, run:
```sql
SELECT * FROM supabase_migrations.schema_migrations 
WHERE version = '20260125200000'
ORDER BY inserted_at DESC
LIMIT 1;
```
**Expected:** One row showing successful migration

### 2. Verify Functions Created ✓
```sql
SELECT 
  proname as function_name,
  pg_get_function_identity_arguments(p.oid) as parameters
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid  
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_comprehensive_user_dashboard_entries',
    'get_competition_entries_bypass_rls',
    'get_competition_entries',
    'get_user_tickets',
    'get_competition_ticket_availability_text',
    'get_unavailable_tickets',
    'check_and_mark_competition_sold_out'
  )
ORDER BY proname, parameters;
```
**Expected:** 7+ functions (including both UUID and TEXT overloads for check_and_mark_competition_sold_out)

### 3. Verify RLS Enabled ✓
```sql
SELECT 
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('tickets', 'user_transactions')
ORDER BY tablename;
```
**Expected:** Both tables show `rowsecurity = true`

### 4. Verify competitions.uid Column ✓
```sql
SELECT 
  column_name, 
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'competitions'
  AND column_name = 'uid';
```
**Expected:** One row showing `uid` column of type `text`

### 5. Check Migration Logs ✓
In Supabase Dashboard → Settings → Database → Logs

Look for output:
```
NOTICE: All critical RPCs are now fixed! Refresh your frontend.
NOTICE: competitions.uid column exists: true
NOTICE: RPC Functions created: 7
```

## Frontend Testing

### 1. Open Browser Console
Navigate to your app and open Developer Tools → Console

### 2. Check for Success Messages ✓
Look for:
```
✓ rpcSuccess: true
✓ Ticket availability loaded successfully
```

### 3. Check NO Error Messages ✓
Should NOT see:
```
✗ POST /rpc/get_comprehensive_user_dashboard_entries - 404
✗ POST /rpc/check_and_mark_competition_sold_out - 404
✗ POST /rpc/get_unavailable_tickets - 404
✗ GET /rpc/get_competition_entries_bypass_rls - 300
```

### 4. Test User Flows ✓

**Dashboard:**
- [ ] User dashboard loads without errors
- [ ] Entries display correctly
- [ ] Entry counts are accurate (not showing 40,792 total entries)

**Ticket Availability:**
- [ ] Competition pages show correct ticket counts
- [ ] "X tickets remaining" is accurate
- [ ] Available tickets load properly

**Ticket Purchase:**
- [ ] Can select tickets successfully
- [ ] Purchase with balance works
- [ ] Tickets appear in dashboard immediately after purchase
- [ ] Balance updates correctly

**Competition Status:**
- [ ] Sold-out competitions marked correctly
- [ ] Status updates reflect in real-time

## Rollback (If Needed)

If critical issues occur:

### Option 1: Create Rollback Migration
```sql
-- In new migration file
BEGIN;

-- Drop TEXT overload (the only truly new function)
DROP FUNCTION IF EXISTS check_and_mark_competition_sold_out(TEXT) CASCADE;

-- Other functions should continue working with UUID from previous migrations

COMMIT;
```

### Option 2: Restore from Backup
1. Go to Supabase Dashboard → Database → Backups
2. Restore to point before migration
3. Investigate issue before re-applying

## Troubleshooting

### Issue: Functions not found
**Solution:** Check function names match exactly (case-sensitive)

### Issue: Still getting 404 errors  
**Solution:** 
1. Clear browser cache
2. Hard refresh (Ctrl+Shift+R / Cmd+Shift+R)
3. Check Supabase logs for actual errors

### Issue: RLS blocking queries
**Solution:** Verify policies created correctly with:
```sql
SELECT * FROM pg_policies 
WHERE schemaname = 'public' 
  AND tablename IN ('tickets', 'user_transactions');
```

### Issue: Performance degraded
**Solution:** Check query plans:
```sql
EXPLAIN ANALYZE 
SELECT * FROM get_comprehensive_user_dashboard_entries('your-user-id');
```

## Support Contacts

If issues persist:
1. Check `GODLIKE_MIGRATION_SUMMARY.md` for detailed troubleshooting
2. Review Supabase error logs
3. Test with Supabase SQL Editor directly
4. Check frontend network tab for actual RPC calls

## Success Criteria

Migration is successful when:
- ✅ All 7 functions exist in database
- ✅ No 404 errors in browser console
- ✅ Dashboard loads user entries correctly
- ✅ Ticket purchases complete end-to-end
- ✅ Balance updates reflect in real-time
- ✅ Competition status updates correctly

---

**Created:** 2026-01-25  
**Migration:** 20260125200000  
**Status:** Ready for deployment
