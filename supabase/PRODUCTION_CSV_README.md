# Production Database State (CSV Exports)

This directory contains CSV exports of the **actual production Supabase database** as of **February 18, 2026**.

These files represent the source of truth for what exists in production and should be used to ensure local development environments match production.

## CSV Files

### 1. `All Functions by relevant schemas.csv` (457 lines)
- **Purpose**: Catalog of all database functions with metadata
- **Contents**: Function names, schemas, arguments, return types, language, volatility
- **Schemas**: `auth`, `public`
- **Total Functions**: 410 (406 public + 4 auth)

**Sample Row:**
```csv
schema,function,args,returns,language,kind,volatility,security_definer,leakproof,comment
public,_apply_wallet_delta,"p_canonical_user_id text, p_currency text, p_delta numeric","TABLE(balance_before numeric, balance_after numeric)",plpgsql,f,v,false,false,null
```

### 2. `All Functions.csv` (1,023 lines)
- **Purpose**: Complete DDL for all functions
- **Contents**: Full CREATE FUNCTION statements with function bodies
- **Key Field**: `ddl` column contains multi-line SQL
- **Size**: ~54 KB

**Note**: This file contains newlines within quoted fields, making it challenging to parse with standard CSV tools.

### 3. `All Indexes.csv` (101 lines)
- **Purpose**: All database indexes
- **Contents**: Index names, tables, types, DDL statements
- **Schemas**: `auth` (75 indexes), `cron` (3), `public`, system schemas
- **Sample**: Primary keys, unique constraints, btree indexes, hash indexes

**Sample Row:**
```csv
schema_name,table_name,index_name,access_method,is_primary,is_unique,is_valid,is_ready,ddl
public,balance_ledger,idx_balance_ledger_canonical_user,btree,false,false,true,true,CREATE INDEX idx_balance_ledger_canonical_user ON public.balance_ledger USING btree (canonical_user_id)
```

### 4. `All triggers.csv` (2,360 lines)
- **Purpose**: All database triggers and their functions
- **Contents**: Trigger names, tables, timing, events, trigger functions, DDL
- **Total Triggers**: 667 (87 in public, 1 in cron)
- **Size**: ~96 KB

**Key Triggers** (Public Schema):
- `AAA_CHECKTHISFIRST__AAA_balance_ledger_trg` - Balance ledger validation
- `balance_ledger_sync_wallet_trg` - Wallet synchronization
- `ensure_order_for_debit_trg` - Order creation enforcement
- `auto_allocate_paid_tickets_trg` - Automatic ticket allocation

## Production Database Statistics

| Category | Count | Details |
|----------|-------|---------|
| **Total Functions** | 410 | 406 public + 4 auth |
| **PL/pgSQL Functions** | 283 | Custom business logic |
| **SQL Functions** | 44 | Query wrappers |
| **Total Indexes** | 101 | Across all schemas |
| **Total Triggers** | 667 | 87 public + 1 cron |

## Key Business Logic Functions

### Wallet & Balance Management
- `allocate_lucky_dip_tickets*` (4 variants) - Random ticket allocation
- `apply_wallet_mutation()` - Wallet balance changes
- `apply_vrf_to_competition()` - VRF randomness for winners  
- `_apply_wallet_delta()` - Atomic balance updates
- `credit_sub_account_balance()` - Balance credit with audit trail
- `debit_sub_account_balance()` - Balance debit with locking

### Promotional Systems
- `admin_create_promotional_code()` - Create promo codes
- `admin_update_promotional_code()` - Update promo codes
- `admin_deactivate_promotional_code()` - Deactivate codes

### Auth & Identity
- `allocate_temp_canonical_user()` - Email-first signup support
- `attach_identity_after_auth()` - Post-wallet auth setup
- `upsert_canonical_user()` - Main user upsert (12 parameters)

### Data Synchronization (Triggers)
- `balance_ledger_sync_wallet` - Ledger ↔ Wallet sync
- `ensure_order_for_debit()` - Order creation for debits
- `auto_allocate_paid_tickets()` - Auto ticket allocation on payment
- `auto_complete_competition()` - Competition end logic

