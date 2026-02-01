# 🚨 CRITICAL: Production Database Schema Reality Check

**Date**: January 31, 2026  
**Status**: 🔴 **EXTREME MISALIGNMENT DISCOVERED**

---

## Executive Summary

After receiving the COMPLETE production database schema from Supabase dashboard, the misalignment is far more severe than initially assessed:

### The Numbers

| Component | Documented in Repo | Production Reality | Gap | Status |
|-----------|-------------------|-------------------|-----|--------|
| **Functions** | 48 | **253** | **205 missing** | 🔴 CRITICAL |
| **Triggers** | 11 | **78** | **67 missing** | 🔴 CRITICAL |
| **Indexes** | 92 | **180+** | **90+ missing** | 🔴 CRITICAL |

### Impact Assessment

**🔴 EXTREME RISK**
- Any database reset/rebuild would **destroy 80% of business logic**
- **205 functions** would be permanently lost
- **67 triggers** maintaining data integrity would vanish
- **90+ performance indexes** would disappear
- Application would **completely fail**

---

## Detailed Findings

### 1. Functions - The Missing 205

#### Production Function Breakdown (253 total):

**Custom Business Logic Functions: 221**
- Get/Query Functions: 41 (user data, tickets, competitions, balances)
- Balance Management: 39 (credit, debit, transfer, topup)
- Ticket Operations: 50 (reserve, purchase, confirm, allocate)
- Update/Upsert Functions: 18 (user profiles, competitions, wallets)
- Cleanup Functions: 11 (expired reservations, old data)
- Internal Helpers: 8 (prefixed with `_`)
- Trigger Functions: 8 (database automation)
- Remaining: 46 (authentication, VRF, competition management, etc.)

**PostgreSQL Extension Functions: 32**
- pgcrypto extension: 22 functions (encryption, hashing)
- uuid-ossp extension: 10 functions (UUID generation)

#### Critical Missing Functions

**Balance Operations (39 functions):**
```
✅ credit_sub_account_balance - IN MIGRATIONS
✅ debit_sub_account_balance - IN MIGRATIONS
❌ credit_sub_account_with_bonus - NOT IN MIGRATIONS
❌ apply_wallet_mutation - NOT IN MIGRATIONS
❌ check_balance_health - NOT IN MIGRATIONS
❌ get_balance_by_any_id - NOT IN MIGRATIONS
... and 33 more balance functions NOT in migrations
```

**Ticket Operations (50 functions):**
```
✅ get_unavailable_tickets - IN MIGRATIONS
❌ allocate_lucky_dip_tickets_batch - NOT IN MIGRATIONS
❌ reserve_selected_tickets - NOT IN MIGRATIONS
❌ confirm_pending_tickets_with_balance - NOT IN MIGRATIONS
❌ finalize_ticket_hold - NOT IN MIGRATIONS
❌ create_ticket_hold - NOT IN MIGRATIONS
... and 44 more ticket functions NOT in migrations
```

**User Management (41 GET functions + many more):**
```
✅ get_user_balance - IN MIGRATIONS
✅ attach_identity_after_auth - IN MIGRATIONS
✅ upsert_canonical_user - IN MIGRATIONS
❌ get_comprehensive_user_dashboard_entries - NOT IN MIGRATIONS
❌ get_user_competition_entries - NOT IN MIGRATIONS
❌ resolve_canonical_identity - NOT IN MIGRATIONS
❌ ensure_canonical_user - NOT IN MIGRATIONS
... and 55+ more user functions NOT in migrations
```

**Competition Management (20+ functions):**
```
❌ get_competition_entries_bypass_rls - NOT IN MIGRATIONS (but USED in codebase!)
❌ check_and_mark_competition_sold_out - NOT IN MIGRATIONS
❌ sync_competition_status_if_ended - NOT IN MIGRATIONS
❌ get_active_competitions_for_draw - NOT IN MIGRATIONS
❌ end_competition_and_select_winners - NOT IN MIGRATIONS
... and 15+ more competition functions NOT in migrations
```

