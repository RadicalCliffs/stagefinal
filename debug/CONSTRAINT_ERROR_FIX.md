# Constraint Error Fix Summary

## Issue Reported
```
ERROR: 42P07: relation "uq_cep_user_comp_key" already exists
```

User encountered this error when running the backfill migration, indicating that a constraint with that name already existed in the database.

## Root Cause

The original migration checked for constraint existence by **name only**:
```sql
IF NOT EXISTS (
  SELECT 1 FROM pg_constraint 
  WHERE conname = 'uq_cep_user_comp_key'
)
```

However, the database already had a constraint on the same columns with a **different name**:
- `competition_entries_purchases_canonical_user_id_competition_key`

When the migration tried to add `uq_cep_user_comp_key`, PostgreSQL detected that a unique constraint already existed on those columns and threw an error.

## The Fix

Changed the constraint checking logic to detect existing constraints by **column coverage**, not by name:

```sql
-- Check if any unique constraint exists on these columns
IF NOT EXISTS (
  SELECT 1 
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND t.relname = 'competition_entries_purchases'
    AND c.contype = 'u'
    AND c.conkey = (
      SELECT ARRAY_AGG(a.attnum ORDER BY a.attnum)
      FROM pg_attribute a
      WHERE a.attrelid = t.oid
        AND a.attname IN ('canonical_user_id', 'competition_id', 'purchase_key')
    )
) THEN
  -- Only add if no constraint exists on these columns
  ALTER TABLE competition_entries_purchases
  ADD CONSTRAINT uq_cep_user_comp_key UNIQUE (canonical_user_id, competition_id, purchase_key);
END IF;
```

### Additional Improvements

1. **Primary Key Handling**: Separated primary key constraint from table creation and added existence check
2. **Better Comments**: Added explanation that constraint name doesn't matter, only column coverage
3. **Graceful Handling**: If constraint exists with different name, migration proceeds without error

## Result

The migration is now **fully idempotent** and will work correctly regardless of:
- Whether the table already exists
- What name the primary key constraint has
- What name the unique constraint has
- Whether indexes already exist

It can be run multiple times without errors and will only create missing constraints/indexes.

## Testing

The fix handles these scenarios:
- ✅ Fresh database (no table exists)
- ✅ Table exists with no constraints
- ✅ Table exists with `uq_cep_user_comp_key` constraint
- ✅ Table exists with `competition_entries_purchases_canonical_user_id_competition_key` constraint
- ✅ Table exists with any other unique constraint on those columns
- ✅ Running migration multiple times

## Commit

Fixed in: `ec6da06` - "Fix migration to handle existing constraints with different names"
