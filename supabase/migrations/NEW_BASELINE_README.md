# Frontend-First Baseline Migration

## Overview

This is a clean, comprehensive baseline migration for ThePrize.io database, built from frontend requirements. It **replaces all 52 previous migrations** with a clean, organized baseline.

## Philosophy

**Frontend First / Functionality First**: This migration disregards existing Supabase pollution and focuses purely on what the frontend needs to work 100%. The schema is derived by analyzing actual frontend code usage.

## Migration Files

### 1. `00000000000000_new_baseline.sql` (Core Schema)
- **40+ tables** with proper constraints and indexes
- Core user tables (canonical_users, users, profiles)
- Balance & transaction tables (sub_account_balances, wallet_balances, wallet_ledger, balance_ledger, user_transactions)
- Competition tables (competitions, tickets, competition_entries, joincompetition, pending_tickets)
- Winner tables (winners, competition_winners, Prize_Instantprizes)
- Order tables (orders, order_tickets, payment_idempotency)
- CMS tables (faqs, hero_competitions, partners, testimonials, site_stats, site_metadata)
- Notification tables (notifications, user_notifications)

### 2. `00000000000001_baseline_views_rls.sql` (Views & Security)
- **3 critical views**:
  - `v_joincompetition_active` - Active competition entries (50+ frontend references)
  - `v_competition_ticket_stats` - Real-time ticket availability
  - `user_overview` - Comprehensive user dashboard data (JSON aggregates)
- **RLS policies** for all tables
- **GRANT statements** for anon, authenticated, service_role

### 3. `00000000000002_baseline_rpc_functions.sql` (RPC Functions)
- **31 essential RPC functions** organized in 6 categories:
  1. **User Balance (4 functions)**: get_user_balance, credit_sub_account_balance, add_pending_balance
  2. **User Profile & Wallet (9 functions)**: upsert_canonical_user, update_user_profile, wallet management
  3. **Ticket Reservation (7 functions)**: reserve_tickets_atomically, allocate_lucky_dip, finalize_order
  4. **Competition Queries (4 functions)**: get_unavailable_tickets, check_sold_out, sync_status
  5. **User Data (6 functions)**: get_user_tickets, get_comprehensive_user_dashboard_entries
  6. **Payment (1 function)**: execute_balance_payment
- All functions use `SECURITY DEFINER` with `SET search_path = public`

### 4. `00000000000003_baseline_triggers.sql` (Triggers)
- **2 trigger functions**: timestamp updates, reservation expiry
- **18 timestamp triggers**: Auto-update `updated_at` columns
- **1 expiry trigger**: Auto-expire pending ticket reservations

### 5. `00000000000004_baseline_grants.sql` (Final Setup)
- Execute permissions on all functions
- Default privileges for future functions
- Performance indexes

## Frontend Requirements Coverage

### Tables (25+)
✅ canonical_users, competitions, tickets, joincompetition  
✅ winners, user_transactions, balance_ledger, sub_account_balances  
✅ pending_tickets, orders, site_metadata, and more

### Views (3)
✅ v_joincompetition_active  
✅ v_competition_ticket_stats  
✅ user_overview

### RPC Functions (31)
✅ upsert_canonical_user  
✅ get_user_balance  
✅ reserve_tickets_atomically  
✅ get_comprehensive_user_dashboard_entries  
✅ ...and 27 more

## Migration Instructions

### Fresh Install
```bash
# Run migrations in order
supabase db reset
# Migrations run automatically in numeric order:
# 00000000000000 → 00000000000001 → 00000000000002 → 00000000000003 → 00000000000004
```

### Production Migration
```bash
# Backup existing database first!
pg_dump > backup.sql

# Option 1: Clean slate (DESTRUCTIVE - drops all tables)
supabase db reset

# Option 2: Incremental (if keeping some data)
# Archive old migrations first, then run new baseline
mv supabase/migrations/*.sql supabase/migrations/archived_old_migrations/
# Then run new migrations
```

## Key Features

### Multi-Wallet Support
- Users can link multiple wallets (Base, Ethereum, external)
- Canonical user ID format: `prize:pid:0x{wallet_address}`
- Case-insensitive wallet address matching

### Balance System
- USD and bonus balance tracking
- Sub-account balances per currency
- Complete ledger with before/after balances
- Pending balance support for async payments

### Ticket System
- Atomic ticket reservations with expiry
- Lucky dip (random ticket allocation)
- Pending tickets for checkout process
- Sold-out detection and competition status sync

### Security
- Row Level Security (RLS) on all tables
- SECURITY DEFINER functions for privileged operations
- Public read access for competitions and CMS content
- User-scoped access for personal data

### Performance
- Comprehensive indexes on all foreign keys
- Indexes on frequently queried columns
- Optimized views for dashboard queries
- Efficient JSON aggregation in user_overview

## Verification

### Check Tables
```sql
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;
-- Should return 40+ tables
```

### Check Views
```sql
SELECT table_name FROM information_schema.views 
WHERE table_schema = 'public';
-- Should return: v_joincompetition_active, v_competition_ticket_stats, user_overview
```

### Check Functions
```sql
SELECT routine_name FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_type = 'FUNCTION';
-- Should return 31+ functions
```

### Test Key Functions
```sql
-- Test user balance
SELECT get_user_balance('prize:pid:0x...');

-- Test dashboard entries
SELECT get_comprehensive_user_dashboard_entries('prize:pid:0x...');

-- Test ticket availability
SELECT * FROM v_competition_ticket_stats WHERE competition_id = '...';
```

## Differences from Old Baseline

### Additions
- ✅ `wallet_balances` table (was missing as view)
- ✅ `wallet_ledger` table (was missing)
- ✅ Comprehensive `user_overview` view with JSON aggregates
- ✅ `v_competition_ticket_stats` view
- ✅ Additional indexes for performance

### Removals
- ❌ Removed unused/legacy tables
- ❌ Removed deprecated functions
- ❌ Simplified complex trigger logic

### Improvements
- 🎯 Focused on actual frontend usage
- 🎯 Better organized (5 files vs 52 migrations)
- 🎯 Consistent naming conventions
- 🎯 Better documentation
- 🎯 Security best practices (SECURITY DEFINER + SET search_path)

## Troubleshooting

### Migration Fails
```bash
# Check for conflicting objects
SELECT * FROM pg_tables WHERE schemaname = 'public';

# Drop specific conflicting objects
DROP TABLE IF EXISTS ... CASCADE;

# Re-run migration
supabase db reset
```

### RLS Issues
```bash
# Check RLS status
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';

# Grant missing permissions
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
```

### Function Permissions
```bash
# Grant execute on specific function
GRANT EXECUTE ON FUNCTION function_name TO anon, authenticated, service_role;

# Grant on all functions
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
```

## Support

For issues or questions:
1. Check this README
2. Review frontend code in `src/services/` for usage examples
3. Check function definitions in migration files
4. Test with Supabase SQL editor

## Version History

- **1.0** (2026-02-08): Initial frontend-first baseline migration
  - 40+ tables
  - 3 views
  - 31 RPC functions
  - 18 triggers
  - Complete RLS policies
