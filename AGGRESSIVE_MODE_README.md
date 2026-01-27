# Aggressive Mode - Quick Start

## What is Aggressive Mode?

Aggressive Mode gives your frontend full control over the database. When enabled, the app automatically fixes schema issues on the fly:

- ❌ `column "xyz" does not exist` → ✅ **Auto-creates column**
- ❌ `table "abc" does not exist` → ✅ **Auto-creates table**
- ❌ `violates constraint` → ✅ **Removes constraint**
- ❌ Database error blocks user → ✅ **Error fixed, user continues**

## Setup (3 Steps)

### 1. Deploy SQL Migration

```bash
./setup-aggressive-mode.sh
```

Or manually:
```bash
supabase db push
```

### 2. Add Service Key to Environment

Get your service role key from: **Supabase Dashboard → Settings → API → service_role**

```bash
# Add to .env
VITE_SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

⚠️ **WARNING**: Service role key = full database access. Staging/dev only!

### 3. Restart App

```bash
npm run dev
```

You'll see:
```
🚀 AGGRESSIVE MODE INITIALIZATION
✅ Admin credentials detected
✅ Service-level access enabled
🔥 AGGRESSIVE MODE: FULLY OPERATIONAL
```

Done! All database errors now auto-fix.

## Usage

### Option 1: Automatic (Recommended)

Just use your app normally. All errors are caught and fixed automatically:

```typescript
// This works even if table/columns don't exist
await supabase.from('my_table').insert({ new_field: 'value' });
// ✅ Table and columns auto-created
```

### Option 2: Use Omnipotent Service

```typescript
import { omnipotentData } from './lib/omnipotent-data-service';

// Query with auto-fix
const { data } = await omnipotentData.aggressiveSelect('competitions', '*');

// Insert with auto-fix
await omnipotentData.aggressiveInsert('profiles', { id, wallet });
```

### Option 3: Use Pre-Built Operations

```typescript
import { aggressiveOps } from './lib/aggressive-ops';

// User operations
await aggressiveOps.upsertUser({ id, wallet, email });

// Balance operations
await aggressiveOps.processTopUp(userId, 100, txHash);
await aggressiveOps.processPayment(userId, 50, 'Purchase');

// Ticket operations
await aggressiveOps.purchaseTickets(userId, compId, [1, 2, 3], 30);
```

## What Gets Auto-Fixed

✅ **Missing Tables**: Auto-created with basic schema  
✅ **Missing Columns**: Added with inferred type  
✅ **Schema Mismatches**: Columns added as needed  
✅ **Constraint Violations**: Blocking constraints removed  
✅ **Duplicate Keys**: Handled with upsert logic  

## Features

### 🔥 Global Error Interception

All console errors are monitored and fixed:
```javascript
console.error("column does not exist");
// ✅ Column auto-created in background
```

### 🔥 Automatic Retry

Failed operations are automatically retried after fixes:
1. Operation fails with schema error
2. Schema is fixed
3. Operation retries automatically
4. User sees success

### 🔥 Smart Type Inference

Data types are inferred from values:
```typescript
{ 
  id: '123' // → UUID or TEXT
  count: 42 // → INTEGER
  price: 9.99 // → NUMERIC
  active: true // → BOOLEAN
  metadata: {} // → JSONB
}
```

## Monitoring

Check console for activity:
```
[AggressiveOps] Upserting user { userId: '...' }
[SchemaManager] Adding column { table: 'profiles', column: 'new_field' }
[ErrorInterceptor] Auto-fixed error: column does not exist
[AggressiveCRUD] Operation succeeded { attempt: 2 }
```

## Best Practices

### ✅ DO:
- Use in staging/development environments
- Test all user flows extensively
- Document schema changes made
- Create proper migrations before production

### ❌ DON'T:
- Use in production with real users
- Deploy service key to public repos
- Ignore underlying schema issues
- Rely on this long-term

## Disabling

Remove service key from environment or:

```typescript
import { omnipotentData } from './lib/omnipotent-data-service';

omnipotentData.aggressiveMode = false;
```

## Production Transition

Before going to production:

1. ✅ Remove service key from environment
2. ✅ Test all flows to identify issues
3. ✅ Create proper migrations
4. ✅ Add RLS policies
5. ✅ Remove aggressive mode code

## Troubleshooting

### Not working?

1. Check service key is set: `echo $VITE_SUPABASE_SERVICE_ROLE_KEY`
2. Check console for initialization message
3. Verify exec_sql function deployed: Run migration again
4. Check browser console for errors

### Operations still failing?

1. Check error in console logs
2. Try manual fix: `schemaManager.addColumn('table', 'column', 'TEXT')`
3. Verify service role permissions
4. Check if RLS is interfering

### Need help?

See detailed guide: **AGGRESSIVE_MODE_GUIDE.md**

## Files

- `src/lib/supabase-admin.ts` - Admin client
- `src/lib/aggressive-schema-manager.ts` - Schema management
- `src/lib/aggressive-crud.ts` - CRUD operations
- `src/lib/aggressive-ops.ts` - High-level operations
- `src/lib/error-interceptor.ts` - Error interception
- `src/lib/init-aggressive-mode.ts` - Initialization
- `supabase/migrations/99999999999999_aggressive_mode_exec_sql.sql` - SQL migration

## Examples

See **AGGRESSIVE_MODE_GUIDE.md** for complete examples and API reference.

---

🔥 **Aggressive Mode** - Because the frontend knows best.
