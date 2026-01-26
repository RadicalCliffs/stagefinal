# Supabase Setup Guide for Entries Display

This document outlines exactly what Supabase needs to properly surface entries in the user dashboard and competition pages.

## Problem Summary

Users were seeing "No entries found" in the entries table on both:
- User Dashboard front end (Entries tab)
- Individual competition pages (Entries table)

Despite having 20 tickets purchased and stored in the database.

## Root Causes

1. **Missing RPC Function**: The frontend calls `get_competition_entries()` but only `get_competition_entries_bypass_rls()` existed
2. **Missing IDs**: Entries were being filtered out due to missing `id` or `competition_id` fields
3. **Join Issues**: Previous migrations used INNER JOINs that filtered out valid entries when competition data was missing

## Required Supabase RPCs

### 1. `get_competition_entries(competition_identifier TEXT)`

**Purpose**: Returns all entries for a specific competition (used on competition detail pages)

**Returns**:
```sql
uid text,
competitionid text,
userid text,
privy_user_id text,
numberoftickets integer,
ticketnumbers text,
amountspent numeric,
walletaddress text,
chain text,
transactionhash text,
purchasedate timestamp with time zone,
created_at timestamp with time zone
```

**Data Sources**:
- `joincompetition` table (primary source for confirmed entries)
- `tickets` table (fallback for entries not in joincompetition)

**Key Features**:
- Accepts both UUID and text (uid) competition identifiers
- Deduplicates entries between joincompetition and tickets tables
- Always returns valid `uid` and `competitionid` for every entry
- Uses UNION ALL to combine data from both sources

### 2. `get_comprehensive_user_dashboard_entries(user_identifier TEXT)`

**Purpose**: Returns all entries for a specific user (used in User Dashboard Entries tab)

**Returns**:
```sql
id TEXT,
competition_id TEXT,
title TEXT,
description TEXT,
image TEXT,
status TEXT,
entry_type TEXT,
is_winner BOOLEAN,
ticket_numbers TEXT,
total_tickets INTEGER,
total_amount_spent NUMERIC,
purchase_date TIMESTAMPTZ,
transaction_hash TEXT,
is_instant_win BOOLEAN,
prize_value NUMERIC,
competition_status TEXT,
end_date TIMESTAMPTZ
```

**Data Sources** (in order of priority):
1. `joincompetition` table (confirmed competition entries)
2. `tickets` table (individual ticket purchases)
3. `user_transactions` table (payment transactions)
4. `pending_tickets` table (pending reservations)

**Key Features**:
- Resolves user identity from `canonical_users` table first
- Matches by: canonical_user_id, wallet_address, base_wallet_address, eth_wallet_address, privy_user_id, uid
- Always returns valid `id` and `competition_id` for every entry
- Filters out expired pending tickets
- Uses LEFT JOINs to preserve entries even if competition details are missing
- Returns entries grouped by competition with aggregated ticket data

### 3. `get_competition_entries_bypass_rls(competition_identifier TEXT)`

**Purpose**: Backend version of get_competition_entries with SECURITY DEFINER to bypass RLS

**Implementation**: Same as `get_competition_entries()` but with `SECURITY DEFINER`

### 4. `get_competition_ticket_availability_text(competition_id_text TEXT)`

**Purpose**: Returns ticket availability data for a competition

**Returns**:
```json
{
  "competition_id": "uuid",
  "total_tickets": 16094,
  "available_tickets": [1, 2, 3, ...],
  "sold_count": 20,
  "available_count": 16074
}
```

**Data Sources**:
- `competitions` table (total_tickets)
- `get_unavailable_tickets()` function (sold tickets)

### 5. `get_unavailable_tickets(competition_id TEXT)`

**Purpose**: Returns array of unavailable ticket numbers for a competition

**Returns**: `INTEGER[]` (array of ticket numbers)

**Data Sources**:
- `joincompetition.ticketnumbers` (parsed from comma-separated string)
- `tickets.ticket_number`
- `pending_tickets.ticket_numbers` (active reservations only)

## Critical Database Requirements

### Tables

