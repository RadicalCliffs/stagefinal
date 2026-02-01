# Database Migrations

This directory contains the database schema migrations for ThePrize.io.

## Migration Files

### Baseline Migrations

1. **`00000000000000_initial_schema.sql`** - Complete baseline schema
   - 45 tables with RLS policies
   - 43 RPC functions
   - 125+ indexes
   - Production-ready initial state
   - See: `/BASELINE_MIGRATION_README.md` for details

2. **`00000000000001_baseline_triggers.sql`** - Database triggers baseline
   - 9 core triggers (Phase 1)
   - Timestamp management triggers
   - Reservation expiry logic
   - Documentation for 42 additional triggers
   - See: `/TRIGGERS_MIGRATION_README.md` for details

### Production RPC Restoration (2026-02-01)

Critical RPC functions restored from production backup:

3. **`20260201004000_restore_production_balance_functions.sql`** - Core balance operations
   - `credit_sub_account_balance` - Atomic balance credit with audit trail
   - `debit_sub_account_balance` - Atomic balance debit with row-level locking
   - Includes wallet address normalization (prize:pid:0x... format)
   - Race condition prevention via FOR UPDATE locking
   - Automatic balance_ledger entries
   - Service role only access

4. **`20260201004100_restore_additional_balance_functions.sql`** - Helper functions
   - `confirm_ticket_purchase` - Atomic ticket confirmation with balance debit
   - `get_joincompetition_entries_for_competition` - Entry deduplication lookup
   - See: `/RESTORE_RPC_FUNCTIONS_DEPLOYMENT.md` for deployment guide

### Skipped Migrations

- **`20251218100000_create_vrf_availability_view_and_lucky_dip_support.sql.skip`**
  - VRF availability view and lucky dip support
  - Functionality is already included in baseline schema
  - Kept for historical reference only

## Applying Migrations

### Fresh Database Setup

```bash
# Reset database (applies all migrations)
supabase db reset
```

### Apply New Migrations

```bash
# Push new migrations to database
supabase db push
```

### Manual Application

Via Supabase Studio SQL Editor:
1. Copy migration file contents
2. Paste into SQL Editor
3. Execute

## Verification

After applying migrations, verify with:

```bash
# Run baseline schema verification
supabase db execute -f /verify_baseline_migration.sql

# Run triggers verification
supabase db execute -f /verify_triggers_migration.sql
```

Or check manually:

```sql
-- Check tables
SELECT COUNT(*) FROM information_schema.tables 
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

-- Check functions
SELECT COUNT(*) FROM information_schema.routines 
WHERE routine_schema = 'public';

-- Check triggers
SELECT COUNT(*) FROM pg_trigger 
WHERE NOT tgisinternal 
AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 
  (SELECT oid FROM pg_namespace WHERE nspname = 'public'));
```

## Documentation

For detailed information about the database schema and migrations:

- **Schema Overview:** `/BASELINE_MIGRATION_README.md`
- **Technical Details:** `/BASELINE_MIGRATION_SUMMARY.md`
- **Deployment Guide:** `/BASELINE_MIGRATION_USAGE.md`
- **Triggers Documentation:** `/TRIGGERS_MIGRATION_README.md`
- **RPC Functions Restoration:** `/RESTORE_RPC_FUNCTIONS_DEPLOYMENT.md`
- **Diagnostics:** `/supabase/diagnostics/ACTUAL_DATABASE_ANALYSIS.md`

## Migration History

This project previously had 197 individual migration files which have been consolidated into the baseline migrations for easier maintenance and fresh environment setup.
