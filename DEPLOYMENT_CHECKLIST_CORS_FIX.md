# DEPLOYMENT CHECKLIST - CORS Fix

## Pre-Deployment Verification ✅

- [x] Code changes reviewed - No issues found
- [x] Security scan completed - No vulnerabilities detected
- [x] All modified functions verified:
  - [x] purchase-tickets-with-bonus/index.ts
  - [x] update-user-avatar/index.ts
  - [x] upsert-user/index.ts
- [x] CORS headers verified across all 13 user-facing functions
- [x] Edge runtime imports added correctly
- [x] Syntax validated (no compilation errors)
- [x] Documentation created

## Deployment Steps

### Step 1: Deploy Edge Functions to Supabase

**CRITICAL**: These functions MUST be deployed to Supabase for the fix to take effect.

```bash
# Navigate to project root
cd /home/runner/work/theprize.io/theprize.io

# Option A: Deploy the 3 fixed functions individually
supabase functions deploy purchase-tickets-with-bonus
supabase functions deploy update-user-avatar
supabase functions deploy upsert-user

# Option B: Deploy all functions (recommended for consistency)
supabase functions deploy
```

### Step 2: Verify Deployment

After deployment, check the Supabase dashboard:

1. Go to Edge Functions section
2. Verify these functions show recent deployment:
   - purchase-tickets-with-bonus
   - update-user-avatar
   - upsert-user
3. Check function logs for any initialization errors

### Step 3: Test the Fix

**Test Environment**: substage.theprize.io

#### Test Case 1: Purchase with Balance
1. Open browser console (F12)
2. Navigate to a competition page
3. Ensure user has balance (check RealTimeBalance logs)
4. Select 1-3 tickets (Lucky Dip or manual selection)
5. Click "Purchase with Balance"
6. **Expected Result**:
   - ✅ No "Failed to fetch" error
   - ✅ No CORS errors in console
   - ✅ Purchase completes successfully
   - ✅ Success message displayed
   - ✅ Balance is deducted
   - ✅ Tickets appear in user's dashboard

#### Test Case 2: Purchase with Bonus
1. Ensure user has bonus balance
2. Select tickets
3. Choose "Pay with Bonus" option
4. Click purchase
5. **Expected Result**:
   - ✅ Same as Test Case 1
   - ✅ Bonus balance is deducted instead of regular balance

#### Test Case 3: User Avatar Update
1. Navigate to user profile
2. Click "Change Avatar"
3. Select a new avatar
4. **Expected Result**:
   - ✅ No errors in console
   - ✅ Avatar updates successfully

### Step 4: Monitor Logs

Watch for these success indicators in browser console:
```
[BalancePayment] Purchasing with balance (simplified system): {...}
[BalancePayment] Edge function response: {hasData: true, hasError: false, dataStatus: 'ok', ...}
[BalancePayment] Purchase successful: {competitionId: '...', ticketCount: X}
```

Watch for these in Supabase Edge Function logs:
```
[purchase-tickets-with-bonus] Parsed params: {...}
[purchase-tickets-with-bonus] Purchase successful
```

## Rollback Plan

If issues occur after deployment:

### Option 1: Rollback via Supabase Dashboard
1. Go to Edge Functions
2. Click on the affected function
3. View deployment history
4. Select previous version
5. Click "Rollback"

### Option 2: Rollback via CLI
```bash
# This won't work with git revert since deployment is separate
# Instead, restore from backup and redeploy
git checkout HEAD~1 -- supabase/functions/purchase-tickets-with-bonus/index.ts
supabase functions deploy purchase-tickets-with-bonus
```

### Option 3: Use Backup Files
```bash
# Restore from .backup files if needed
cp supabase/functions/purchase-tickets-with-bonus/index.ts.backup \
   supabase/functions/purchase-tickets-with-bonus/index.ts
supabase functions deploy purchase-tickets-with-bonus
```

## Success Criteria

✅ **All of the following must be true**:

1. Edge Functions deployed successfully
2. No initialization errors in Supabase logs
3. Purchase with balance works (no "Failed to fetch")
4. Purchase with bonus works
5. User avatar updates work
6. No CORS errors in browser console
7. Balance is deducted correctly
8. Tickets are allocated properly

## Known Issues & Mitigation

### Issue: Previous Deployment Issues
**Mitigation**: This fix addresses the root cause (missing edge-runtime import)

### Issue: CORS Preflight Failures
**Mitigation**: All CORS headers verified and include cache-control, pragma, expires

### Issue: Function Initialization Failures  
**Mitigation**: Edge runtime import now present in all critical functions

## Post-Deployment

After successful deployment:

1. Mark this PR as ready for merge
2. Update issue tracker with resolution
3. Notify team that "pay with balance" is fixed
4. Monitor error rates for 24 hours
5. Document any lessons learned

## Contact

If deployment issues occur:
- Check Supabase dashboard logs first
- Review COMPREHENSIVE_CORS_FIX.md for technical details
- Check browser console for client-side errors
- Verify environment variables are set correctly

## Notes

- This fix only requires Edge Function deployment
- No database migrations needed
- No frontend changes required
- Backend code changes are minimal (3 lines total)
- CORS headers were already correct - just needed runtime import
- This is a low-risk, high-impact fix
