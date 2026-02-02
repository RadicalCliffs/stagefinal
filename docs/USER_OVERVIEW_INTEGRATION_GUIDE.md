# User Overview Integration Guide

## Overview

The `user_overview` view provides a single source of truth for all user dashboard data. It returns one row per canonical user with all related data as JSON aggregates.

## Architecture

### Database View: `public.user_overview`

Located in: `supabase/migrations/20260202170000_create_user_overview_view.sql`

The view aggregates data from:
- `canonical_users` - Base user table (UUID and canonical_user_id)
- `competition_entries` - User's competition entries
- `tickets` - Individual tickets
- `user_transactions` - Transaction history
- `wallet_balances` - Current balances by currency
- `wallet_ledger` - Complete ledger history

All joins use `canonical_user_id` (text) as the key.

### TypeScript Types

Located in: `src/types/userOverview.ts`

Key interfaces:
- `UserOverview` - Main view row structure
- `UserOverviewEntry` - Entry aggregate item
- `UserOverviewTicket` - Ticket aggregate item
- `UserOverviewTransaction` - Transaction aggregate item
- `UserOverviewBalance` - Balance for a currency
- `UserOverviewLedger` - Ledger entry item

### Service Layer

Located in: `src/services/userOverviewService.ts`

#### Main Functions:

1. **fetchUserOverview(canonicalUserId: string)**
   - Fetches complete user data from the view
   - Returns `UserOverview | null`
   - Handles parsing of JSON fields

2. **getUserBalance(overview, currency)**
   - Extract balance for a specific currency
   - Returns `{ available, pending } | null`

3. **getTotalAvailableBalance(overview)**
   - Sum of all available balances across currencies
   - Returns `number`

4. **transformOverviewToEntries(overview)**
   - Adapter function to convert overview data to existing entry format
   - Ensures compatibility with current dashboard components

### React Hook

Located in: `src/hooks/useUserOverview.ts`

**useUserOverview(canonicalUserId, options)**

Options:
- `autoFetch` - Auto-fetch on mount (default: true)
- `refreshInterval` - Auto-refresh interval in ms (optional)
- `enabled` - Enable/disable fetching (default: true)

Returns:
- `overview` - Complete UserOverview data
- `loading` - Loading state
- `error` - Error state
- `refetch` - Manual refetch function
- `entries` - Convenience getter for entries_json
- `tickets` - Convenience getter for tickets_json
- `transactions` - Convenience getter for transactions_json
- `balances` - Convenience getter for balances_json
- `ledger` - Convenience getter for ledger_json
- `counts` - Object with all count fields
- `totals` - Object with credits/debits totals

## Usage Examples

### Basic Dashboard Component

```typescript
import { useUserOverview } from '../hooks/useUserOverview';
import { useAuthUser } from '../contexts/AuthContext';

function Dashboard() {
  const { canonicalUserId } = useAuthUser();
  const { overview, loading, error, entries, balances, counts } = useUserOverview(
    canonicalUserId,
    { refreshInterval: 30000 } // Refresh every 30 seconds
  );

  if (loading) return <Loader />;
  if (error) return <ErrorMessage error={error} />;
  if (!overview) return <NoDataMessage />;

  return (
    <div>
      <h1>My Entries ({counts.entries})</h1>
      {entries.map(entry => (
        <EntryCard 
          key={entry.entry_id} 
          competitionId={entry.competition_id}
          title={entry.competition_title}
          tickets={entry.tickets_count}
          amount={entry.amount_paid}
        />
      ))}
      
      <h2>Wallet Balance</h2>
      <p>USDC: ${balances.USDC?.available || 0}</p>
      <p>BONUS: ${balances.BONUS?.available || 0}</p>
      
      <h2>Statistics</h2>
      <p>Total Tickets: {counts.tickets}</p>
      <p>Total Transactions: {counts.transactions}</p>
    </div>
  );
}
```

### Wallet Component

```typescript
import { useUserOverview } from '../hooks/useUserOverview';
import { getUserBalance } from '../services/userOverviewService';

function WalletBalance({ canonicalUserId }) {
  const { overview, loading } = useUserOverview(canonicalUserId);

  if (loading) return <Spinner />;

  const usdcBalance = getUserBalance(overview, 'USDC');
  const bonusBalance = getUserBalance(overview, 'BONUS');

  return (
    <div>
      <div>
        <h3>USDC Balance</h3>
        <p>Available: ${usdcBalance?.available || 0}</p>
        <p>Pending: ${usdcBalance?.pending || 0}</p>
      </div>
      <div>
        <h3>Bonus Balance</h3>
        <p>Available: ${bonusBalance?.available || 0}</p>
        <p>Pending: ${bonusBalance?.pending || 0}</p>
      </div>
    </div>
  );
}
```

