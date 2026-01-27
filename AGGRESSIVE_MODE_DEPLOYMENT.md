# Aggressive Mode - Deployment Checklist

## Initial Setup (Staging/Development)

### Prerequisites
- [ ] Supabase project created
- [ ] Supabase CLI installed (`npm install -g supabase`)
- [ ] Project linked to Supabase (`supabase link`)

### Deployment Steps

#### 1. Deploy SQL Migration
```bash
./setup-aggressive-mode.sh
```
Or manually:
```bash
supabase db push
```

**Verify**: Check Supabase Dashboard → Database → Functions → exec_sql exists

#### 2. Get Service Role Key
1. Go to Supabase Dashboard
2. Navigate to Settings → API
3. Copy the `service_role` key (NOT anon key)

**⚠️ WARNING**: This key has FULL database access. Keep it secret!

#### 3. Add to Environment
```bash
# Local development (.env)
VITE_SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Netlify (Site settings → Environment variables)
VITE_SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

#### 4. Test Installation
```bash
npm run dev
```

Look for in console:
```
🚀 AGGRESSIVE MODE INITIALIZATION
✅ Admin credentials detected
✅ Service-level access enabled
🔥 AGGRESSIVE MODE: FULLY OPERATIONAL
```

If you see this, you're good to go! ✅

## Verification Checklist

### Test Basic Operations

#### Test 1: Auto-Create Column
```typescript
// In browser console
const { data, error } = await supabase
  .from('profiles')
  .insert({ id: 'test-123', test_field: 'value' });

console.log('Error:', error); // Should be null
console.log('Data:', data); // Should have test_field
```

**Expected**: Column `test_field` auto-created, no error

#### Test 2: Check Console
Look for:
```
[SchemaManager] Adding column { table: 'profiles', column: 'test_field' }
[AggressiveCRUD] Operation succeeded
```

#### Test 3: Use High-Level Ops
```typescript
import { aggressiveOps } from './lib/aggressive-ops';

// Should work even if balance table doesn't exist
const result = await aggressiveOps.getBalance('user-123');
console.log('Balance:', result);
```

**Expected**: Balance created if missing, no errors

### Troubleshooting

#### Aggressive mode not enabling?
- [ ] Service key is set: `echo $VITE_SUPABASE_SERVICE_ROLE_KEY`
- [ ] App was restarted after adding key
- [ ] No typos in environment variable name
- [ ] Key starts with `eyJ...` (JWT format)

#### SQL migration failed?
- [ ] Supabase CLI is up to date
- [ ] Project is linked correctly
- [ ] You have admin access to Supabase project
- [ ] Try manual SQL: Run migration file contents in SQL editor

#### Operations still failing?
- [ ] Check browser console for errors
- [ ] Verify exec_sql function exists in Supabase
- [ ] Check service role has proper permissions
- [ ] Look for RLS policies interfering

## Usage Examples

### User Sign-Up Flow
```typescript
import { aggressiveOps } from './lib/aggressive-ops';

// Auto-creates profile and balance if tables don't exist
await aggressiveOps.upsertUser({
  id: userId,
  wallet_address: wallet,
  email: email,
});

const { balance } = await aggressiveOps.getBalance(userId);
```

### Payment Flow
```typescript
// Top up from wallet
await aggressiveOps.processTopUp(userId, 100, txHash);

// Purchase tickets (deducts from balance)
await aggressiveOps.purchaseTickets(
  userId,
  competitionId,
  [1, 2, 3],
  30
);
```

### Direct Database Operations
```typescript
import { omnipotentData } from './lib/omnipotent-data-service';

// Query with auto-fix
const { data } = await omnipotentData.aggressiveSelect(
  'competitions',
  '*',
  { status: 'active' }
);

// Insert with auto-fix
await omnipotentData.aggressiveInsert('entries', {
  id: entryId,
  user_id: userId,
  competition_id: compId,
});
```

## Monitoring

### Console Messages to Watch For

✅ **Good Signs**:
```
[AggressiveOps] Upserting user { userId: '...' }
[SchemaManager] Table created successfully
[SchemaManager] Column added successfully
[AggressiveCRUD] Operation succeeded
```

⚠️ **Warnings** (usually OK):
```
[SchemaManager] Table already exists
[SchemaManager] Column already exists
```

❌ **Errors** (need attention):
```
[SchemaManager] Failed to create table
[AggressiveCRUD] All retry attempts exhausted
[ErrorInterceptor] Could not auto-fix error
```

## Production Preparation

### Before Going Live

1. **Test All Flows**
   - [ ] User registration
   - [ ] Login/authentication
   - [ ] Balance top-up
   - [ ] Ticket purchase
   - [ ] Payment processing
   - [ ] Profile updates

2. **Document Schema Changes**
   - [ ] List all tables created by aggressive mode
   - [ ] List all columns added by aggressive mode
   - [ ] Review table structures
   - [ ] Check for any weird data types

3. **Create Proper Migrations**
   - [ ] Create migration for each table
   - [ ] Add proper column types (not just TEXT)
   - [ ] Add indexes where needed
   - [ ] Add foreign key constraints

4. **Add RLS Policies**
   - [ ] Enable RLS on all tables
   - [ ] Add SELECT policies
   - [ ] Add INSERT policies
   - [ ] Add UPDATE policies
   - [ ] Add DELETE policies

5. **Remove Aggressive Mode**
   - [ ] Remove service key from environment
   - [ ] Test all flows still work
   - [ ] Verify proper error handling
   - [ ] Check RLS policies work correctly

### Production Deployment Checklist

- [ ] Service key REMOVED from all environments
- [ ] All tables have proper schema
- [ ] All tables have RLS policies
- [ ] All migrations are in version control
- [ ] No aggressive mode code in production build
- [ ] Error handling works without auto-fix
- [ ] All user flows tested thoroughly

## Rollback Plan

If something goes wrong:

1. **Disable Aggressive Mode**
   ```bash
   # Remove from .env
   # VITE_SUPABASE_SERVICE_ROLE_KEY=...
   ```

2. **Restart App**
   ```bash
   npm run dev
   ```

3. **Check Console**
   Should see:
   ```
   ⚠️  Admin credentials not found
   ⚠️  Falling back to standard mode
   ```

4. **Revert Netlify Environment**
   - Go to Netlify → Site settings → Environment variables
   - Delete VITE_SUPABASE_SERVICE_ROLE_KEY
   - Trigger new deploy

## Support

### Documentation
- Quick Start: `AGGRESSIVE_MODE_README.md`
- Complete Guide: `AGGRESSIVE_MODE_GUIDE.md`

### Common Issues
See Troubleshooting section in `AGGRESSIVE_MODE_README.md`

### Files to Check
- `src/lib/supabase-admin.ts` - Admin client
- `src/lib/aggressive-schema-manager.ts` - Schema fixes
- `src/lib/error-interceptor.ts` - Error catching
- `src/lib/init-aggressive-mode.ts` - Initialization

---

✅ **Follow this checklist for smooth aggressive mode deployment**
