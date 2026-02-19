# Documentation Index

**Last Updated:** 2026-02-19

This repository has been cleaned up from **388 markdown files to 124 files** (68% reduction).
All contradictions in schema documentation have been resolved.

## Essential Documentation

### Root Level (13 files)
- **README.md** - Main repository README
- **ARCHITECTURE.md** - System architecture overview
- **QUICK_REFERENCE.md** - Quick reference guide
- **QUICK_START.md** - Getting started guide
- **EDGE_FUNCTION_DEPLOYMENT_GUIDE.md** - Edge function deployment
- **FRONTEND_DATABASE_ALIGNMENT.md** - Frontend/database alignment guide
- **COMMERCE_MODERN_FIDELITY.md** - Commerce system documentation
- **SECURITY_REVIEW.md** - Security review and guidelines
- **TESTING_GUIDE_999_LIMIT.md** - Testing guide for 999 limit
- Other operational guides

### Schema Documentation (Authoritative Source)
- **debug/PAYMENT_DATABASE_SCHEMA.md** - PRIMARY schema reference
  - Contains accurate `user_transactions` schema
  - Contains accurate `joincompetition` schema
  - All column types verified against actual migrations
  - Includes `canonical_user_id` fields
  - Correctly shows `order_id` as TEXT type

### Debug Directory (55 files)
Contains active debugging documentation, investigation notes, and technical details.
Key files:
- `README.md` - Debug directory overview
- `PAYMENT_DATABASE_SCHEMA.md` - Schema reference
- Various SQL scripts and debugging tools

### Archive Directory (13 files)
Contains historical documentation for reference.
Mostly superseded by current documentation.

### Docs Directory
Contains additional guides and references organized by topic.

## Removed Contradictions

### Schema Fixes
1. ✅ `user_transactions.order_id` - Corrected from UUID to TEXT across all docs
2. ✅ `user_transactions.canonical_user_id` - Added to all schema docs
3. ✅ `joincompetition.competitionid` - Corrected from UUID to TEXT
4. ✅ `joincompetition.payment_provider` - Added to schema docs

### Deleted Files (264 total)
- 78 files in Phase 1 (schema contradictions, root summaries)
- 119 files in Phase 2 (debug redundancies)
- 67 files in Phase 3 (archive cleanup)

## Migration History

All database migrations are in `supabase/migrations/`:
- Baseline migration: `0000000_baseline_migration`
- Recent migrations track schema changes
- Migration `20260219000100_cleanup_duplicate_transactions.sql` correctly uses `jc.uid::TEXT`

## Best Practices

1. **Schema Changes**: Update `debug/PAYMENT_DATABASE_SCHEMA.md` as the single source of truth
2. **New Documentation**: Avoid creating redundant summary/fix files
3. **Archive Old Docs**: Move outdated docs to `docs/archive/` instead of deleting
4. **Verify Migrations**: Always check actual SQL migrations, not just documentation
