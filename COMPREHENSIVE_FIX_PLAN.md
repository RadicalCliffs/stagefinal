# Comprehensive Fix Plan - All 4 Issues

## Issues Summary

1. ❌ Balance discrepancy error
2. ❌ Orders tab empty  
3. ❌ Entry cards not showing details
4. ❌ sub_account_balances using wrong user_id format (`prize:pid:{uuid}` instead of `prize:pid:0x{wallet}`)

## Root Causes Found

### Issue 4 - UUID Format Bug (Most Critical)

**Bug Chain:**
1. `supabase/functions/_shared/userId.ts` lines 89-92: Accepts bare UUIDs and wraps as `prize:pid:{uuid}`
2. `supabase/migrations/20260128054900_fix_upsert_canonical_user.sql` line 60: Falls back to `p_uid` (UUID)
3. `supabase/migrations/20260201004000_restore_production_balance_functions.sql` line 82-83: Copies to user_id

**Expected Formats:**
- Wallet-based: `prize:pid:0x{40_char_lowercase_wallet}`
- Temp placeholder: `prize:pid:temp{N}`

**Wrong Format:**
- `prize:pid:{uuid}` ❌

## Comprehensive Fix

### Step 1: Fix userId.ts (Edge Functions)
**File:** `supabase/functions/_shared/userId.ts`
**Change:** Lines 89-95 - Reject bare UUIDs, force temp placeholder allocation

```typescript
// BEFORE (WRONG):
if (uuidPattern.test(trimmedId)) {
  return `prize:pid:${trimmedId.toLowerCase()}`;
}

// AFTER (CORRECT):
if (uuidPattern.test(trimmedId)) {
  // UUIDs should NOT be used as canonical IDs directly
  // This is likely p_uid being passed incorrectly
  // Return a temp placeholder instead
  throw new Error('UUID cannot be used as canonical_user_id. Use allocate_temp_canonical_user() or provide wallet address');
}
```

### Step 2: Fix upsert_canonical_user
**File:** `supabase/migrations/YYYYMMDDHHMMSS_fix_uuid_canonical_id_bug.sql`
**Change:** Never fall back to p_uid for canonical_user_id

```sql
-- BEFORE (WRONG):
COALESCE(p_canonical_user_id, p_uid),

-- AFTER (CORRECT):
-- Only use p_canonical_user_id if it's valid format
CASE 
  WHEN p_canonical_user_id IS NOT NULL AND (
    p_canonical_user_id LIKE 'prize:pid:0x%' OR 
    p_canonical_user_id LIKE 'prize:pid:temp%'
  ) THEN p_canonical_user_id
  WHEN p_wallet_address IS NOT NULL THEN 'prize:pid:' || util.normalize_evm_address(p_wallet_address)
  ELSE NULL  -- Let trigger handle temp placeholder
END
```

### Step 3: Data Cleanup Migration
**File:** `supabase/migrations/YYYYMMDDHHMMSS_cleanup_uuid_canonical_ids.sql`

```sql
-- Find all wrong-format canonical_user_ids
SELECT 
  id,
  canonical_user_id,
  user_id,
  wallet_address
FROM canonical_users
WHERE canonical_user_id ~ 'prize:pid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
AND canonical_user_id NOT LIKE 'prize:pid:0x%'
AND canonical_user_id NOT LIKE 'prize:pid:temp%';

-- Fix strategy:
-- 1. If wallet_address exists: Replace with prize:pid:0x{wallet}
-- 2. If no wallet: Replace with prize:pid:temp{N}
-- 3. Update all related tables (sub_account_balances, etc.)
```

### Step 4: Balance Sync
**Run:** `SELECT * FROM sync_balance_discrepancies();`

### Step 5: Verify RPC Functions
**Check:** All 3 RPC functions have correct columns (tx_id not transaction_hash)

### Step 6: Frontend Deployment
**Verify:** CompetitionEntryDetails using same data source as EntriesList

## Testing Checklist

- [ ] No new records created with `prize:pid:{uuid}` format
- [ ] All existing UUID-format IDs cleaned up
- [ ] Balance discrepancy error gone
- [ ] Orders tab shows data
- [ ] Entry cards show details when clicked
- [ ] All sub_account_balances have correct user_id format

## Migration Order

1. `YYYYMMDDHHMMSS_fix_uuid_canonical_id_bug.sql` - Fix upsert function
2. `YYYYMMDDHHMMSS_cleanup_uuid_canonical_ids.sql` - Clean existing data
3. Deploy edge function changes (userId.ts)
4. Run `SELECT * FROM sync_balance_discrepancies();` in SQL editor
5. Deploy frontend changes
6. Verify all 4 issues resolved