### Transaction History Component

```typescript
import { useUserOverview } from '../hooks/useUserOverview';

function TransactionHistory({ canonicalUserId }) {
  const { transactions, loading } = useUserOverview(canonicalUserId);

  if (loading) return <Loader />;

  return (
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Type</th>
          <th>Amount</th>
          <th>Currency</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {transactions.map(tx => (
          <tr key={tx.transaction_id}>
            <td>{new Date(tx.created_at).toLocaleDateString()}</td>
            <td>{tx.type}</td>
            <td>${tx.amount}</td>
            <td>{tx.currency}</td>
            <td>{tx.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

### Using with Existing Components

For components that already expect the old data format, use the transformer:

```typescript
import { useUserOverview } from '../hooks/useUserOverview';
import { transformOverviewToEntries } from '../services/userOverviewService';
import EntriesList from './EntriesList'; // Existing component

function EntriesContainer({ canonicalUserId }) {
  const { overview, loading } = useUserOverview(canonicalUserId);

  if (loading) return <Loader />;

  // Transform to old format for compatibility
  const entries = transformOverviewToEntries(overview);

  return <EntriesList entries={entries} />;
}
```

## Migration Strategy

### Phase 1: Parallel Operation
1. Keep existing queries working
2. Add user_overview calls alongside existing calls
3. Compare data and validate accuracy
4. Fix any discrepancies in the view

### Phase 2: Gradual Adoption
1. Update one component at a time to use user_overview
2. Test thoroughly in development
3. Monitor performance improvements

### Phase 3: Cleanup
1. Remove old query functions
2. Update documentation
3. Remove deprecated code

## Benefits

1. **Single Query** - One database call instead of multiple
2. **Consistent Data** - All data from the same snapshot
3. **Better Performance** - Reduced network overhead
4. **Easier Caching** - One endpoint to cache
5. **Simpler Code** - Less data fetching logic in components
6. **Type Safety** - Comprehensive TypeScript types

## Testing

### Manual Testing Checklist

- [ ] Verify view returns data for existing users
- [ ] Verify JSON aggregates contain correct data
- [ ] Test with users who have no entries
- [ ] Test with users who have multiple entries
- [ ] Verify balance aggregation is correct
- [ ] Verify counts match actual records
- [ ] Test real-time updates still work

### Unit Tests

```typescript
import { fetchUserOverview, getUserBalance } from './userOverviewService';

describe('userOverviewService', () => {
  it('should fetch user overview', async () => {
    const overview = await fetchUserOverview('prize:pid:0x123...');
    expect(overview).toBeDefined();
    expect(overview?.entries_json).toBeInstanceOf(Array);
  });

  it('should get balance for currency', () => {
    const mockOverview = {
      balances_json: {
        'USDC': { available: 100, pending: 50 }
      }
    };
    const balance = getUserBalance(mockOverview, 'USDC');
    expect(balance?.available).toBe(100);
    expect(balance?.pending).toBe(50);
  });
});
```

## Performance Considerations

1. **View Complexity** - The view joins multiple tables, so it may be slower than single table queries
2. **Caching** - Consider caching at the service layer or using React Query
3. **Pagination** - For users with many entries, consider pagination
4. **Real-time Updates** - Keep existing real-time subscriptions, use refetch() when data changes

## Troubleshooting

### View Returns No Data

- Verify the user exists in `canonical_users`
- Check the `canonical_user_id` format (should be "prize:pid:0x...")
- Verify joins are using correct columns

### JSON Fields Are Empty

- Check if related tables have data
- Verify foreign key relationships
- Check table permissions

### Performance Issues

- Add indexes on join columns if not present
- Consider materialized view for frequently accessed data
- Use pagination for large datasets

## Next Steps

After implementing the user_overview view, consider:

1. Adding indexes for better query performance
2. Creating a materialized view for even faster queries
3. Adding a refresh mechanism for materialized view
4. Implementing caching at the API layer
5. Adding GraphQL support for flexible querying
