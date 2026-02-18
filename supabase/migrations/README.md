# Database Migrations

This directory contains the database schema migrations for ThePrize.io.

## ⚠️ Production State Reference

**IMPORTANT**: The actual production database state is documented in CSV exports located in `/supabase/`:
- `All Functions by relevant schemas.csv` - Function catalog (457 lines, 410 functions)
- `All Functions.csv` - Complete function DDL (1023 lines)
- `All Indexes.csv` - Index definitions (101 lines)
- `All triggers.csv` - Trigger definitions (2360 lines, 667 triggers)

These CSV files represent the **source of truth** for what exists in production.  
See `/supabase/PRODUCTION_CSV_README.md` for details.

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

### Canonical User Management (2026-01-28, 2026-02-01)

User identity and authentication functions:

5. **`20260128054900_fix_upsert_canonical_user.sql`** - Core canonical user RPC
   - `upsert_canonical_user` - Main user upsert function
   - **Signature:** 12 parameters including `p_wallet_linked BOOLEAN DEFAULT FALSE`
   - Returns JSONB with user_id, canonical_user_id, is_new_user, wallet_linked
   - Client-facing RPC called from frontend (AuthContext, NewAuthModal, BaseWalletAuthModal)

6. **`20260201164500_add_temp_user_placeholder_support.sql`** - Email-first auth support
   - `allocate_temp_canonical_user` - Generates temporary placeholder IDs (prize:pid:temp<N>)
   - Updated `upsert_canonical_user` to handle placeholder replacement on wallet connection
   - **Important:** Uses `p_wallet_linked BOOLEAN` to match client calls
   - Trigger updates to preserve placeholder format

7. **`20260201170000_remove_util_upsert_canonical_user_collision.sql`** - Schema safety
   - Renames `util.upsert_canonical_user` to `util.upsert_canonical_user_from_auth`
   - Prevents search_path ambiguity between util and public schemas
   - Idempotent: only acts if util function exists

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

- **Production State:** `/supabase/PRODUCTION_CSV_README.md` - CSV exports from production
- **Schema Overview:** `/BASELINE_MIGRATION_README.md`
- **Technical Details:** `/BASELINE_MIGRATION_SUMMARY.md`
- **Deployment Guide:** `/BASELINE_MIGRATION_USAGE.md`
- **Triggers Documentation:** `/TRIGGERS_MIGRATION_README.md`
- **RPC Functions Restoration:** `/RESTORE_RPC_FUNCTIONS_DEPLOYMENT.md`
- **Diagnostics:** `/supabase/diagnostics/ACTUAL_DATABASE_ANALYSIS.md`

## Production Schema Validation

To verify that your local database matches production:

```bash
# Run validation script
python3 scripts/validate-schema.py

# Or manually check counts
supabase db execute "SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = 'public';"
# Should return ~406
```

The production database state (as of 2026-02-18):
- **Functions**: 410 total (406 public + 4 auth)
- **Indexes**: 101 total
- **Triggers**: 667 total (87 public + 1 cron)

See `/supabase/*.csv` files for complete production schema.

## Migration History

This project previously had 197 individual migration files which have been consolidated into the baseline migrations for easier maintenance and fresh environment setup.
