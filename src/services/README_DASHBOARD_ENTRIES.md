# Dashboard Entries Service

This service provides API functions for fetching user entries, transactions, and competition availability on the dashboard/entries page.

## Overview

The `dashboardEntriesService` provides functions that call Supabase RPCs to fetch data for the user dashboard. These functions are designed to work in conjunction with real-time channels for extra robustness.

## Usage

### Basic Import

```typescript
import {
  fetchUserDashboardEntries,
  fetchUserEntriesDetailed,
  fetchCompetitionAvailability,
  fetchPurchasedTicketsByUser,
  fetchPendingTransactions,
  loadUserOverview
} from '../services/dashboardEntriesService';
```

### 1. Fetch User Dashboard Entries

Get all user entries (tickets + active pending) for display on the dashboard.

```typescript
const entries = await fetchUserDashboardEntries('prize:pid:0x2137af5047526a1180...');

// Each entry contains:
// - competitionId: string
// - competitionTitle: string | null
// - ticketNumber: number | null
// - purchasedAt: string | null
// - status: string | null
// - source: 'tickets' | 'pending_tickets'
// - competitionUrl: string (e.g., "/competitions/uuid")
```

### 2. Fetch Detailed Entries with User Identifiers

Get entries with additional user identifier fields.

```typescript
const detailedEntries = await fetchUserEntriesDetailed('prize:pid:0x2137af5047526a1180...');

// Includes all fields from basic entries plus:
// - canonicalUserId: string | null
// - walletAddress: string | null
// - privyUserId: string | null
```

### 3. Fetch Competition Availability

Get available ticket counts and specific ticket numbers for a competition.

```typescript
const availability = await fetchCompetitionAvailability('88f3467c-747e-4231-bb2e-1869e227bb85');

if (availability) {
  console.log(`Available tickets: ${availability.availableCount}`);
  console.log(`Available ticket numbers:`, availability.availableTickets);
}
```

### 4. Fetch Purchased Tickets

Get all purchased (finalized) tickets for a user.

```typescript
const purchasedTickets = await fetchPurchasedTicketsByUser('prize:pid:0x2137af5047526a1180...');
// Returns DetailedEntry[] filtered to only purchased tickets
```

### 5. Fetch Pending Transactions

Get pending transactions that haven't been finalized yet.

```typescript
const pending = await fetchPendingTransactions('prize:pid:0x2137af5047526a1180...');

// Each pending transaction contains:
// - id, created_at, status, expires_at
// - competition_id, canonical_user_id, wallet_address
// - transaction_hash, client_secret
// - competitionUrl
```

### 6. Load Complete User Overview

Convenience function that fetches entries and availability for all competitions.

```typescript
const { entries, availabilityMap } = await loadUserOverview('prize:pid:0x2137af5047526a1180...');

// Access availability for a specific competition
const compAvailability = availabilityMap.get(competitionId);
```

## Integration with Real-Time Channels

These functions are designed to work alongside real-time subscriptions:

```typescript
// Initial data fetch
const entries = await fetchUserDashboardEntries(userId);

// Set up real-time subscription for updates
const subscription = supabase
  .channel('dashboard-updates')
  .on('postgres_changes', { 
    event: '*', 
    schema: 'public', 
    table: 'tickets' 
  }, (payload) => {
    // Refetch data when changes occur
    fetchUserDashboardEntries(userId).then(updatedEntries => {
      setEntries(updatedEntries);
    });
  })
  .subscribe();
```

## Supported User Identifiers

All functions accept any of these identifier formats:

- **Canonical User ID**: `prize:pid:0x2137af5047526a1180...`
- **Wallet Address**: `0x2137af5047526a1180...`
- **Privy DID**: `did:privy:...`

The RPCs handle identifier matching internally.

## Error Handling

All functions throw errors on RPC failures. Handle them appropriately:

```typescript
try {
  const entries = await fetchUserDashboardEntries(userId);
  // Use entries
} catch (error) {
  console.error('Failed to fetch entries:', error);
  // Show error to user
}
```

## Competition URLs

By default, all functions return competition URLs in the format `/competitions/{uuid}`. If your application uses slugs instead, you'll need to modify the URL construction in the service functions.

## Notes

- Functions are idempotent and safe to call multiple times
- Use for initial data fetching and manual refreshes
- Combine with real-time subscriptions for live updates
- All functions return promises that resolve with typed data
