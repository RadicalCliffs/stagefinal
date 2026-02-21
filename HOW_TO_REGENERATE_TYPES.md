# How to Regenerate Supabase Types

## ⚡ Quick Start (Easiest Method)

We've added an automated script that handles everything for you:

```bash
# Auto-detect connection method and regenerate types
npm run types:generate
```

The script will:
- ✅ Automatically detect your Supabase configuration
- ✅ Extract project ID from environment variables
- ✅ Generate types to the correct location
- ✅ Verify the output
- ✅ Provide next steps

## Configuration

The script uses these environment variables (in order of priority):

1. **VITE_SUPABASE_URL** - Extracts project ID from your Supabase URL (recommended)
2. **SUPABASE_PROJECT_ID** - Direct project ID
3. **DATABASE_URL** - Direct database connection string

Set one in your `.env` file or export before running:

```bash
# From your .env or .env.local
export VITE_SUPABASE_URL="https://yourproject.supabase.co"

# Then regenerate
npm run types:generate
```

## Advanced Usage

### Use Local Database

If you're running Supabase locally:

```bash
# First, start local Supabase
npx supabase start

# Then generate types from local DB
npm run types:generate -- --local
```

### Use Specific Project ID

Override auto-detection:

```bash
npm run types:generate -- --project-id your-project-id
```

### Get Help

```bash
npm run types:generate -- --help
```

## Manual Methods (If Automated Script Fails)

### Method 1: Using Connection String

If you have the database connection string:

```bash
# Set the connection string
export DATABASE_URL="postgresql://postgres:password@db.YOUR_PROJECT.supabase.co:5432/postgres"

# Generate types
npx supabase gen types typescript --db-url "$DATABASE_URL" > supabase/types.ts
```

### Method 2: Using Local Development

If you have a local Supabase setup:

```bash
# Start local Supabase
npx supabase start

# Generate types from local database
npx supabase gen types typescript --local > supabase/types.ts
```

### Method 3: Via Supabase Dashboard

1. Go to your Supabase Dashboard
2. Navigate to Settings → API
3. Scroll down to "Generate TypeScript Types"
4. Copy the generated types
5. Paste into `supabase/types.ts`

## After Regenerating Types

### Step 1: Verify the New Types

Check that missing parameters are now included:

```bash
# Check if upsert_canonical_user has all parameters
grep -A 20 "upsert_canonical_user:" supabase/types.ts
```

You should see parameters like:
- `p_first_name`
- `p_last_name`
- `p_telegram_handle`
- `p_country`

### Step 2: Test the Build

```bash
npm run build
```

If you get new TypeScript errors, it means some code was relying on the OLD (incorrect) types. This is good! Fix those errors - they represent bugs that were hiding.

### Step 3: Refactor Code Using Proper Types

Now you can remove the unnecessary `as any` casts. Use the patterns from `src/lib/supabase-helpers.ts`:

**Before:**
```typescript
const { data } = await supabase.rpc('upsert_canonical_user', {
  p_uid: uid,
  p_canonical_user_id: canonicalId,
  // ... many more params
} as any);  // <- This was necessary because types were wrong
```

**After:**
```typescript
import { callRPC } from '../lib/supabase-helpers';

const { data } = await callRPC(supabase, 'upsert_canonical_user', {
  p_uid: uid,
  p_canonical_user_id: canonicalId,
  // ... many more params - now all type-checked!
});
```

**For table queries:**
```typescript
// Before
const user = data[0] as any;

// After
import type { Row } from '../lib/supabase-helpers';
const user: Row<'canonical_users'> = data[0];
```

### Step 4: Verify Type Safety

After refactoring, you should have:
- ✅ Full IntelliSense autocomplete for RPC parameters
- ✅ Type errors if you pass wrong parameter names
- ✅ Type errors if you access non-existent properties
- ✅ Proper type inference in IDE

## Common Issues

### Issue: "Cannot find type definition file for 'node'"

Install types:
```bash
npm install --save-dev @types/node
```

### Issue: "Types don't match database"

Your local database might be different from production. Ensure you're generating types from the correct environment.

### Issue: "RPC function not found in types"

The function might be in a different schema. Check if it's in `public` schema or another schema like `auth` or `storage`.

## Updating Types Regularly

Add this to your development workflow:

```bash
# In package.json scripts:
"types:generate": "npx supabase gen types typescript --project-id YOUR_PROJECT_ID > supabase/types.ts"
```

Then run `npm run types:generate` after database migrations.

## What This Fixes

Once types are regenerated, you'll be able to remove:
- ~200+ `as any` casts on Supabase queries
- Type suppressions for RPC calls
- Property access casts
- Update/Insert operation casts

The codebase will have full type safety with minimal `as any` usage (only where genuinely necessary for Supabase's limitations).

---

**Important:** Don't regenerate types until you're ready to fix the TypeScript errors that will appear. Budget 2-4 hours for the refactoring work after regeneration.