1. **competitions**
   - Columns: `id`, `uid`, `title`, `description`, `image_url`, `status`, `total_tickets`, `ticket_price`, `prize_value`, `end_date`, `is_instant_win`, `winner_address`
   - Indexes: `idx_competitions_uid`, `idx_competitions_status`, `idx_competitions_end_date`

2. **joincompetition**
   - Columns: `id`, `uid`, `competitionid`, `userid`, `canonical_user_id`, `walletaddress`, `privy_user_id`, `numberoftickets`, `ticketnumbers`, `amountspent`, `transactionhash`, `purchasedate`, `created_at`
   - Indexes: `idx_joincompetition_competitionid`, `idx_joincompetition_wallet_lower`, `idx_joincompetition_canonical_user_id`, `idx_joincompetition_userid`

3. **tickets**
   - Columns: `id`, `competition_id`, `ticket_number`, `user_id`, `canonical_user_id`, `purchase_price`, `purchased_at`, `is_winner`, `created_at`
   - Indexes: `idx_tickets_competition_id`, `idx_tickets_user_id_lower`, `idx_tickets_canonical_user_id`, `idx_tickets_ticket_number`

4. **canonical_users**
   - Columns: `uid`, `canonical_user_id`, `wallet_address`, `base_wallet_address`, `eth_wallet_address`, `privy_user_id`
   - Indexes: `idx_canonical_users_wallet_lower`, `idx_canonical_users_base_wallet_lower`, `idx_canonical_users_canonical_user_id`

5. **user_transactions**
   - Columns: `id`, `user_id`, `user_privy_id`, `canonical_user_id`, `competition_id`, `wallet_address`, `ticket_count`, `amount`, `payment_status`, `tx_id`, `created_at`
   - Indexes: `idx_user_transactions_user_id`, `idx_user_transactions_canonical_user_id`, `idx_user_transactions_competition_id`, `idx_user_transactions_status`

6. **pending_tickets**
   - Columns: `id`, `user_id`, `canonical_user_id`, `wallet_address`, `competition_id`, `ticket_numbers`, `ticket_count`, `total_amount`, `status`, `transaction_hash`, `expires_at`, `created_at`
   - Indexes: `idx_pending_tickets_competition_id`, `idx_pending_tickets_user_id`, `idx_pending_tickets_status`, `idx_pending_tickets_expires_at`

### RLS Policies

All RPCs use `SECURITY DEFINER` and `SET search_path = public` to ensure they can:
- Read from all required tables regardless of RLS policies
- Bypass permissions for authenticated and anonymous users
- Execute with elevated privileges for data aggregation

Grant permissions required:
```sql
GRANT EXECUTE ON FUNCTION get_competition_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_entries(TEXT) TO service_role;

GRANT EXECUTE ON FUNCTION get_comprehensive_user_dashboard_entries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_comprehensive_user_dashboard_entries(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_comprehensive_user_dashboard_entries(TEXT) TO service_role;

GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_entries_bypass_rls(TEXT) TO service_role;

GRANT EXECUTE ON FUNCTION get_competition_ticket_availability_text(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_competition_ticket_availability_text(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_competition_ticket_availability_text(TEXT) TO service_role;

GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO service_role;
```

## Migration Files

Apply migrations in this order:

1. `20260119000000_comprehensive_final_migration.sql` - Creates base RPCs and indexes
2. `20260119130000_fix_dashboard_entries_use_canonical_users_lookup.sql` - Adds canonical_users lookup
3. `20260120000000_fix_phantom_dashboard_entries.sql` - Fixes phantom entries with INNER JOINs
4. **`20260120100000_fix_missing_entries_rpcs.sql`** - **NEW** Creates missing `get_competition_entries()` and fixes ID issues

## Frontend Integration

### Competition Entries Display

The frontend calls:
```typescript
const { data, error } = await supabase
  .rpc('get_competition_entries', {
    competition_identifier: competitionId
  });
```

