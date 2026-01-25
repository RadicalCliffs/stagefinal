# Archived SQL Fix Files

These files have been superseded by the comprehensive migration:
`20260125200000_godlike_super_migration_fix_all_critical_rpcs.sql`

## Original Files
- `APPLY_THIS_FIX_NOW.sql` - Fixed dashboard entries, user tickets, and RLS policies
- `APPLY_TO_SUPABASE_NOW.sql` - Fixed ticket availability and competition entries

## What Was Combined
The godlike migration combines all fixes from both files plus adds:
- TEXT overload for `check_and_mark_competition_sold_out` (was missing)
- Comprehensive verification checks
- Proper transaction boundaries
- All duplicate function overload cleanup

## When to Use These
**DO NOT USE** - These files are for reference only. Use the migration file instead.

The migration is automatically applied by Supabase's migration system.