**Payment Processing (15+ functions):**
```
✅ purchase_tickets_with_balance - IN MIGRATIONS (recent addition)
❌ execute_balance_payment - NOT IN MIGRATIONS
❌ pay_balance_transaction - NOT IN MIGRATIONS
❌ confirm_payment_and_issue_tickets - NOT IN MIGRATIONS
❌ debit_balance_and_confirm - NOT IN MIGRATIONS
... and 10+ more payment functions NOT in migrations
```

**Cleanup & Maintenance (11 functions):**
```
✅ cleanup_expired_idempotency - IN MIGRATIONS
❌ cleanup_expired_holds - NOT IN MIGRATIONS
❌ cleanup_expired_pending_tickets - NOT IN MIGRATIONS
❌ cleanup_orphaned_pending_tickets - NOT IN MIGRATIONS
❌ cleanup_stale_transactions - NOT IN MIGRATIONS
... and 6 more cleanup functions NOT in migrations
```

---

### 2. Function Overloading - Hidden Complexity

**Production uses extensive function overloading** (same function name, different signatures):

**Examples:**
```sql
-- credit_sub_account_balance has 2 overloads
credit_sub_account_balance(canonical_user_id, amount, currency, reference_id, description)
credit_sub_account_balance(canonical_user_id, currency, amount)

-- get_user_balance has 2 overloads
get_user_balance(user_identifier, in_currency)
get_user_balance(p_user_identifier, p_canonical_user_id)

-- get_competition_entries has 3 overloads
get_competition_entries(competition_id)
get_competition_entries(p_competition_id, p_limit, p_offset)
get_competition_entries(competition_identifier)

-- award_welcome_bonus has 2 overloads
award_welcome_bonus(p_wallet, p_threshold, p_bonus)
award_welcome_bonus(p_wallet, p_threshold)

-- And many more...
```

This means migration files need to handle:
- Multiple function signatures
- Parameter variations
- Default values
- Return type differences

---

### 3. Security Model - DEFINER vs INVOKER

From the production data, functions have different security models:

**SECURITY DEFINER (Elevated Privileges):**
- All credit/debit balance functions
- All ticket confirmation functions
- All payment processing functions
- User identity management functions
- Critical business logic functions
- **~180 functions use DEFINER**

**SECURITY INVOKER (User Privileges):**
- Helper functions
- Internal utilities
- Query functions without side effects
- **~73 functions use INVOKER**

This distinction is CRITICAL for:
- Security
- RLS bypass
- Permission escalation
- Function execution context

---

### 4. Evidence of Active Usage

**Frontend RPC Calls Found:**
```typescript
// From codebase analysis:
supabase.rpc('get_user_balance')                     ✅ IN PRODUCTION
supabase.rpc('get_unavailable_tickets')              ✅ IN PRODUCTION
supabase.rpc('get_competition_entries_bypass_rls')   ✅ IN PRODUCTION (NOT in migrations!)
supabase.rpc('attach_identity_after_auth')           ✅ IN PRODUCTION
supabase.rpc('upsert_canonical_user')                ✅ IN PRODUCTION
supabase.rpc('update_user_avatar')                   ✅ IN PRODUCTION
supabase.rpc('get_user_wallets')                     ✅ IN PRODUCTION
supabase.rpc('set_primary_wallet')                   ✅ IN PRODUCTION
supabase.rpc('get_user_transactions')                ✅ IN PRODUCTION
```

**All of these are actively used but most are NOT in migration files!**

---

### 5. PostgreSQL Extensions Required

Production database requires these extensions (NOT documented in migrations):

**pgcrypto Extension:**
```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```
Provides: armor, crypt, decrypt, encrypt, digest, hmac, pgp_*, gen_random_*

**uuid-ossp Extension:**
```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```
Provides: uuid_generate_v1, uuid_generate_v4, uuid_generate_v5, uuid_nil, uuid_ns_*

**Missing from migrations!**

---

## What This Means

### For Deployment
🔴 **CANNOT deploy schema from migrations to clean database**
- Would create only 48 functions instead of 253
- Would create only 11 triggers instead of 78
- Would create only 92 indexes instead of 180+
- Application would immediately break

