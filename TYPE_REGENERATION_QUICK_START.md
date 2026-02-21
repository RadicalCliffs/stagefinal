# Supabase Type Regeneration - Quick Reference

## What This Does

Regenerates TypeScript type definitions from your Supabase database schema. This ensures your code has accurate types that match your actual database.

## When to Run

Run `npm run types:generate` whenever:

- ✅ You add/modify database tables or columns
- ✅ You add/modify RPC functions
- ✅ You change function parameters or return types
- ✅ You see TypeScript errors about missing properties
- ✅ After applying database migrations

## How to Use

### Step 1: Configure

Add your Supabase URL to `.env` or `.env.local`:

```bash
VITE_SUPABASE_URL=https://yourproject.supabase.co
```

You can find this in:
- Supabase Dashboard → Project Settings → API → Project URL

### Step 2: Regenerate

```bash
npm run types:generate
```

### Step 3: Fix TypeScript Errors

After regenerating, run:

```bash
npm run build
```

If you see new TypeScript errors, **this is good!** It means:
1. Your types are now accurate
2. The errors reveal real bugs in the code
3. Fix them to make your code type-safe

See `TYPESCRIPT_TYPE_ANALYSIS.md` for refactoring patterns.

## Common Scenarios

### Scenario 1: Local Development

```bash
# Start local Supabase
npx supabase start

# Generate from local database
npm run types:generate -- --local
```

### Scenario 2: Production Database

```bash
# Set production URL
export VITE_SUPABASE_URL=https://yourproject.supabase.co

# Generate from production
npm run types:generate
```

### Scenario 3: Specific Project

```bash
npm run types:generate -- --project-id abc123xyz
```

## Troubleshooting

### "No connection method specified"

**Fix:** Add `VITE_SUPABASE_URL` to your `.env` file.

Example `.env`:
```
VITE_SUPABASE_URL=https://mthwfldcjvpxjtmrqkqm.supabase.co
```

### "Local Supabase is not running"

**Fix:** Start local Supabase first:
```bash
npx supabase start
npm run types:generate -- --local
```

### "Generated types file seems too small"

**Possible causes:**
- Wrong project ID
- Database connection failed
- Authentication issue

**Fix:** Check the error messages and verify your configuration.

### "Permission denied"

**Fix:** Make sure the script is executable:
```bash
chmod +x scripts/regenerate-types.sh
```

## What Gets Updated

The script updates:
- ✅ `supabase/types.ts` - All TypeScript type definitions

This file includes:
- Table row types
- Insert types
- Update types
- RPC function signatures
- Enum types
- View types

## Integration with CI/CD

You can add type generation to your CI pipeline:

```yaml
# .github/workflows/ci.yml
- name: Regenerate Types
  run: npm run types:generate
  env:
    VITE_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}

- name: Check for Type Changes
  run: |
    if git diff --exit-code supabase/types.ts; then
      echo "Types are up to date"
    else
      echo "Types have changed - please commit the updated types.ts"
      exit 1
    fi
```

## Advanced Options

See `HOW_TO_REGENERATE_TYPES.md` for:
- Direct database connection strings
- Multiple environment configuration
- Manual regeneration methods
- Detailed troubleshooting

## Questions?

- Read: `TYPESCRIPT_TYPE_ANALYSIS.md` - Why types are important
- Read: `HOW_TO_REGENERATE_TYPES.md` - Detailed instructions
- Check: `scripts/regenerate-types.sh` - The actual script

---

**Quick Command Reference:**

```bash
# Most common: Auto-detect and regenerate
npm run types:generate

# Local development
npm run types:generate -- --local

# Specific project
npm run types:generate -- --project-id YOUR_ID

# Get help
npm run types:generate -- --help
```
