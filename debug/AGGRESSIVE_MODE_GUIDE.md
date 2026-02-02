# Aggressive Mode - Usage Guide

## Overview

Aggressive Mode is a development/staging feature that gives your frontend full control over the database. It automatically fixes schema issues on the fly, eliminating "column does not exist" and similar errors.

## Setup

### 1. Add Service Role Key to Environment

```bash
# .env or Netlify Environment Variables
VITE_SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

Get your service role key from: **Supabase Dashboard → Settings → API → service_role**

⚠️ **WARNING**: The service role key has full database access. Only use in staging/development!

### 2. Deploy the SQL Migration

Deploy the exec_sql migration to your Supabase database:

```bash
# Using Supabase CLI
supabase db push

# Or manually run the migration file:
# supabase/migrations/99999999999999_aggressive_mode_exec_sql.sql
```

### 3. Aggressive Mode Auto-Enables

Once the service key is set, aggressive mode automatically enables when your app starts. You'll see:

```
🚀 ===============================================
🚀 AGGRESSIVE MODE INITIALIZATION
🚀 ===============================================

✅ Admin credentials detected
✅ Service-level access enabled
✅ Auto-schema management active
✅ Error interception enabled
✅ Aggressive CRUD operations ready

🔥 AGGRESSIVE MODE: FULLY OPERATIONAL
🔥 Database will auto-fix all schema issues
🔥 No more "column does not exist" errors
```

## Features

### Auto-Fix Missing Tables

When you query a table that doesn't exist, it's automatically created:

```typescript
// This will create the table if it doesn't exist
const { data, error } = await omnipotentData.aggressiveSelect('my_new_table', '*');
```

### Auto-Fix Missing Columns

When you insert data with columns that don't exist, they're automatically added:

```typescript
// If 'new_field' column doesn't exist, it's added automatically
const { data, error } = await omnipotentData.aggressiveInsert('profiles', {
  id: userId,
  new_field: 'some value',
});
```

### Global Error Interception

All console errors are intercepted and fixed automatically:

```javascript
// Even if you use regular Supabase client, errors are caught and fixed
const { error } = await supabase.from('table').select('missing_column');
// ✓ Column is auto-created and operation retries
```

## Usage Examples

### Using Omnipotent Data Service

```typescript
import { omnipotentData } from './lib/omnipotent-data-service';

// Query with auto-fix
const { data, error } = await omnipotentData.aggressiveSelect(
  'competitions',
  '*',
  { status: 'active' }
);

// Insert with auto-fix
const { data, error } = await omnipotentData.aggressiveInsert(
  'profiles',
  {
    id: 'user-123',
    wallet_address: '0x...',
    custom_field: 'value', // Auto-creates column if missing
  }
);

// Update with auto-fix
const { data, error } = await omnipotentData.aggressiveUpdate(
  'profiles',
  { username: 'newname' },
  { id: 'user-123' }
);
```

### Using Aggressive Operations

Pre-built operations for common flows:

```typescript
import { aggressiveOps } from './lib/aggressive-ops';

// User operations
await aggressiveOps.upsertUser({
  id: userId,
  wallet_address: wallet,
  email: email,
});

// Balance operations
const { balance } = await aggressiveOps.getBalance(userId);
await aggressiveOps.processTopUp(userId, 100, txHash);
await aggressiveOps.processPayment(userId, 50, 'Ticket purchase');

// Ticket operations
await aggressiveOps.purchaseTickets(
  userId,
  competitionId,
  [1, 2, 3],
  30
);
```

### Using Direct CRUD

For complete control:

```typescript
import { aggressiveCRUD } from './lib/aggressive-crud';

// Direct operations with auto-fix
const { data, error } = await aggressiveCRUD.select(
  'table_name',
  'column1, column2',
  { filter_column: 'value' },
  { autoFix: true, useAdmin: true }
);

await aggressiveCRUD.insert('table_name', { data }, { autoFix: true });
await aggressiveCRUD.update('table_name', { data }, { id: 'xxx' }, { autoFix: true });
```

### Manual Schema Management

For explicit schema control:

```typescript
import { schemaManager } from './lib/aggressive-schema-manager';

// Check if table exists
const exists = await schemaManager.tableExists('my_table');

