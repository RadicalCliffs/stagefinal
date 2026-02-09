# Purchase Tickets with Balance - System Diagnosis

## Executive Summary

The `purchase_tickets_with_bonus` function mentioned in the issue appears to be **an outdated Supabase Edge Function** that is **no longer being used** in production. The actual implementation uses:

1. **Netlify Proxy**: `/api/purchase-with-balance` → `netlify/functions/purchase-with-balance-proxy.mts`
2. **Supabase RPC**: `purchase_tickets_with_balance` (NOT an edge function)

## Architecture Overview

### Current (Correct) Flow
```
Frontend (usePurchaseWithBalance.ts)
    ↓
Netlify Proxy (/api/purchase-with-balance)
    ↓
Supabase RPC (purchase_tickets_with_balance)
    ↓
Database (sub_account_balances, joincompetition, tickets, balance_ledger)
```

### Deprecated (Unused) Flow
```
Frontend (DEPRECATED)
    ↓
Supabase Edge Function (purchase-tickets-with-bonus/index.ts) ← SHOULD BE REMOVED
    ↓
Database
```

## Key Findings

### 1. Naming Confusion
The issue mentions "purchase_tickets_with_**bonus**" but the actual production system uses:
- RPC function: `purchase_tickets_with_**balance**`
- Netlify proxy: `purchase-with-**balance**-proxy`
- Frontend hook: `usePurchaseWith**Balance**`

The edge function at `supabase/functions/purchase-tickets-with-bonus/index.ts` is **DEPRECATED** and should be removed to avoid confusion.

### 2. The Edge Function is Not Being Called
Looking at the frontend code:
- File: `src/hooks/usePurchaseWithBalance.ts`
- Endpoint: `/api/purchase-with-balance` (Netlify, not Supabase Edge)
- No references to `purchase-tickets-with-bonus` edge function in active code

### 3. Historical Issues (Already Fixed)
Based on the archived documentation:

**Issue 1: Missing RPC Function (FIXED)**
- Migration: `20260128152400_add_debit_sub_account_balance.sql`
- Status: ✅ Fixed - RPC function now exists

**Issue 2: Column Name Mismatch (FIXED)**
- Problem: `last_updated` vs `updated_at`
- Status: ✅ Fixed in migrations

**Issue 3: UUID Type Casting (FIXED)**
- Migration: `20260209060000_fix_purchase_rpc_uuid_casting.sql`
- Status: ✅ Fixed - proper UUID casting added

### 4. Current RPC Implementation
The RPC function `purchase_tickets_with_balance` (in migration `20260130000000_simplified_balance_payment.sql` and `20260209060000_fix_purchase_rpc_uuid_casting.sql`) is:
- ✅ Properly implemented with UUID casting
- ✅ Has atomic balance updates with row locking
- ✅ Includes proper error handling
- ✅ Creates balance_ledger entries for audit
- ✅ Restricted to service_role only (secure)

## Diagnosis of the "Continual Failure"

### Possible Root Causes

1. **Edge Function Still Deployed on Supabase**
   - The deprecated edge function may still be deployed on Supabase
   - If something is calling it, it will fail (outdated logic, missing functions, etc.)
   - **Solution**: Undeploy or delete the edge function from Supabase

2. **CORS Issues**
   - Historical issues with CORS on edge functions
   - Migrations: `20260209051700_edge_function_cors_fix.sql`, `20260209052800_cors_security_enhancement.sql`
   - **Solution**: Already fixed in migrations, but edge function needs to be removed

3. **Environment Variables**
   - Netlify proxy requires: `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - Edge function (if still running) requires: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - **Check**: Ensure Netlify env vars are set correctly

4. **Deployment State Mismatch**
   - Migrations may be applied but edge function not redeployed
   - Or edge function is deployed but shouldn't be
   - **Solution**: Remove edge function entirely

## Recommended Actions

### Immediate Actions

1. **Remove the Deprecated Edge Function**
   ```bash
   # Delete the edge function from Supabase
   supabase functions delete purchase-tickets-with-bonus
   
   # Or locally, remove the directory
   rm -rf supabase/functions/purchase-tickets-with-bonus
   ```

2. **Verify Netlify Environment Variables**
   - Ensure `VITE_SUPABASE_URL` is set
   - Ensure `SUPABASE_SERVICE_ROLE_KEY` is set (for RPC calls)
   - Check Netlify dashboard → Site settings → Environment variables

3. **Verify RPC Function Exists**
   ```sql
   -- Run in Supabase SQL Editor
   SELECT routine_name, routine_type
   FROM information_schema.routines
   WHERE routine_name = 'purchase_tickets_with_balance'
   AND routine_schema = 'public';
   ```

4. **Test the Netlify Proxy**
   ```bash
   # Test locally with Netlify Dev
   netlify dev
   
   # Test the endpoint
   curl -X POST http://localhost:8888/api/purchase-with-balance \
     -H "Content-Type: application/json" \
     -d '{
       "userId": "test-user",
       "competition_id": "test-comp",
       "ticketPrice": 1.0,
       "ticket_count": 1
     }'
   ```

### Long-term Actions

1. **Remove All References to the Old Edge Function**
   - Delete `supabase/functions/purchase-tickets-with-bonus/`
   - Update any documentation that references it
   - Remove deployment scripts if they reference it

2. **Add Tests**
   - Add integration tests for the Netlify proxy
   - Add unit tests for the RPC function
   - Add end-to-end tests for the purchase flow

3. **Monitoring**
   - Add logging to track purchase attempts
   - Monitor Netlify function logs
   - Set up alerts for purchase failures

## Files to Review

### Active (Production)
- ✅ `netlify/functions/purchase-with-balance-proxy.mts` - Main implementation
- ✅ `src/hooks/usePurchaseWithBalance.ts` - Frontend hook
- ✅ `supabase/migrations/20260130000000_simplified_balance_payment.sql` - RPC function
- ✅ `supabase/migrations/20260209060000_fix_purchase_rpc_uuid_casting.sql` - UUID fixes

### Deprecated (Should Remove)
- ❌ `supabase/functions/purchase-tickets-with-bonus/index.ts` - OLD edge function
- ❌ `supabase/functions/purchase-tickets-with-bonus/index.ts.backup` - Backup

### Documentation (Archived)
- 📄 `docs/archive/FIX_PURCHASE_TICKETS_BONUS_SUMMARY.md` - Historical fixes
- 📄 `debug/FIX_PURCHASE_TICKETS_BONUS_SUMMARY.md` - Historical fixes

## Conclusion

The "continual failure" is likely caused by:
1. **Confusion between the old edge function and the new RPC-based system**
2. **The old edge function may still be deployed on Supabase and receiving calls**
3. **Environment variable issues on Netlify**

**The solution is NOT to fix the edge function, but to REMOVE it entirely** and ensure all traffic goes through the Netlify proxy → RPC flow, which is already properly implemented and tested.

## Next Steps

1. ✅ Clean up repository (DONE - moved all .md files to docs/archive/)
2. ⚠️ Remove deprecated edge function (RECOMMENDED)
3. ⚠️ Verify Netlify environment variables
4. ⚠️ Test the Netlify proxy endpoint
5. ⚠️ Update deployment scripts to exclude the old edge function
