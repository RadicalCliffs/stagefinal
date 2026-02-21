# Frontend-Production Database Alignment Report

**Generated**: 2026-02-18  
**Purpose**: Validate that frontend code uses correct production database functions and tables

## Executive Summary

❌ **CRITICAL**: Frontend is calling **5 functions that don't exist in production**

✅ **33 out of 38 RPC calls** are correct  
⚠️ **5 functions need fixes** before deployment

---

## Missing Functions Analysis

### 1. `finalize_purchase2` ❌
**Status**: Does NOT exist in production  
**Frontend Usage**:
- `src/lib/ticketPurchaseService.ts` (lines 813-871)
- `src/lib/supabase-rpc-helpers.ts` (lines 14-64)

**Production Alternative**: `finalize_purchase` ✅ (exists)
```typescript
// WRONG (current code):
supabase.rpc('finalize_purchase2', { ... })

// CORRECT (should be):
supabase.rpc('finalize_purchase', { p_reservation_id })
```

**Production Signature**:
```sql
public.finalize_purchase(p_reservation_id uuid) RETURNS jsonb
```

**Action Required**: Update all `finalize_purchase2` calls to `finalize_purchase`

---

### 2. `add_pending_balance` ❌
**Status**: Does NOT exist in production  
**Frontend Usage**:
- `src/lib/coinbase-commerce.ts` (line 260)

**Production Alternative**: `apply_wallet_mutation` ✅ (exists)
```typescript
// WRONG (current code):
supabase.rpc('add_pending_balance', {
  user_identifier,
  amount
})

// CORRECT (should be):
supabase.rpc('apply_wallet_mutation', {
  p_canonical_user_id: user_identifier,
  p_currency: 'USD',
  p_amount: amount,
  p_reference_id: transactionId,
  p_description: 'Pending top-up',
  p_top_up_tx_id: transactionId
})
```

**Production Signature**:
```sql
public.apply_wallet_mutation(
  p_canonical_user_id text,
  p_currency text,
  p_amount numeric,
  p_reference_id text,
  p_description text,
  p_top_up_tx_id text
) RETURNS TABLE(
  ledger_id uuid,
  canonical_user_id text,
  currency text,
  amount numeric,
  balance_before numeric,
  balance_after numeric,
  available_balance numeric,
  top_up_tx_id text
)
```

**Action Required**: Replace with `apply_wallet_mutation` or remove (code has fallback)

---

### 3. `reserve_tickets_atomically` ❌
**Status**: Does NOT exist in production  
**Frontend Usage**:
- `src/lib/database.ts` (line 3387)

**Production Alternative**: `reserve_tickets` ✅ (exists)
```typescript
// WRONG (current code):
supabase.rpc('reserve_tickets_atomically', {
  p_competition_id,
  p_user_id,
  p_ticket_count,
  p_ticket_numbers
})

// CORRECT (should be):
supabase.rpc('reserve_tickets', {
  p_competition_id,
  p_wallet_address: walletAddress,
  p_ticket_count,
  p_hold_minutes: 15
})
```

**Production Signature**:
```sql
public.reserve_tickets(
  p_competition_id uuid,
  p_wallet_address text,
  p_ticket_count integer,
  p_hold_minutes integer
) RETURNS TABLE(
  pending_ticket_id uuid,
  expires_at timestamp with time zone,
  ticket_numbers integer[]
)
```

**Action Required**: Update to use `reserve_tickets` or `reserve_selected_tickets`

---

### 4. `set_primary_wallet` ❌
**Status**: Does NOT exist in production  
**Frontend Usage**:
- `src/components/WalletManagement/WalletManagement.tsx` (line 272)

**Production Alternative**: Update `canonical_users` table directly
```typescript
// WRONG (current code):
supabase.rpc('set_primary_wallet', {
  user_identifier,
  p_wallet_address
})

// CORRECT (should be):
supabase
  .from('canonical_users')
  .update({ wallet_address: walletAddress })
  .eq('canonical_user_id', userIdentifier)
```

**Action Required**: Remove RPC call, update table directly

---

### 5. `get_linked_external_wallet` ❌
**Status**: Does NOT exist in production  
**Frontend Usage**:
- `src/components/WalletManagement/WalletManagement.tsx` (line 126)