// Create table
await schemaManager.createTable({
  tableName: 'my_table',
  columns: [
    { name: 'id', type: 'UUID', defaultValue: 'gen_random_uuid()' },
    { name: 'name', type: 'TEXT' },
    { name: 'created_at', type: 'TIMESTAMPTZ', defaultValue: 'now()' },
  ],
  primaryKey: 'id',
});

// Add column
await schemaManager.addColumn('my_table', 'new_column', 'TEXT', { nullable: true });

// Drop constraint
await schemaManager.dropConstraint('my_table', 'constraint_name');

// Drop trigger
await schemaManager.dropTrigger('my_table', 'trigger_name');
```

## Common Use Cases

### 1. Sign Up Flow

```typescript
// User signs up - profile auto-created with all fields
await aggressiveOps.upsertUser({
  id: privyUserId,
  wallet_address: wallet,
  email: email,
  username: username,
});

// Balance auto-created
await aggressiveOps.getBalance(privyUserId);
```

### 2. Payment Flow

```typescript
// Top up balance (from wallet payment)
await aggressiveOps.processTopUp(
  userId,
  amount,
  transactionHash,
  { method: 'crypto', currency: 'USDC' }
);

// Purchase tickets (deduct from balance)
await aggressiveOps.purchaseTickets(
  userId,
  competitionId,
  selectedTickets,
  totalAmount
);
```

### 3. Competition Entry

```typescript
// Reserve tickets
await omnipotentData.reserveTickets(userId, competitionId, ticketNumbers);

// Confirm purchase
await aggressiveOps.purchaseTickets(userId, competitionId, ticketNumbers, amount);

// Get user entries
const entries = await omnipotentData.getUserEntries(userId);
```

## Error Handling

Aggressive mode handles these errors automatically:

- ❌ `column "xyz" does not exist` → ✅ Column created
- ❌ `table "abc" does not exist` → ✅ Table created
- ❌ `violates unique constraint` → ✅ Constraint removed (configurable)
- ❌ `duplicate key value` → ✅ Handled with upsert

## Disabling Aggressive Mode

To disable aggressive mode:

```typescript
import { omnipotentData } from './lib/omnipotent-data-service';
import { setErrorInterceptorEnabled } from './lib/error-interceptor';

// Disable in omnipotent service
omnipotentData.aggressiveMode = false;

// Disable global error interception
setErrorInterceptorEnabled(false);
```

Or remove the service key from environment variables.

## Production Transition

When moving to production:

1. **Remove service key** from environment variables
2. **Test all flows** to identify schema issues
3. **Create proper migrations** for any missing tables/columns
4. **Add proper RLS policies**
5. **Remove aggressive mode imports** from production code

## Best Practices

### ✅ DO:
- Use aggressive mode in staging/development
- Test all user flows extensively
- Document schema changes made by aggressive mode
- Create proper migrations before production

### ❌ DON'T:
- Use in production with real user data
- Rely on it for long-term schema management
- Ignore the underlying schema issues
- Deploy service key to public repositories

## Monitoring

Check console for aggressive mode activity:

```
[AggressiveOps] Upserting user { userId: '...' }
[SchemaManager] Adding column { table: 'profiles', column: 'new_field' }
[ErrorInterceptor] Auto-fixed error from console: column does not exist
[AggressiveCRUD] Operation succeeded { attempt: 2 }
```

## Troubleshooting

### Aggressive mode not working?

1. Check service key is set: `echo $VITE_SUPABASE_SERVICE_ROLE_KEY`
2. Check console for initialization message
3. Verify exec_sql function exists in database
4. Check browser console for errors

### Operations still failing?

1. Check the error message in console
2. Try manual schema fix with `schemaManager`
3. Verify service role has proper permissions
4. Check if RLS policies are interfering

### Need to reset everything?

```typescript
// Clear all caches
omnipotentData.clearCache();

// Refresh data
await omnipotentData.refresh('all');
```

## API Reference

See the following files for complete API documentation:

- `src/lib/omnipotent-data-service.ts` - Main service
- `src/lib/aggressive-crud.ts` - CRUD operations
- `src/lib/aggressive-ops.ts` - High-level operations
- `src/lib/aggressive-schema-manager.ts` - Schema management
- `src/lib/error-interceptor.ts` - Error interception
- `src/lib/supabase-admin.ts` - Admin client

## Support

For issues or questions about aggressive mode, check:
- Console logs for detailed operation info
- `databaseLogger` output for debugging
- Supabase dashboard for schema changes
