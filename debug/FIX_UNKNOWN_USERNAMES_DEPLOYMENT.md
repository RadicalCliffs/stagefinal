# FIX UNKNOWN USERNAMES - DEPLOYMENT GUIDE

## Problem Summary
Winner records were being created with "Unknown" usernames when user lookups failed, even though all users are required to have usernames. This was caused by:
1. Simple lookup queries that only tried one identifier type
2. Case sensitivity issues with wallet addresses
3. Missing fallback strategies
4. Silent failures with "Unknown" instead of errors

## Solution Overview
1. **Backfill Script**: Fixes all existing winner records with "Unknown" usernames
2. **Enhanced Lookup Logic**: Adds 7 fallback strategies to ensure we always find the user
3. **Error Logging**: Surfaces data integrity issues instead of silently using "Unknown"

## Files Modified

### Created Files:
1. `BACKFILL_WINNER_USERNAMES.sql` - SQL script to fix existing records
2. `src/lib/robust-user-lookup.ts` - Shared TypeScript lookup utility
3. `supabase/functions/_shared/robust-user-lookup.ts` - Deno Edge Function version

### Updated Files:
1. `supabase/functions/vrf-sync-results/index.ts` - VRF winner creation
2. `netlify/functions/backfill-competition-winners.mts` - Backfill function
3. `src/lib/competition-lifecycle.ts` - Competition lifecycle handler
4. `netlify/functions/competition-lifecycle-checker.mts` - Lifecycle checker
5. `netlify/functions/confirm-pending-tickets-proxy.mts` - Ticket confirmation

## Deployment Steps

### Step 1: Run Backfill (Database)
```bash
# Connect to production database
psql "postgresql://postgres.mthwfldcjvpxjtmrqkqm:your-password@aws-0-us-east-1.pooler.supabase.com:6543/postgres" -f BACKFILL_WINNER_USERNAMES.sql
```

**Expected Output:**
```
=== BACKFILL WINNER USERNAMES ===
Found X winners with missing usernames

Fixed winner ID abc123: Unknown → johndoe
Fixed winner ID def456: Unknown → alice_crypto
...

=== BACKFILL COMPLETE ===
Total problematic winners: X
Successfully fixed: Y
Still unresolved: Z
```

### Step 2: Verify Backfill Results
```sql
-- Check for remaining Unknown usernames
SELECT COUNT(*) as count, username
FROM winners
WHERE username IN ('Unknown', 'Anonymous', 'Winner', '', NULL)
GROUP BY username;

-- Should return 0 rows or only edge cases
```

### Step 3: Deploy Updated Edge Functions
```bash
# Deploy VRF sync function
npx supabase functions deploy vrf-sync-results

# Verify deployment
npx supabase functions list
```

### Step 4: Deploy Netlify Functions
```bash
# Netlify will auto-deploy on git push
git add .
git commit -m "Fix: Eliminate 'Unknown' usernames with robust user lookup"
git push origin main

# Or manual deploy
netlify deploy --prod
```

### Step 5: Verify in Production

1. **Check Finished Competition Pages:**
   - Visit a recently finished competition
   - Verify winner username displays correctly
   - No "Unknown" should appear

2. **Monitor Logs for Errors:**
   ```bash
   # Supabase logs
   npx supabase functions logs vrf-sync-results --tail
   
   # Netlify logs
   netlify functions:log confirm-pending-tickets-proxy --tail
   ```

3. **Look for Critical Error Messages:**
   - `❌ CRITICAL: User not found` - Indicates actual data issue
   - These should be investigated, not silently ignored

## Lookup Strategy Flow

The enhanced lookup tries these strategies in order:

1. **canonical_user_id** - Direct match on canonical ID
2. **userId as canonical_user_id** - User ID might be canonical ID
3. **wallet_address** (case-insensitive) - Wallet lookup
4. **base_wallet_address** - Alternative wallet field
5. **privy_user_id** - Legacy Privy identifier
6. **id (UUID)** - Direct user ID match
7. **Constructed prize:pid:wallet** - Build canonical ID from wallet

Each strategy only runs if previous ones failed, ensuring we try all possibilities before giving up.

## Monitoring & Alerts

### What to Monitor:
- ✅ No new winner records with "Unknown" username
- ✅ "CRITICAL: User not found" errors in logs
- ✅ Failed winner record insertions

### Expected Behavior After Fix:
- **Finished Competition Pages**: Always show actual usernames
- **Logs**: May see "CRITICAL" errors if data integrity issues exist
- **Database**: `winners.username` never contains "Unknown", "Anonymous", or NULL

### If You See "CRITICAL" Errors:
This means there's a genuine data integrity issue:
1. User has tickets but no record in `canonical_users`
2. Identifier mismatch between tables
3. Data corruption

**Action Required:**
```sql
-- Investigate the specific user
SELECT * FROM canonical_users WHERE canonical_user_id = '[reported_id]';
SELECT * FROM tickets WHERE canonical_user_id = '[reported_id]';

-- Check for case mismatches
SELECT * FROM canonical_users WHERE LOWER(wallet_address) = LOWER('[wallet]');
```

## Rollback Plan

If issues occur:

### Rollback Code Changes:
```bash
git revert HEAD
git push origin main
```

### Rollback Database Changes:
The backfill script only updates `username` field, so you can revert manually if needed:
```sql
-- Find recently updated winners (only if needed)
SELECT * FROM winners WHERE updated_at > NOW() - INTERVAL '1 hour';

-- No automatic rollback needed - the backfill only improves data
```

## Testing Checklist

- [ ] Backfill script completed successfully
- [ ] Zero "Unknown" usernames in `winners` table
- [ ] Edge functions deployed without errors
- [ ] Netlify functions deployed successfully
- [ ] Finished competition page shows real usernames
- [ ] No unexpected errors in production logs
- [ ] Monitor for 24 hours for any issues

## Success Criteria

✅ **Backfill Complete**: All existing winner records have valid usernames
✅ **Code Deployed**: All 5 winner-creation functions use enhanced lookup
✅ **Zero "Unknown"**: No new winner records with placeholder usernames
✅ **Logs Clean**: Only legitimate "CRITICAL" errors for real data issues
✅ **Pages Display**: All finished competition pages show actual usernames

---

**Deployment Date**: _________________
**Deployed By**: _________________
**Issues Encountered**: _________________