**Production Alternative**: Query `canonical_users` table directly
```typescript
// WRONG (current code):
supabase.rpc('get_linked_external_wallet', {
  user_identifier
})

// CORRECT (should be):
supabase
  .from('canonical_users')
  .select('wallet_address, base_wallet_address, eth_wallet_address')
  .eq('canonical_user_id', userIdentifier)
  .single()
```

**Action Required**: Remove RPC call, query table directly

---

## Correct Functions (33 total) ✅

These RPC calls are working correctly:

1. ✓ `allocate_lucky_dip_tickets`
2. ✓ `allocate_lucky_dip_tickets_batch`
3. ✓ `allocate_temp_canonical_user`
4. ✓ `attach_identity_after_auth`
5. ✓ `check_and_mark_competition_sold_out`
6. ✓ `exec_sql`
7. ✓ `execute_balance_payment`
8. ✓ `finalize_order`
9. ✓ `get_available_ticket_count_v2`
10. ✓ `get_competition_entries`
11. ✓ `get_competition_entries_bypass_rls`
12. ✓ `get_competition_ticket_availability_text`
13. ✓ `get_competition_unavailable_tickets`
14. ✓ `get_comprehensive_user_dashboard_entries`
15. ✓ `get_unavailable_tickets`
16. ✓ `get_user_active_tickets`
17. ✓ `get_user_balance`
18. ✓ `get_user_competition_entries`
19. ✓ `get_user_tickets`
20. ✓ `get_user_tickets_for_competition`
21. ✓ `get_user_transactions`
22. ✓ `get_user_wallet_balance`
23. ✓ `get_user_wallets`
24. ✓ `migrate_user_balance`
25. ✓ `release_reservation`
26. ✓ `reserve_tickets`
27. ✓ `sync_competition_status_if_ended`
28. ✓ `unlink_external_wallet`
29. ✓ `unlink_wallet`
30. ✓ `update_user_avatar`
31. ✓ `update_user_profile_by_identifier`
32. ✓ `update_wallet_nickname`
33. ✓ `upsert_canonical_user`

---

## Table References

Frontend queries these tables. Need to verify all exist in production:

### Core Tables (verified)
- `canonical_users` ✓
- `competitions` ✓
- `tickets` ✓
- `winners` ✓
- `orders` ✓
- `balance_ledger` ✓
- `user_transactions` ✓
- `pending_tickets` ✓
- `pending_ticket_items` ✓
- `sub_account_balances` ✓
- `wallet_balances` ✓

### Views
- `v_joincompetition_active` (need to verify)
- `user_overview` (need to verify)
- `v_competition_ticket_stats` (need to verify)

### System Tables (read-only)
- `information_schema.columns` ✓
- `information_schema.routines` ✓
- `information_schema.triggers` ✓
- `pg_indexes` ✓

---

## Action Items

### Immediate Fixes Required

1. **Update `finalize_purchase2` → `finalize_purchase`**
   - Files: `src/lib/ticketPurchaseService.ts`, `src/lib/supabase-rpc-helpers.ts`
   - Change function name and signature

2. **Update `add_pending_balance` → `apply_wallet_mutation`**
   - File: `src/lib/coinbase-commerce.ts`
   - Use correct parameters

3. **Update `reserve_tickets_atomically` → `reserve_tickets`**
   - File: `src/lib/database.ts`
   - Use correct parameters

4. **Remove `set_primary_wallet` RPC**
   - File: `src/components/WalletManagement/WalletManagement.tsx`
   - Update table directly

5. **Remove `get_linked_external_wallet` RPC**
   - File: `src/components/WalletManagement/WalletManagement.tsx`
   - Query table directly

### Testing Required

After fixes:
1. Test balance top-ups (Coinbase Commerce)
2. Test ticket reservations
3. Test wallet management
4. Test finalize purchase flow

---

## Production Database Statistics

From CSV analysis:
- **Functions**: 410 total (406 public + 4 auth)
- **Indexes**: 101 total
- **Triggers**: 667 total (87 public schema)

**Source**: `/supabase/*.csv` files exported 2026-02-18

---

## Related Documentation

- `/supabase/PRODUCTION_CSV_README.md` - CSV file documentation
- `/supabase/migrations/README.md` - Migration guide
- `/scripts/validate-schema.py` - Schema validation script