### For Development
🟡 **Local development databases are incorrect**
- Developers don't have production-accurate schema
- Testing is not representative
- Bugs may only appear in production

### For Disaster Recovery
🔴 **CANNOT restore from migrations**
- Complete data loss scenario = complete application loss
- No way to rebuild production database from source control
- Business continuity at extreme risk

### For Schema Changes
🔴 **Any schema migration is dangerous**
- Don't know full dependency graph
- Could break undocumented functions
- Could violate assumptions made by production-only code

---

## Immediate Actions Required

### Phase 1: Export Production Schema (URGENT - 24 hours)

1. **Export ALL Function Definitions**
```sql
-- Run this query on production database
SELECT 
  p.proname as function_name,
  pg_get_functiondef(p.oid) as definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.prokind = 'f'  -- Functions only, not procedures
ORDER BY p.proname;

-- Save to: supabase/migrations/20260201000000_restore_all_production_functions.sql
```

2. **Export ALL Trigger Definitions**
```sql
-- Already provided by user, create migration file
-- Save to: supabase/migrations/20260201000001_restore_all_production_triggers.sql
```

3. **Export ALL Index Definitions**
```sql
-- Already provided by user, create migration file
-- Save to: supabase/migrations/20260201000002_restore_all_production_indexes.sql
```

4. **Export Extension Requirements**
```sql
-- Create: supabase/migrations/00000000000000_extensions.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

### Phase 2: Documentation Update (48 hours)

1. **Update Functions.md**
   - Document ALL 253 functions
   - Group by category
   - Note usage in codebase
   - Mark DEFINER vs INVOKER
   - Show function overloads

2. **Update Triggers.md**
   - Already complete ✅

3. **Update Indexes.md**
   - Already complete ✅

4. **Create MIGRATION_GUIDE.md**
   - How to extract production schema
   - How to apply to fresh database
   - Testing procedures
   - Rollback procedures

### Phase 3: Verification (1 week)

1. **Test Schema Recreation**
   - Create fresh database
   - Apply ALL migrations
   - Compare with production
   - Fix any differences

2. **Function Testing**
   - Test all RPC calls used by frontend
   - Test all RPC calls used by edge functions
   - Verify return types match
   - Verify security models match

3. **Integration Testing**
   - Test complete user flows
   - Test payment flows
   - Test ticket reservation flows
   - Test competition entry flows

### Phase 4: Prevention (Ongoing)

1. **Schema Change Process**
   - All changes MUST go through migrations
   - Block manual production changes
   - Require peer review for schema changes
   - Test migrations on staging first

2. **Automated Monitoring**
   - Daily schema drift detection
   - Alert on manual changes
   - Track function/trigger/index counts
   - Compare production vs migrations

3. **Documentation**
   - Keep Functions.md updated
   - Keep Triggers.md updated
   - Keep Indexes.md updated
   - Document all RPC usage

---

## Risk Matrix

| Risk | Likelihood | Impact | Severity | Mitigation |
|------|-----------|--------|----------|------------|
| Database reset loses functions | Low | Catastrophic | 🔴 EXTREME | Export schema immediately |
| Deployment breaks production | Medium | High | 🔴 CRITICAL | Block deployments until aligned |
| Schema drift continues | High | High | 🔴 CRITICAL | Implement monitoring |
| Local dev mismatch | High | Medium | 🟡 HIGH | Update dev setup guide |
| Manual production changes | Medium | High | 🟡 HIGH | Block dashboard access |

---

## Conclusion

The production database has **205 undocumented functions**, **67 undocumented triggers**, and **90+ undocumented indexes** that are critical to application operation but not in source control.

**This is the most severe schema misalignment possible.**

**Action Required**: IMMEDIATE schema export and migration creation.

**Timeline**: Must be completed within 48 hours to prevent data loss risk.

**Owner**: Database Team + DevOps

**Status**: 🔴 **CRITICAL - IMMEDIATE ACTION REQUIRED**

---

**Report Generated**: 2026-01-31  
**Next Review**: Daily until resolved  
**Escalation**: Executive team notified
