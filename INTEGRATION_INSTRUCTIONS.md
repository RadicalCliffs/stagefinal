# User Overview Integration - What You Need to Know

## 🎯 What Has Been Done

I've created a complete infrastructure for using the `public.user_overview` view in your dashboard:

### 1. Database View
- **File**: `supabase/migrations/20260202170000_create_user_overview_view.sql`
- **What it does**: Creates a view that aggregates all user data (entries, tickets, transactions, balances, ledger) into a single row per user
- **Key columns**: 
  - `canonical_user_id` - Used to filter for specific users
  - `entries_json`, `tickets_json`, `transactions_json`, `balances_json`, `ledger_json` - JSON aggregates
  - `entries_count`, `tickets_count`, etc. - Counts for quick reference
  - `total_credits`, `total_debits` - Financial totals

### 2. TypeScript Types
- **File**: `src/types/userOverview.ts`
- **What it does**: Provides type-safe interfaces for the view data
- **Main types**: `UserOverview`, `UserOverviewEntry`, `UserOverviewBalance`, etc.

### 3. Service Layer
- **File**: `src/services/userOverviewService.ts`
- **Key functions**:
  - `fetchUserOverview(canonicalUserId)` - Fetch all user data
  - `getUserBalance(overview, currency)` - Get balance for a specific currency
  - `transformOverviewToEntries(overview)` - Convert to existing entry format

### 4. React Hook
- **File**: `src/hooks/useUserOverview.ts`
- **Usage**: `const { overview, loading, entries, balances } = useUserOverview(canonicalUserId)`
- **Features**: Auto-fetch, auto-refresh, convenience getters

### 5. Documentation
- **File**: `docs/USER_OVERVIEW_INTEGRATION_GUIDE.md`
- **Contents**: Complete guide with examples, migration strategy, and best practices

### 6. Example Components
- **File**: `src/components/ExampleUserDashboard.tsx` - Full dashboard example
- **File**: `src/components/UserDashboard/UserDashboardOverview.tsx` - Integration wrapper

### 7. Test Script
- **File**: `supabase/migrations/test_user_overview_view.sql`
- **Purpose**: Verify the view is working correctly

## 🚀 What You Need to Do

### Step 1: Apply the Database Migration

Run the migration to create the view:

```bash
# If using Supabase CLI
supabase db push

# Or apply directly in Supabase Studio SQL Editor
# Copy contents of: supabase/migrations/20260202170000_create_user_overview_view.sql
```

### Step 2: Verify the View Works

Run the test script to check if data is being returned:

```bash
# In Supabase Studio SQL Editor, run:
# supabase/migrations/test_user_overview_view.sql
```

Expected output:
- View exists in `public` schema
- Sample data shows JSON arrays/objects
- Counts match actual records

### Step 3: Test with a Real User

Try fetching data for an actual user:

```typescript
import { fetchUserOverview } from './src/services/userOverviewService';

// Replace with real canonical_user_id from your database
const overview = await fetchUserOverview('prize:pid:0x...');
console.log('Entries:', overview?.entries_json);
console.log('Balance:', overview?.balances_json);
```

### Step 4: Integrate into Dashboard Components

Choose your integration approach:

#### Option A: Gradual Integration (Recommended)

1. Start with one component (e.g., UserMiniProfile)
2. Use the hook: `const { overview } = useUserOverview(canonicalUserId)`
3. Replace existing data fetching with data from `overview`
4. Test thoroughly
5. Move to next component

#### Option B: Wrapper Approach

1. Use `UserDashboardOverview` component as a wrapper
2. Pass `overview` data as props to child components
3. Update child components to accept `overview` prop
4. Remove individual data fetching

### Step 5: Update Specific Components

Here's what needs to be updated in each main component:

#### EntriesList
```typescript
// Current approach:
const data = await database.getUserEntriesFromCompetitionEntries(canonicalUserId);

// New approach:
const { entries } = useUserOverview(canonicalUserId);
const formattedEntries = transformOverviewToEntries({ entries_json: entries });
```

#### UserMiniProfile
```typescript
// Current approach:
const { totalTickets, walletBalance } = await userDataService.getUserAggregatedData(userId);

// New approach:
const { overview, counts, balances } = useUserOverview(canonicalUserId);
const totalTickets = counts.tickets;
const walletBalance = balances.USDC?.available || 0;
```

