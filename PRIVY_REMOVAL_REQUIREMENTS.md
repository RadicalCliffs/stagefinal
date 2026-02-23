# CRITICAL: Remove Legacy Privy References

**Priority:** HIGH  
**Status:** NOT STARTED  
**Created:** 2026-02-23  

## Problem

The codebase has **441 references** to "privy" - a deprecated authentication provider that has been replaced with Base/CDP wallet authentication. The `privy_user_id` column exists in multiple tables but now just stores wallet addresses or canonical user IDs, making the naming misleading and the code confusing.

All users now authenticate via Base wallet. The `privy_user_id` field is **legacy cruft** that should be replaced with `canonical_user_id` everywhere.

## Impact

- **Code maintainability:** Confusing naming where `privy_user_id` actually contains wallet addresses
- **Potential bugs:** Multiple identity columns lead to inconsistent lookups
- **Technical debt:** 441 references across 48 files that reference a dead auth system

---

## Phase 1: Frontend Code (LOW RISK)

Replace all frontend usage of `privy_user_id` with `canonical_user_id`.

### Files to Update

| File | Refs | Action |
|------|------|--------|
| `src/lib/identity.ts` | 57 | Remove `isPrivyDid()`, `generatePrivyStyleId()`, update `UserIdentity` type |
| `src/lib/database.types.ts` | 40 | **Regenerate after DB migration** |
| `src/lib/base-payment.ts` | 27 | Remove localStorage privy token checks |
| `src/lib/user-auth.ts` | 23 | Remove privy_user_id lookups, use canonical_user_id only |
| `src/hooks/useUserProfile.ts` | 22 | Remove privyColumn references |
| `src/hooks/useRealTimeBalance.ts` | 14 | Remove `.or(privy_user_id.eq...)` from queries |
| `src/components/BaseWalletAuthModal.tsx` | 8 | Change RPC param names from `p_privy_user_id` to `p_canonical_user_id` |
| `src/services/dashboardEntriesService.ts` | 12 | Update type definitions and queries |

### localStorage Keys to Remove

These legacy Privy localStorage keys should be removed from all files:
- `privy:token`
- `privy:access_token`
- `privy:authState`

**Files affected:**
- `src/lib/base-payment.ts`
- `src/lib/base-account-payment.ts`
- `src/lib/competition-state.ts`
- `src/lib/secure-api.ts`
- `src/lib/vrf-debug.ts`
- `src/lib/notification-service.ts`
- `src/hooks/useInstantWinTickets.ts`

---

## Phase 2: Netlify Functions (MEDIUM RISK)

Update all serverless functions to use `canonical_user_id` exclusively.

### Files to Update

| File | Refs | Action |
|------|------|--------|
| `netlify/functions/confirm-pending-tickets-proxy.mts` | 43 | Replace privyUserId param with canonicalUserId |
| `netlify/functions/secure-write.mts` | 21 | Update auth and insert logic |
| `netlify/functions/cleanup-duplicate-emails.mts` | 16 | Update queries |
| `netlify/functions/user-balance.mts` | 9 | Remove privy_user_id from .or() filters |
| `netlify/functions/backfill-competition-winners.mts` | 7 | Update user lookups |

---

## Phase 3: Database Migration (HIGH RISK)

### Step 1: Backfill Data

```sql
-- Ensure all privy_user_id values are copied to canonical_user_id
UPDATE canonical_users 
SET canonical_user_id = CASE 
  WHEN privy_user_id LIKE '0x%' THEN 'prize:pid:' || lower(privy_user_id)
  WHEN privy_user_id LIKE 'did:privy:%' THEN 'prize:pid:' || replace(privy_user_id, 'did:privy:', '')
  ELSE canonical_user_id
END
WHERE canonical_user_id IS NULL AND privy_user_id IS NOT NULL;

-- Same for other tables
UPDATE sub_account_balances SET canonical_user_id = COALESCE(canonical_user_id, privy_user_id) WHERE canonical_user_id IS NULL;
UPDATE joincompetition SET canonical_user_id = COALESCE(canonical_user_id, privy_user_id) WHERE canonical_user_id IS NULL;
UPDATE tickets SET canonical_user_id = COALESCE(canonical_user_id, privy_user_id) WHERE canonical_user_id IS NULL;
UPDATE pending_tickets SET canonical_user_id = COALESCE(canonical_user_id, user_id) WHERE canonical_user_id IS NULL;
UPDATE user_transactions SET canonical_user_id = COALESCE(canonical_user_id, user_privy_id) WHERE canonical_user_id IS NULL;
```