Expected data structure:
```typescript
Array<{
  uid: string;
  competitionid: string;
  userid: string;
  privy_user_id: string;
  numberoftickets: number;
  ticketnumbers: string; // comma-separated: "1,2,3"
  amountspent: number;
  walletaddress: string;
  chain: string;
  transactionhash: string;
  purchasedate: string;
  created_at: string;
}>
```

### User Dashboard Entries Display

The frontend calls:
```typescript
const { data, error } = await supabase
  .rpc('get_comprehensive_user_dashboard_entries', {
    params: { user_identifier: userId }  // Can be: canonical_user_id, wallet, privy_user_id, etc.
    // or: params: { userId: userId }
  });
```

Expected data structure:
```typescript
Array<{
  competition_id: string;
  tickets_count: number;
  amount_spent: number;
  latest_purchase_at: string;
  is_winner: boolean;
  ticket_numbers_csv: string;
}>
```

## Data Flow

### When a user purchases tickets:

1. **Reservation Phase**: Entry created in `pending_tickets` table
   - Status: 'pending'
   - Expires in 15 minutes
   - Visible in dashboard as "Pending" entry

2. **Payment Confirmation**: 
   - Entry moved/copied to `joincompetition` table
   - `pending_tickets` status updated to 'confirmed'
   - Individual tickets created in `tickets` table (one row per ticket)
   - Transaction recorded in `user_transactions`

3. **Display in UI**:
   - Dashboard calls `get_comprehensive_user_dashboard_entries(user_id)`
   - Returns entry from `joincompetition` (primary) or `tickets` (fallback)
   - Shows ticket numbers, total spent, purchase date, competition details

### When viewing competition entries:

1. Competition page calls `get_competition_entries(competition_id)`
2. Returns all entries from `joincompetition` + unique entries from `tickets`
3. Displays in table with columns: Username, Wallet Address, Ticket Numbers, VRF Hash

## Troubleshooting

### Issue: "No entries found" despite purchases

**Check**:
1. Do entries exist in `joincompetition` or `tickets` table?
2. Do entries have valid `uid`/`id` and `competitionid`/`competition_id`?
3. Is the RPC `get_competition_entries` available (not just `get_competition_entries_bypass_rls`)?
4. Are the EXECUTE permissions granted to anon/authenticated users?

**Solution**: Apply migration `20260120100000_fix_missing_entries_rpcs.sql`

### Issue: Entries show but have no competition details

**Check**:
1. Does the competition exist in `competitions` table?
2. Does `joincompetition.competitionid` match `competitions.id` or `competitions.uid`?
3. Are LEFT JOINs being used (INNER JOINs will filter out entries)?

**Solution**: Ensure joins use `LEFT JOIN` and return competition_id even if join fails

### Issue: User identity not matching

**Check**:
1. Does user exist in `canonical_users` table?
2. Is `canonical_user_id` populated in entry tables (joincompetition, tickets, etc.)?
3. Are wallet addresses normalized to lowercase for comparison?

**Solution**: Ensure `get_comprehensive_user_dashboard_entries` resolves from `canonical_users` first

## Testing Checklist

- [ ] Can view entries on competition detail page
- [ ] Entries table shows: ticket numbers, usernames, wallet addresses
- [ ] Can view entries in user dashboard (Entries tab)
- [ ] Dashboard shows: competition title, ticket count, amount spent, status
- [ ] Pending entries show with "Pending" status
- [ ] Completed entries show with "Live" or "Completed" status
- [ ] Winning entries show with winner indicator
- [ ] No phantom entries with "Unknown Competition" or $0.00
- [ ] Entries persist after page refresh
- [ ] Entries update in real-time after purchase

## Summary

The key fix is ensuring:
1. **`get_competition_entries()` RPC exists** (was missing, only bypass version existed)
2. **All entries return valid IDs** (id and competition_id fields are never NULL/empty)
3. **User identity is resolved from canonical_users** (ensures all user identifiers are matched)
4. **LEFT JOINs are used** (preserves entries even if competition details missing)
5. **Proper permissions are granted** (anon/authenticated can execute RPCs)

Apply the migration `20260120100000_fix_missing_entries_rpcs.sql` to implement these fixes.
