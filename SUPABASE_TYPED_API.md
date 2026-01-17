# Type-Safe Supabase Operations

This document describes the type-safe Supabase API wrappers available in this project for working with competition entries, ticket reservations, and purchases.

## Overview

The project uses **Vite + React + Netlify** for deployment. All Supabase operations are now fully typed using TypeScript for compile-time safety.

## Environment Setup

### Local Development

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Fill in your Supabase credentials:
   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your_anon_key_here
   ```

3. Restart the dev server after editing `.env`:
   ```bash
   npm run dev
   ```

### Netlify Deployment

1. Go to **Site settings → Environment variables**
2. Add the following variables:
   - `VITE_SUPABASE_URL` = `https://your-project.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = `your_anon_key`
3. Redeploy the site

**Important Notes:**
- Vite only exposes variables prefixed with `VITE_` at build time
- Use `import.meta.env.VITE_*` in code, **NOT** `process.env.*`
- Always restart the dev server after editing `.env`

## Regenerating Types

After pulling new Supabase migrations, regenerate the TypeScript types:

```bash
# Using project ID
npx supabase gen types typescript --project-id YOUR_PROJECT_ID > supabase/types.ts

# Using DB URL (alternative)
SUPABASE_DB_URL="postgresql://..." npx supabase gen types typescript --db-url "$SUPABASE_DB_URL" > supabase/types.ts
```

Commit the updated `supabase/types.ts` so Netlify has the correct types during build.

## Available APIs

All type-safe wrappers are available in `src/lib/supabase-typed.ts`.

### Import

```typescript
import {
  // View queries
  getActiveEntriesByUser,
  getActiveEntriesByCompetition,
  
  // RPC functions
  reserveTickets,
  finalizeOrder,
  releaseReservation,
  getUnavailableTickets,
  getUserTicketsForCompetition,
  
  // Convenience functions
  purchaseTicketsWithBalance,
  
  // Types
  type ActiveEntry,
  type ReserveTicketsReturn,
  type FinalizeOrderReturn,
} from '@/lib/supabase-typed';
```

### View: `v_joincompetition_active`

A stable read interface for active competition entries that provides consistent access using canonical identifiers.

#### Get Active Entries by User

```typescript
// Fetch entries for a user (by canonical ID or wallet address)
const entries = await getActiveEntriesByUser(userIdentifier);

// Example with canonical user ID
const entries1 = await getActiveEntriesByUser('prize:pid:0xabc...');

// Example with wallet address
const entries2 = await getActiveEntriesByUser('0xabc...');
```

#### Get Active Entries by Competition

```typescript
// Fetch all entries for a competition
const entries = await getActiveEntriesByCompetition(competitionUid);
```

**Return Type:**
```typescript
type ActiveEntry = {
  id: string | null;
  uid: string | null;
  userid: string | null;
  walletaddress: string | null;
  competitionid: string | null;
  numberoftickets: number | null;
  ticketnumbers: string | null;
  amountspent: string | null;
  purchasedate: string | null;
  buytime: string | null;
  transactionhash: string | null;
  chain: string | null;
  created_at: string | null;
  competition_title: string | null;
  competition_status: string | null;
  competition_draw_date: string | null;
}
```

### RPC: `reserve_tickets`

Creates a temporary ticket reservation that holds specific ticket numbers for a limited time.

**Note:** This wrapper assumes a `reserve_tickets` RPC function exists in the database. If you're currently using the `reserve_tickets` edge function instead, you may need to either:
1. Create a matching RPC function in a migration, or
2. Update this wrapper to call `supabase.functions.invoke('reserve-tickets', ...)` instead

```typescript
const reservation = await reserveTickets({
  competitionId: 'competition-uuid',
  ticketNumbers: [1, 2, 3, 42],
  userIdentifier: 'prize:pid:0xabc...',
  holdMinutes: 15, // Optional, defaults to 15
});

if (reservation.reservation_id) {
  console.log('Reserved:', reservation.reservation_id);
} else {
  console.error('Reservation failed:', reservation.error);
}
```

### RPC: `finalize_order`

Atomically finalizes a ticket reservation by deducting wallet balance and creating order records.

```typescript
const result = await finalizeOrder({
  reservationId: reservation.reservation_id,
  userIdentifier: 'prize:pid:0xabc...',
  competitionId: 'competition-uuid',
  unitPrice: 5.0, // Price per ticket
});

if (result.success) {
  console.log('Order ID:', result.order_id);
  console.log('Amount charged:', result.amount_charged);
  console.log('Remaining balance:', result.remaining_balance);
} else {
  console.error('Finalization failed:', result.error);
}
```

### RPC: `release_reservation`

Cancels a pending reservation, making tickets available again.

```typescript
const result = await releaseReservation({
  reservationId: reservation.reservation_id,
  userIdentifier: 'prize:pid:0xabc...',
});

if (result.success) {
  console.log('Reservation cancelled');
}
```

### RPC: `get_unavailable_tickets`

Returns an array of ticket numbers that are already sold or reserved.

```typescript
const unavailable = await getUnavailableTickets(competitionId);
// Returns: [1, 5, 7, 10, ...] - array of unavailable ticket numbers
```

### RPC: `get_user_tickets_for_competition`

Gets detailed information about a user's tickets for a specific competition.