## How to Use These Files

### Option 1: Supabase CLI Schema Pull (Recommended)
```bash
# Pull the latest schema from production into migrations
supabase db pull
```

### Option 2: Direct SQL Execution
1. Open Supabase Studio SQL Editor
2. Copy DDL from the CSV files
3. Execute directly in production or staging

### Option 3: CSV Analysis
```bash
# Count public functions
grep "^public," All\ Functions\ by\ relevant\ schemas.csv | wc -l

# List all public indexes
grep "^public," All\ Indexes.csv | cut -d, -f3

# Find specific function
grep "upsert_canonical_user" All\ Functions\ by\ relevant\ schemas.csv
```

### Option 4: Parse with Python/Node.js
See `/scripts/generate-production-sync-migration.py` for an example CSV parser.

**Note**: Due to multi-line quoted fields in `All Functions.csv` and `All triggers.csv`, use proper CSV libraries that handle RFC 4180 format.

## Syncing Local with Production

### Full Sync
```bash
# Reset local database to match production
supabase db pull
supabase db reset
```

### Verify Sync
```sql
-- Count public functions
SELECT COUNT(*) FROM information_schema.routines 
WHERE routine_schema = 'public';
-- Should return ~406

-- Count public triggers
SELECT COUNT(*) FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'public' AND NOT t.tgisinternal;
-- Should return ~87

-- Check for missing functions
SELECT routine_name FROM information_schema.routines 
WHERE routine_schema = 'public'
ORDER BY routine_name;
```

## Important Notes

### 🔒 Read-Only Documentation
- **DO NOT** modify these CSV files
- They represent the production database state
- Changes should be made through migrations, then re-exported

### 🔄 Update Process
1. Make schema changes via migrations
2. Deploy to production
3. Re-export CSVs from production:
   ```sql
   -- Export functions
   COPY (SELECT * FROM information_schema.routines) TO '/tmp/functions.csv' WITH CSV HEADER;
   
   -- Export indexes  
   COPY (SELECT ... FROM pg_indexes) TO '/tmp/indexes.csv' WITH CSV HEADER;
   
   -- Export triggers
   COPY (SELECT ... FROM pg_trigger) TO '/tmp/triggers.csv' WITH CSV HEADER;
   ```
4. Replace old CSVs with new exports
5. Commit to repository

### 📊 CSV Format Notes
- **Encoding**: UTF-8
- **Line Endings**: May contain Windows (CRLF) or Unix (LF)
- **Quoted Fields**: DDL columns contain newlines within quotes
- **Parser**: Use CSV libraries that support RFC 4180 (multi-line fields)

### 🎯 Production Safety
- These CSVs are exported from live production
- They include all active functions, indexes, and triggers
- Use them to ensure dev/staging matches production
- Critical for debugging and schema validation

## Schemas in Production

1. **`public`** - Main application schema (406 functions, 87 triggers)
2. **`auth`** - Supabase authentication (4 functions, 75 indexes)
3. **`cron`** - PostgreSQL job scheduler (1 trigger)
4. **`net`** - HTTP extensions (1 index)
5. **`pg_catalog`** - System catalogs

## Migration Strategy

The CSV files and migration files serve different purposes:

- **CSV Files**: Represent cumulative production state (snapshot)
- **Migration Files**: Represent incremental changes (deltas)

### Relationship
```
[Initial Schema] + [Migration 1] + [Migration 2] + ... = [Production State (CSVs)]
```

### When to Use Each

**Use CSV Files When:**
- Setting up a new development environment
- Verifying production state
- Debugging schema differences
- Documentation and reference

**Use Migration Files When:**
- Making schema changes
- Deploying to production
- Rolling back changes
- Version control of schema

## Questions?

For questions about the production database schema, see:
- `/supabase/migrations/README.md` - Migration documentation
- `/ARCHITECTURE.md` - System architecture
- `/QUICK_REFERENCE.md` - Quick reference guide

---

**Last Updated**: February 18, 2026  
**Production Database**: Supabase (PostgreSQL 15)  
**Exported By**: Production database admin
