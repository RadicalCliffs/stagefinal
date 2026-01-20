# 🚨 IMMEDIATE ACTION REQUIRED: Fix Frontend 404 Errors

## ⚡ FASTEST FIX (2 MINUTES)

Your frontend can't see entries/tickets because Supabase RPCs are missing. Here's how to fix it **right now**:

---

## 📍 STEP 1: Open Supabase SQL Editor

1. Go to: **https://supabase.com/dashboard**
2. Select your project: **`mthwfldcjvpxjtmrqkqm`**
3. Click **SQL Editor** in left sidebar
4. Click **New Query** button

---

## 📍 STEP 2: Copy the Fix Script

1. In this repository, open: **`supabase/APPLY_THIS_FIX_NOW.sql`**
2. Click **Raw** button (or use the file viewer)
3. Select **ALL** text (Ctrl+A / Cmd+A)
4. Copy to clipboard (Ctrl+C / Cmd+C)

> ⚠️ **IMPORTANT:** Make sure you copy the **ENTIRE** file, including:
> - The `BEGIN;` at the start
> - All function definitions
> - The `COMMIT;` at the end

---

## 📍 STEP 3: Run the Fix

1. In Supabase SQL Editor, paste the entire script (Ctrl+V / Cmd+V)
2. Click the **RUN** button (or press Ctrl+Enter)
3. Wait for execution to complete (~5 seconds)

---

## 📍 STEP 4: Verify Success

You should see this output at the bottom of SQL Editor:

```
NOTICE:  =====================================================
NOTICE:  CRITICAL FIX APPLIED - VERIFICATION RESULTS
NOTICE:  =====================================================
NOTICE:  competitions.uid column exists: true
NOTICE:  RPC Functions created: 3 (expected: 3)
NOTICE:  tickets RLS enabled: true
NOTICE:  user_transactions RLS enabled: true
NOTICE:  
NOTICE:  Fixed functions:
NOTICE:    ✓ get_comprehensive_user_dashboard_entries (404 fix)
NOTICE:    ✓ get_competition_entries (wrapper)
NOTICE:    ✓ get_competition_entries_bypass_rls (uuid/text handling)
NOTICE:  
NOTICE:  Fixed tables:
NOTICE:    ✓ tickets (RLS policies allow anon/authenticated read)
NOTICE:    ✓ user_transactions (RLS policies allow anon/authenticated read)
NOTICE:  
NOTICE:  Issues fixed:
NOTICE:    ✓ POST /rpc/get_comprehensive_user_dashboard_entries - 404
NOTICE:    ✓ GET /tickets?select=... - 404
NOTICE:    ✓ GET /user_transactions?select=... - 400
NOTICE:  =====================================================
NOTICE:  Now refresh your frontend and the errors should be gone!
NOTICE:  =====================================================

Success. No rows returned
```

✅ **If you see this, the fix was successful!**

❌ **If you see errors:**
- Make sure you copied the **ENTIRE** script
- Check that there are no syntax errors
- See Troubleshooting section below

---

## 📍 STEP 5: Test the Frontend

1. Go to your frontend application
2. **Hard refresh** the page:
   - **Windows/Linux:** Ctrl + Shift + R
   - **Mac:** Cmd + Shift + R
3. Open Developer Console (F12)
4. Navigate to **User Dashboard**
5. Navigate to a **Competition page**

### ✅ Success Checklist:

- [ ] No 404 errors in console
- [ ] No 400 errors in console
- [ ] User Dashboard shows entries
- [ ] Competition pages show entries table
- [ ] Tickets are visible
- [ ] Transactions are visible

---

## 🔧 Troubleshooting

### Problem: "relation 'user_transactions' does not exist"

**Solution:** The table doesn't exist yet. This is okay - the script handles this gracefully. The fix will still work for the other tables/RPCs.

### Problem: "syntax error at or near..."

**Solution:** You didn't copy the entire script. Go back to Step 2 and make sure you copy **everything** including `BEGIN;` and `COMMIT;`.

### Problem: Still seeing 404 errors after applying fix

**Checklist:**
1. Did you hard refresh the frontend? (Ctrl+Shift+R)
2. Did the SQL script show "Success" at the end?
3. Are you using the correct Supabase project URL?
4. Check Supabase Dashboard → Logs for additional errors

### Problem: "permission denied for function..."

**Solution:** The script grants permissions. If you still see this:
1. Make sure you ran the **entire** script
2. Try running the GRANT statements separately:

```sql
GRANT EXECUTE ON FUNCTION get_comprehensive_user_dashboard_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_comprehensive_user_dashboard_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_entries(TEXT) TO anon;
```

---

## 📊 What This Fix Does (Technical Details)

### Creates 3 RPC Functions:

1. **`get_comprehensive_user_dashboard_entries(user_identifier TEXT)`**
   - Returns all entries for a user
   - Sources: joincompetition, tickets, user_transactions, pending_tickets
   - Resolves user from canonical_users table
   - Used by User Dashboard

2. **`get_competition_entries(competition_identifier TEXT)`**
   - Returns all entries for a competition
   - Sources: joincompetition, tickets
   - Handles both UUID and text identifiers
   - Used by Competition pages

3. **`get_competition_entries_bypass_rls(competition_identifier TEXT)`**
   - Backend version with SECURITY DEFINER
   - Bypasses RLS for data aggregation

### Fixes RLS Policies:

- Enables RLS on `tickets` table
- Enables RLS on `user_transactions` table
- Creates read policies for anonymous users
- Creates read policies for authenticated users
- Preserves service_role full access

### Ensures Schema Compatibility:

- Adds `uid` column to `competitions` if missing
- Creates indexes for performance
- Handles NULL values gracefully

---

## 🎓 Why Did This Happen?

Supabase was reset or migrations weren't applied properly. The RPC functions and RLS policies that the frontend depends on were missing.

---

## 📚 Additional Resources

- **Detailed Guide:** `URGENT_FIX_README.md`
- **Quick Summary:** `QUICK_FIX_SUMMARY.md`
- **SQL Script:** `supabase/APPLY_THIS_FIX_NOW.sql`

---

## 🚀 Future Prevention

To avoid this issue in the future:

1. **Use Supabase CLI for migrations:**
   ```bash
   supabase db push
   ```

2. **Track applied migrations** in a spreadsheet or document

3. **Test in staging** before applying to production

4. **Backup database** before making changes:
   - Supabase Dashboard → Database → Backups

5. **Don't reset Supabase** without a migration plan

---

## ✅ DONE!

Once you've completed all steps and verified the frontend works:

1. ✅ Mark this issue as resolved
2. ✅ Document that the fix was applied
3. ✅ Consider adding monitoring for 404/400 errors
4. ✅ Review migration management process

---

## 💬 Need Help?

If you're still experiencing issues:

1. Check browser console for specific error messages
2. Check Supabase Dashboard → Logs
3. Check Network tab in browser DevTools
4. Verify the Supabase project URL matches your frontend configuration
5. Try logging in again (auth token might be expired)

---

**Last Updated:** 2026-01-20  
**Status:** Ready to Apply  
**Estimated Time:** 2 minutes  
**Risk Level:** Low (only creates/fixes functions and policies)