### Step 2: Update Database Functions

These RPC functions accept `p_privy_user_id` parameter and need updating:

1. `ensure_canonical_user`
2. `credit_balance_topup`
3. `purchase_with_balance_v2`
4. `get_sub_account_balance`
5. `resolve_canonical_identity`
6. `attach_identity_after_auth`
7. `confirm_pending_tickets_rpc`
8. `process_pending_tickets_batch`

### Step 3: Drop Columns (AFTER CODE DEPLOYED)

```sql
-- ONLY after all code is deployed and verified working
ALTER TABLE canonical_users DROP COLUMN IF EXISTS privy_user_id;
ALTER TABLE sub_account_balances DROP COLUMN IF EXISTS privy_user_id;
ALTER TABLE joincompetition DROP COLUMN IF EXISTS privy_user_id;
ALTER TABLE tickets DROP COLUMN IF EXISTS privy_user_id;
ALTER TABLE pending_tickets DROP COLUMN IF EXISTS privy_user_id;
ALTER TABLE pending_tickets DROP COLUMN IF EXISTS user_privy_id;
ALTER TABLE user_transactions DROP COLUMN IF EXISTS user_privy_id;
ALTER TABLE transfers DROP COLUMN IF EXISTS from_privy_user_id;
ALTER TABLE transfers DROP COLUMN IF EXISTS to_privy_user_id;
ALTER TABLE users DROP COLUMN IF EXISTS privy_id;
ALTER TABLE users DROP COLUMN IF EXISTS privy_user_id;
```

---

## Tables with `privy_user_id` Column

| Table | Column | Current Usage |
|-------|--------|---------------|
| `canonical_users` | `privy_user_id` | Stores wallet address or legacy Privy DID |
| `sub_account_balances` | `privy_user_id` | Stores wallet address |
| `joincompetition` | `privy_user_id` | Stores wallet address or canonical_user_id |
| `tickets` | `privy_user_id` | Stores wallet address |
| `pending_tickets` | `privy_user_id`, `user_privy_id` | Both store wallet/canonical ID |
| `user_transactions` | `user_privy_id` | Stores wallet address |
| `transfers` | `from_privy_user_id`, `to_privy_user_id` | Stores wallet addresses |
| `users` | `privy_id`, `privy_user_id` | Legacy table |

---

## Verification Checklist

### Pre-Migration
- [ ] All users have `canonical_user_id` populated
- [ ] No active users rely solely on `privy_user_id` for identification
- [ ] Backup of all affected tables created

### Post Phase 1
- [ ] Frontend builds without errors
- [ ] All TypeScript types updated
- [ ] No runtime errors in browser console

### Post Phase 2  
- [ ] All Netlify functions deploy successfully
- [ ] User signup works
- [ ] User login works
- [ ] Balance queries work
- [ ] Ticket purchases work

### Post Phase 3
- [ ] All queries using `privy_user_id` removed
- [ ] Database types regenerated
- [ ] All historical data accessible via `canonical_user_id`

---

## Rollback Plan

If issues arise:
1. Revert code changes via git
2. Database columns are NOT removed until final verification
3. Re-add privy_user_id to queries as fallback if needed

---

## Notes

- The `did:privy:` format is completely legacy - no new users have this
- All current users authenticate via wallet address → `prize:pid:0x...` format
- The `privy_user_id` column is effectively just an alias for `canonical_user_id` now