```typescript
const tickets = await getUserTicketsForCompetition(
  competitionId,
  userIdentifier
);

// Each ticket has:
// - ticket_number: number
// - source: string
// - purchased_at: string
// - wallet_address: string
```

### End-to-End Purchase Flow

A convenience function that combines reserve → finalize in one call:

```typescript
try {
  const result = await purchaseTicketsWithBalance({
    competitionId: 'competition-uuid',
    ticketNumbers: [1, 2, 3],
    unitPrice: 5.0,
    userIdentifier: 'prize:pid:0xabc...',
  });

  if (result.success) {
    console.log('Purchase successful!');
    console.log('Order ID:', result.order_id);
    console.log('Tickets:', result.ticket_count);
    console.log('Amount charged:', result.amount_charged);
  }
} catch (error) {
  console.error('Purchase failed:', error);
}
```

## Usage in React Components

### Example: Buy Button Component

```typescript
import { useState } from 'react';
import { purchaseTicketsWithBalance } from '@/lib/supabase-typed';

export function BuyButton({
  competitionId,
  ticketNumbers,
  unitPrice,
  userIdentifier,
}: {
  competitionId: string;
  ticketNumbers: number[];
  unitPrice: number;
  userIdentifier: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onBuy = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await purchaseTicketsWithBalance({
        competitionId,
        ticketNumbers,
        unitPrice,
        userIdentifier,
      });
      
      // Success - show receipt, refresh entries, etc.
      console.log('Order finalized:', result);
    } catch (e: any) {
      setError(e?.message ?? 'Purchase failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button onClick={onBuy} disabled={loading}>
        {loading ? 'Processing…' : 'Buy'}
      </button>
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}
```

### Example: User Entries Display

```typescript
import { useEffect, useState } from 'react';
import { getActiveEntriesByUser, type ActiveEntry } from '@/lib/supabase-typed';

export function UserEntries({ userIdentifier }: { userIdentifier: string }) {
  const [entries, setEntries] = useState<ActiveEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadEntries() {
      try {
        const data = await getActiveEntriesByUser(userIdentifier);
        setEntries(data);
      } catch (error) {
        console.error('Failed to load entries:', error);
      } finally {
        setLoading(false);
      }
    }

    loadEntries();
  }, [userIdentifier]);

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h2>Your Active Entries</h2>
      {entries.map((entry) => (
        <div key={entry.uid}>
          <h3>{entry.competition_title}</h3>
          <p>Tickets: {entry.numberoftickets}</p>
          <p>Amount: ${entry.amountspent}</p>
        </div>
      ))}
    </div>
  );
}
```

## Real-Time Updates

For real-time updates, use Supabase Realtime with broadcast channels:

1. Subscribe to a per-competition or per-user topic using Realtime broadcast
2. On broadcast event, refetch data from `v_joincompetition_active` view
3. Use **broadcast with private channels** and RLS for security
4. Avoid `postgres_changes` for new apps - use broadcast instead

```typescript
// Example: Subscribe to competition updates
const channel = supabase.channel(`competition:${competitionId}`)
  .on('broadcast', { event: 'entry_added' }, (payload) => {
    // Refetch entries when someone purchases tickets
    getActiveEntriesByCompetition(competitionId).then(setEntries);
  })
  .subscribe();
```

## Common Pitfalls

### ❌ Using `process.env` in Vite

```typescript
// DON'T DO THIS - Won't work in Vite
const url = process.env.VITE_SUPABASE_URL;
```

```typescript
// DO THIS - Correct for Vite
const url = import.meta.env.VITE_SUPABASE_URL;
```

### ❌ Missing `VITE_` Prefix

```env
# DON'T DO THIS - Won't be exposed to browser
SUPABASE_URL=https://...
```

```env
# DO THIS - Correct prefix
VITE_SUPABASE_URL=https://...
```

### ❌ Not Restarting Dev Server

After editing `.env`, **always restart** the Vite dev server:
```bash
# Stop the server (Ctrl+C)
npm run dev  # Start it again
```

### ❌ Not Committing Types File

Always commit `supabase/types.ts` after regenerating types so Netlify can use them during build.

## Type Safety

All functions are fully typed. TypeScript will catch errors at compile time:

```typescript
// ✅ Correct - TypeScript knows all fields
const entries = await getActiveEntriesByUser('user-id');
console.log(entries[0].competition_title); // OK

// ❌ Wrong - TypeScript error: Property doesn't exist
console.log(entries[0].nonexistent_field); // Compile error!

// ✅ Correct - TypeScript validates function arguments
await reserveTickets({
  competitionId: 'uuid',
  ticketNumbers: [1, 2, 3],
  userIdentifier: 'user-id',
  holdMinutes: 15,
});

// ❌ Wrong - TypeScript error: Missing required field
await reserveTickets({
  competitionId: 'uuid',
  // Missing ticketNumbers - Compile error!
});
```

## Summary

This implementation provides:
- ✅ Full TypeScript type safety
- ✅ Compile-time error catching
- ✅ IntelliSense autocomplete
- ✅ Vite/React/Netlify compatibility
- ✅ Environment variable best practices
- ✅ Comprehensive documentation
- ✅ Ready-to-use wrapper functions
- ✅ End-to-end purchase flow