#### Wallet/Balance Components
```typescript
// Current approach:
const balance = await fetchUserBalance(userId);

// New approach:
const { balances } = useUserOverview(canonicalUserId);
const usdcBalance = balances.USDC?.available || 0;
```

#### Orders/Transactions
```typescript
// Current approach:
const transactions = await fetchUserTransactions(userId);

// New approach:
const { transactions } = useUserOverview(canonicalUserId);
```

## 🔍 Important Notes

### View Data Structure

The view returns data like this:

```json
{
  "canonical_user_id": "prize:pid:0x...",
  "entries_json": [
    {
      "entry_id": "uuid",
      "competition_id": "uuid",
      "competition_title": "Win a Tesla",
      "amount_paid": 10.00,
      "tickets_count": 5,
      "ticket_numbers_csv": "1,5,12,23,45",
      "created_at": "2026-01-15T12:00:00Z"
    }
  ],
  "balances_json": {
    "USDC": { "available": 100.00, "pending": 0 },
    "BONUS": { "available": 50.00, "pending": 0 }
  },
  "entries_count": 1,
  "tickets_count": 5,
  ...
}
```

### Real-time Updates

The view itself is not real-time, but you can:

1. Keep existing real-time subscriptions
2. Call `refetch()` from the hook when real-time events occur
3. Use `refreshInterval` option for auto-refresh

Example:
```typescript
const { refetch } = useUserOverview(canonicalUserId);

// In your real-time subscription:
supabase.channel('entries').on('INSERT', () => {
  refetch(); // Refresh the view data
}).subscribe();
```

### Performance Considerations

- The view joins multiple tables, so it's comprehensive but may be slower than single-table queries
- Consider caching at the application level
- For very large datasets, you may want to add pagination to the view
- The view is optimized for "get all data for one user" use cases

## 📋 Verification Checklist

After integration, verify:

- [ ] View returns data for existing users
- [ ] All JSON fields contain expected data
- [ ] Counts match actual records in database
- [ ] Balance aggregation is correct
- [ ] Dashboard displays data correctly
- [ ] Real-time updates still work (after refetch)
- [ ] No performance degradation
- [ ] Error handling works properly

## 🆘 Troubleshooting

### View Returns No Data

**Check**: Does the user exist in `canonical_users`?
```sql
SELECT * FROM canonical_users WHERE canonical_user_id = 'prize:pid:0x...';
```

**Check**: Do related tables have data?
```sql
SELECT COUNT(*) FROM competition_entries WHERE canonical_user_id = 'prize:pid:0x...';
SELECT COUNT(*) FROM tickets WHERE canonical_user_id = 'prize:pid:0x...';
```

### JSON Fields Are Empty Arrays

This is normal if the user has no data in those tables. The view uses `FILTER (WHERE ... IS NOT NULL)` to return empty arrays instead of NULL.

### Type Errors in TypeScript

Make sure you're importing types:
```typescript
import type { UserOverview } from '../types/userOverview';
```

### Performance Issues

Add indexes if needed:
```sql
CREATE INDEX IF NOT EXISTS idx_competition_entries_canonical_user_id 
ON competition_entries(canonical_user_id);

CREATE INDEX IF NOT EXISTS idx_tickets_canonical_user_id 
ON tickets(canonical_user_id);
```

## 📞 Need Help?

If you run into issues:

1. Check the test script output: `supabase/migrations/test_user_overview_view.sql`
2. Review examples in: `docs/USER_OVERVIEW_INTEGRATION_GUIDE.md`
3. Look at: `src/components/ExampleUserDashboard.tsx` for complete usage
4. Verify permissions: View should be accessible by `authenticated` and `anon` roles

## 🎓 Next Steps

Once the basic integration is working:

1. Consider creating a materialized view for better performance
2. Add caching at the API/service layer
3. Implement pagination for large datasets
4. Add more helper functions as needed
5. Update tests to use the new view

## Summary

You now have all the pieces needed to integrate the `user_overview` view. The main tasks remaining are:

1. ✅ Apply the database migration
2. ✅ Test with real data
3. ✅ Update dashboard components one by one
4. ✅ Verify everything works
5. ✅ Remove old query code (optional)

The hardest part is done - you have the infrastructure. Now it's just about connecting the pieces!
