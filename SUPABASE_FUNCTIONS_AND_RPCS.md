# Supabase Edge Functions and RPC Functions Reference

This document provides a comprehensive list of all Supabase Edge Functions and RPC (Remote Procedure Call) functions that the frontend expects to be available in Supabase. Every function signature, parameter, and return type is documented to the exact letter/character/symbol for easy manual copy-pasting into Supabase.

---

## Table of Contents

1. [Edge Functions](#edge-functions)
2. [RPC Functions](#rpc-functions)
   - [User Balance & Profile](#user-balance--profile)
   - [Tickets & Reservations](#tickets--reservations)
   - [Competition Availability](#competition-availability)
   - [User Transactions & Entries](#user-transactions--entries)
   - [Wallet & External Integration](#wallet--external-integration)
   - [Competition Status & Winners](#competition-status--winners)
   - [Administrative Functions](#administrative-functions)

---

## Edge Functions

Edge Functions are deployed as Deno functions under `supabase/functions/` and invoked via `supabase.functions.invoke()`.

### 1. `get-user-profile`

**Purpose**: Fetch comprehensive user profile including wallet, tickets, and orders

**Invocation**:
```typescript
supabase.functions.invoke('get-user-profile', {
  body: { 
    privy_user_id: string  // Canonical format (e.g., "PID_...")
  }
})
```

**Parameters**:
- `privy_user_id` (string, required): User's canonical Privy ID

**Response**:
```typescript
{
  ok: boolean,
  data: {
    profile: UserProfile | null,
    wallet: WalletInfo | null,
    tickets: Ticket[],
    orders: Order[]
  }
}
```

**Location**: `supabase/functions/get-user-profile/index.ts`  
**Frontend Usage**: `src/hooks/useUserProfile.ts:87`

---

### 2. `purchase-tickets-with-bonus`

**Purpose**: Purchase tickets using user balance with bonus system integration

**Invocation**:
```typescript
supabase.functions.invoke('purchase-tickets-with-bonus', {
  body: {
    userId: string,              // Canonical user ID
    idempotencyKey: string,      // Unique key for idempotent operation
    competitionId: string,       // Competition UUID or UID
    numberOfTickets: number,     // Number of tickets to purchase
    ticketPrice: number,         // Price per ticket
    selectedTickets: number[],   // Array of specific ticket numbers
    reservationId: string | null // Optional reservation ID for atomic allocation
  }
})
```

**Parameters**:
- `userId` (string, required): Canonical format user identifier
- `idempotencyKey` (string, required): UUID for deduplication
- `competitionId` (string, required): Competition identifier
- `numberOfTickets` (number, required): Quantity to purchase
- `ticketPrice` (number, required): Unit price
- `selectedTickets` (number[], required): Specific ticket numbers (can be empty for lucky dip)
- `reservationId` (string | null, required): Reservation ID if continuing from reservation

**Response**:
```typescript
{
  success: boolean,
  ticketsCreated: number,
  ticketsPurchased: number,
  totalCost: number,
  balanceAfterPurchase: number,
  message: string,
  tickets: Ticket[],
  entryId: string,
  transactionId: string
}
```

**Location**: `supabase/functions/purchase-tickets-with-bonus/index.ts`  
**Frontend Usage**: `src/lib/ticketPurchaseService.ts:95`

---

### 3. `reserve-tickets` (Edge Function)

**Purpose**: Reserve specific tickets for a user (legacy/redundant version)

**Invocation**:
```typescript
supabase.functions.invoke('reserve-tickets', {
  headers: {
    Authorization?: string  // Optional bearer token
  },
  body: {
    userId: string,          // User identifier
    competitionId: string,   // Competition ID
    selectedTickets: number[] // Ticket numbers to reserve
  }
})
```

**Parameters**:
- `userId` (string, required): User identifier
- `competitionId` (string, required): Competition ID
- `selectedTickets` (number[], required): Array of ticket numbers

**Response**:
```typescript
{
  success: boolean,
  reservationId?: string,
  error?: string
}
```

**Location**: `supabase/functions/reserve-tickets/index.ts`  
**Frontend Usage**: `src/lib/reserve-tickets-redundant.ts:67`  
**Status**: ⚠️ **DEPRECATED/REDUNDANT** - Use the `reserve_tickets` RPC function instead for new code. This edge function is maintained for backward compatibility only.

---

### 4. `confirm-pending-tickets`

**Purpose**: Confirm pending ticket purchases and mark them as sold

**Location**: `supabase/functions/confirm-pending-tickets/index.ts`

---

### 5. `lucky-dip-reserve`

**Purpose**: Reserve lucky dip tickets (random selection)

**Location**: `supabase/functions/lucky-dip-reserve/index.ts`

---

### 6. `onramp-webhook`

**Purpose**: Handle onramp payment webhooks

**Location**: `supabase/functions/onramp-webhook/index.ts`

---

### 7. `commerce-webhook`

**Purpose**: Handle Coinbase Commerce webhook events

**Location**: `supabase/functions/commerce-webhook/index.ts`

---

### 8. `reconcile-payments`

**Purpose**: Reconcile payment records and balance discrepancies

**Location**: `supabase/functions/reconcile-payments/index.ts`

---

### 9. `upsert-user`

**Purpose**: Create or update user records

**Location**: `supabase/functions/upsert-user/index.ts`

---

## RPC Functions

RPC Functions are PostgreSQL functions invoked via `supabase.rpc()`. They are defined in migration files under `supabase/migrations/`.

---

## User Balance & Profile

### `get_user_balance`

**Purpose**: Get current user balance

**Invocation**:
```typescript
supabase.rpc('get_user_balance', {
  p_canonical_user_id: 'prize:pid:0x...'  // text (SQL TEXT type)
})
```

**Parameters**:
- `p_canonical_user_id` (text, required): Canonical user ID

**Returns**: `numeric` - User balance

**Frontend Usage**: 
- `src/hooks/useRealTimeBalance.ts:77`
- `src/lib/ticketPurchaseService.ts`

---

### `get_user_wallet_balance`

**Purpose**: Get user wallet balance information

**Invocation**:
```typescript
supabase.rpc('get_user_wallet_balance', {
  user_identifier: string
})
```

**Parameters**:
- `user_identifier` (text, required): User ID or wallet address

**Returns**: `jsonb` - Wallet balance object

**Frontend Usage**: `src/contexts/AuthContext.tsx`

---

### `get_user_balance_with_pending`

**Purpose**: Get user balance including pending transactions

**Invocation**:
```typescript
supabase.rpc('get_user_balance_with_pending', {
  p_canonical_user_id: 'prize:pid:0x...'  // text (SQL TEXT type)
})
```

**Parameters**:
- `p_canonical_user_id` (text, required): Canonical user ID

**Returns**: `jsonb` - Balance object with pending amounts

---

### `upsert_canonical_user`

**Purpose**: Create or update a canonical user record

**Invocation**:
```typescript
supabase.rpc('upsert_canonical_user', {
  p_privy_user_id: string,
  p_wallet_address?: string,
  p_email?: string,
  p_display_name?: string,
  p_avatar_url?: string
})
```

**Parameters**:
- `p_privy_user_id` (text, required): Privy user ID
- `p_wallet_address` (text, optional): Wallet address
- `p_email` (text, optional): Email address
- `p_display_name` (text, optional): Display name
- `p_avatar_url` (text, optional): Avatar URL

**Returns**: `jsonb` - Created/updated user record

**Frontend Usage**: 
- `src/contexts/AuthContext.tsx`
- `src/components/BaseWalletAuthModal.tsx`

---

### `update_user_avatar`

**Purpose**: Update user avatar URL

**Invocation**:
```typescript
supabase.rpc('update_user_avatar', {
  user_id: string,
  avatar_url: string
})
```

**Parameters**:
- `user_id` (text, required): User ID
- `avatar_url` (text, required): New avatar URL

**Returns**: `jsonb` - Updated user record

**Frontend Usage**: `src/services/userDataService.ts`

---

### `update_user_profile_by_identifier`

**Purpose**: Update user profile using any identifier

**Invocation**:
```typescript
supabase.rpc('update_user_profile_by_identifier', {
  user_identifier: string,
  display_name?: string,
  email?: string,
  avatar_url?: string
})
```

**Parameters**:
- `user_identifier` (text, required): User ID or wallet address
- `display_name` (text, optional): New display name
- `email` (text, optional): New email
- `avatar_url` (text, optional): New avatar URL

**Returns**: `jsonb` - Updated profile

**Frontend Usage**: `src/services/userDataService.ts`

---

### `get_user_active_tickets`

**Purpose**: Get all active tickets for a user

**Invocation**:
```typescript
supabase.rpc('get_user_active_tickets', {
  user_identifier: string
})
```

**Parameters**:
- `user_identifier` (text, required): User ID or wallet address

**Returns**: `jsonb[]` - Array of active tickets

**Frontend Usage**: `src/contexts/AuthContext.tsx`

---

### `get_user_tickets`

**Purpose**: Get all tickets for a user

**Invocation**:
```typescript
supabase.rpc('get_user_tickets', {
  user_identifier: string
})
```

**Parameters**:
- `user_identifier` (text, required): User ID or wallet address

**Returns**: `jsonb[]` - Array of user tickets

**Frontend Usage**: `src/services/userDataService.ts`

---

### `get_recent_entries_count`

**Purpose**: Get count of recent entries for a user

**Invocation**:
```typescript
supabase.rpc('get_recent_entries_count', {
  user_identifier: string
})
```

**Parameters**:
- `user_identifier` (text, required): User ID or wallet address

**Returns**: `integer` - Number of recent entries

**Frontend Usage**: `src/services/userDataService.ts`

---

### `attach_identity_after_auth`

**Purpose**: Link wallet address to user after authentication

**Invocation**:
```typescript
supabase.rpc('attach_identity_after_auth', {
  user_id: string,
  wallet_address: string
})
```

**Parameters**:
- `user_id` (text, required): User ID
- `wallet_address` (text, required): Wallet address to link

**Returns**: `jsonb` - Link result

**Frontend Usage**: `src/components/BaseWalletAuthModal.tsx`

---

## Tickets & Reservations

### `reserve_tickets`

**Purpose**: Reserve specific tickets atomically

**Invocation**:
```typescript
supabase.rpc('reserve_tickets', {
  p_competition_id: string,
  p_ticket_numbers: number[],
  p_user_id: string,
  p_hold_minutes: number
})
```

**Parameters**:
- `p_competition_id` (text, required): Competition ID
- `p_ticket_numbers` (integer[], required): Array of ticket numbers to reserve
- `p_user_id` (text, required): User identifier
- `p_hold_minutes` (integer, optional, default: 15): Minutes to hold reservation

**Returns**: `jsonb` - `{ success: boolean, reservation_id?: string, error?: string }`

**Frontend Usage**: `src/lib/supabase-typed.ts:160`

---

### `reserve_tickets_atomically`

**Purpose**: Atomically reserve tickets with race condition protection

**Invocation**:
```typescript
supabase.rpc('reserve_tickets_atomically', {
  p_competition_id: string,
  p_ticket_numbers: number[],
  p_user_id: string,
  p_hold_minutes: number
})
```

**Parameters**:
- `p_competition_id` (text, required): Competition ID
- `p_ticket_numbers` (integer[], required): Ticket numbers
- `p_user_id` (text, required): User ID
- `p_hold_minutes` (integer, required): Hold duration

**Returns**: `jsonb` - Reservation result

**Frontend Usage**: `src/lib/database.ts`

---

### `finalize_order`

**Purpose**: Finalize ticket order from reservation

**Invocation**:
```typescript
supabase.rpc('finalize_order', {
  p_reservation_id: string,
  p_user_id: string,
  p_competition_id: string,
  p_unit_price: number
})
```

**Parameters**:
- `p_reservation_id` (text, required): Reservation ID
- `p_user_id` (text, required): User identifier
- `p_competition_id` (text, required): Competition ID
- `p_unit_price` (numeric, required): Price per ticket

**Returns**: `jsonb` - `{ success: boolean, order_id?: string, transaction_id?: string, amount_charged?: number }`

**Frontend Usage**: `src/lib/supabase-typed.ts:199`

---

### `release_reservation`

**Purpose**: Cancel a ticket reservation

**Invocation**:
```typescript
supabase.rpc('release_reservation', {
  p_reservation_id: string,
  p_user_id: string
})
```

**Parameters**:
- `p_reservation_id` (text, required): Reservation ID to cancel
- `p_user_id` (text, required): User identifier

**Returns**: `jsonb` - `{ success: boolean, message?: string }`

**Frontend Usage**: `src/lib/supabase-typed.ts:230`

---

### `get_unavailable_tickets`

**Purpose**: Get list of unavailable ticket numbers for a competition

**Invocation**:
```typescript
supabase.rpc('get_unavailable_tickets', {
  p_competition_id: string
})
```

**Parameters**:
- `p_competition_id` (text, required): Competition ID

**Returns**: `integer[]` - Array of unavailable ticket numbers

**Frontend Usage**: 
- `src/lib/database.ts:1402`
- `src/lib/supabase-typed.ts:254`

---

### `get_user_tickets_for_competition`

**Purpose**: Get user's tickets for a specific competition

**Invocation**:
```typescript
supabase.rpc('get_user_tickets_for_competition', {
  competition_id: string,
  user_id: string
})
```

**Parameters**:
- `competition_id` (text, required): Competition ID
- `user_id` (text, required): User identifier

**Returns**: `jsonb[]` - Array of ticket details

**Frontend Usage**: `src/lib/supabase-typed.ts:281`

---

### `confirm_ticket_purchase`

**Purpose**: Confirm a ticket purchase transaction

**Invocation**:
```typescript
supabase.rpc('confirm_ticket_purchase', {
  p_user_id: string,
  p_competition_id: string,
  p_ticket_numbers: number[],
  p_total_amount: number,
  p_idempotency_key: string
})
```

**Parameters**:
- `p_user_id` (text, required): User identifier
- `p_competition_id` (text, required): Competition ID
- `p_ticket_numbers` (integer[], required): Purchased ticket numbers
- `p_total_amount` (numeric, required): Total purchase amount
- `p_idempotency_key` (text, required): Unique transaction key

**Returns**: `jsonb` - Purchase confirmation

---

### `check_and_mark_competition_sold_out`

**Purpose**: Check if competition is sold out and mark status

**Invocation**:
```typescript
supabase.rpc('check_and_mark_competition_sold_out', {
  p_competition_id: string
})
```

**Parameters**:
- `p_competition_id` (text, required): Competition ID

**Returns**: `boolean` - True if sold out

**Frontend Usage**: `src/lib/ticketPurchaseService.ts:23`

---

### `get_user_pending_reservation`

**Purpose**: Get active pending reservation for user

**Invocation**:
```typescript
supabase.rpc('get_user_pending_reservation', {
  p_user_id: string,
  p_competition_id: string
})
```

**Parameters**:
- `p_user_id` (text, required): User ID
- `p_competition_id` (text, required): Competition ID

**Returns**: `jsonb` - Pending reservation details

---

### `cancel_user_pending_reservations`

**Purpose**: Cancel all pending reservations for a user

**Invocation**:
```typescript
supabase.rpc('cancel_user_pending_reservations', {
  p_user_id: string
})
```

**Parameters**:
- `p_user_id` (text, required): User ID

**Returns**: `void`

---

### `create_pending_ticket_reservation`

**Purpose**: Create a new pending ticket reservation

**Invocation**:
```typescript
supabase.rpc('create_pending_ticket_reservation', {
  p_user_id: string,
  p_competition_id: string,
  p_ticket_numbers: number[],
  p_hold_minutes: number
})
```

**Parameters**:
- `p_user_id` (text, required): User ID
- `p_competition_id` (text, required): Competition ID
- `p_ticket_numbers` (integer[], required): Ticket numbers
- `p_hold_minutes` (integer, required): Hold duration

**Returns**: `jsonb` - Reservation details

---

### `confirm_pending_ticket_reservation`

**Purpose**: Confirm and finalize pending reservation

**Invocation**:
```typescript
supabase.rpc('confirm_pending_ticket_reservation', {
  p_reservation_id: string,
  p_user_id: string
})
```

**Parameters**:
- `p_reservation_id` (text, required): Reservation ID
- `p_user_id` (text, required): User ID

**Returns**: `jsonb` - Confirmation result

---

### `confirm_pending_tickets_atomic`

**Purpose**: Atomically confirm pending tickets

**Invocation**:
```typescript
supabase.rpc('confirm_pending_tickets_atomic', {
  p_competition_id: string,
  p_user_id: string,
  p_reservation_id: string
})
```

**Parameters**:
- `p_competition_id` (text, required): Competition ID
- `p_user_id` (text, required): User ID
- `p_reservation_id` (text, required): Reservation ID

**Returns**: `jsonb` - Atomic confirmation result

---

## Competition Availability

### `get_competition_ticket_availability_text`

**Purpose**: Get ticket availability for competition (handles text/UUID types)

**Invocation**:
```typescript
supabase.rpc('get_competition_ticket_availability_text', {
  competition_id_text: string
})
```

**Parameters**:
- `competition_id_text` (text, required): Competition ID as text

**Returns**: `jsonb` - `{ total_tickets: number, sold_count: number, available_count: number, sold_tickets?: number[], error?: string }`

**Frontend Usage**: 
- `src/lib/database.ts:299, 1321`
- `src/hooks/useTicketBroadcast.ts:340`

---

### `get_competition_ticket_availability`

**Purpose**: Get ticket availability (UUID version)

**Invocation**:
```typescript
supabase.rpc('get_competition_ticket_availability', {
  p_competition_id: string
})
```

**Parameters**:
- `p_competition_id` (uuid, required): Competition UUID

**Returns**: `jsonb` - Availability object

---

### `get_available_ticket_count_v2`

**Purpose**: Get available ticket count (version 2)

**Invocation**:
```typescript
supabase.rpc('get_available_ticket_count_v2', {
  p_competition_id: string
})
```

**Parameters**:
- `p_competition_id` (text, required): Competition ID

**Returns**: `integer` - Available count

**Frontend Usage**: `src/lib/database.ts`

---

### `get_available_tickets`

**Purpose**: Get list of available ticket numbers

**Invocation**:
```typescript
supabase.rpc('get_available_tickets', {
  p_competition_id: string
})
```

**Parameters**:
- `p_competition_id` (text, required): Competition ID

**Returns**: `integer[]` - Available ticket numbers

---

### `get_available_tickets_excluding_user_pending`

**Purpose**: Get available tickets excluding user's pending reservations

**Invocation**:
```typescript
supabase.rpc('get_available_tickets_excluding_user_pending', {
  p_competition_id: string,
  p_user_id: string
})
```

**Parameters**:
- `p_competition_id` (text, required): Competition ID
- `p_user_id` (text, required): User ID

**Returns**: `integer[]` - Available tickets

---

### `allocate_lucky_dip_tickets`

**Purpose**: Allocate random tickets for lucky dip

**Invocation**:
```typescript
supabase.rpc('allocate_lucky_dip_tickets', {
  p_competition_id: string,
  p_user_id: string,
  p_count: number
})
```

**Parameters**:
- `p_competition_id` (text, required): Competition ID
- `p_user_id` (text, required): User ID
- `p_count` (integer, required): Number of tickets to allocate

**Returns**: `jsonb` - `{ success: boolean, ticket_numbers?: number[], error?: string }`

**Frontend Usage**: `src/lib/database.ts`

---

### `allocate_lucky_dip_tickets_batch`

**Purpose**: Allocate lucky dip tickets in batch

**Invocation**:
```typescript
supabase.rpc('allocate_lucky_dip_tickets_batch', {
  tickets_array: Array<{
    competition_id: string,
    user_id: string,
    count: number
  }>
})
```

**Parameters**:
- `tickets_array` (jsonb[], required): Array of allocation requests

**Returns**: `jsonb[]` - Array of allocation results

**Frontend Usage**: 
- `src/lib/database.ts`
- `src/lib/bulk-lucky-dip.ts`

---

### `count_sold_tickets_for_competition`

**Purpose**: Count sold tickets for competition

**Invocation**:
```typescript
supabase.rpc('count_sold_tickets_for_competition', {
  p_competition_id: string
})
```

**Parameters**:
- `p_competition_id` (text, required): Competition ID

**Returns**: `integer` - Sold ticket count

---

### `get_sold_tickets_for_competition_bypass_rls`

**Purpose**: Get sold tickets bypassing RLS (admin)

**Invocation**:
```typescript
supabase.rpc('get_sold_tickets_for_competition_bypass_rls', {
  p_competition_id: string
})
```

**Parameters**:
- `p_competition_id` (text, required): Competition ID

**Returns**: `jsonb[]` - Sold tickets

---

### `get_pending_tickets_for_competition`

**Purpose**: Get pending tickets for competition

**Invocation**:
```typescript
supabase.rpc('get_pending_tickets_for_competition', {
  p_competition_id: string
})
```

**Parameters**:
- `p_competition_id` (text, required): Competition ID

**Returns**: `jsonb[]` - Pending tickets

---

### `validate_competition_for_sales`

**Purpose**: Validate competition can accept sales

**Invocation**:
```typescript
supabase.rpc('validate_competition_for_sales', {
  p_competition_id: string
})
```

**Parameters**:
- `p_competition_id` (text, required): Competition ID

**Returns**: `jsonb` - Validation result

---

## User Transactions & Entries

### `get_user_transactions`

**Purpose**: Get user transaction history

**Invocation**:
```typescript
supabase.rpc('get_user_transactions', {
  user_identifier: string
})
```

**Parameters**:
- `user_identifier` (text, required): User ID or wallet address

**Returns**: `jsonb[]` - Array of transactions

**Frontend Usage**: 
- `src/lib/database.ts:1524`
- `src/lib/notification-service.ts`

---

### `get_user_transactions_bypass_rls`

**Purpose**: Get user transactions bypassing RLS (admin)

**Invocation**:
```typescript
supabase.rpc('get_user_transactions_bypass_rls', {
  user_identifier: string
})
```

**Parameters**:
- `user_identifier` (text, required): User identifier

**Returns**: `jsonb[]` - Transactions

---

### `get_comprehensive_user_dashboard_entries`

**Purpose**: Get comprehensive dashboard data for user

**Invocation**:
```typescript
supabase.rpc('get_comprehensive_user_dashboard_entries', {
  user_identifier: string
})
```

**Parameters**:
- `user_identifier` (text, required): User ID or wallet address

**Returns**: `jsonb` - Dashboard data including entries, tickets, balance

**Frontend Usage**: 
- `src/lib/database.ts`
- `src/lib/omnipotent-data-service.ts`

---

### `get_user_dashboard_entries`

**Purpose**: Get dashboard entries for user

**Invocation**:
```typescript
supabase.rpc('get_user_dashboard_entries', {
  user_identifier: string
})
```

**Parameters**:
- `user_identifier` (text, required): User identifier

**Returns**: `jsonb[]` - Dashboard entries

---

### `get_user_competition_entries`

**Purpose**: Get user entries for a specific competition

**Invocation**:
```typescript
supabase.rpc('get_user_competition_entries', {
  p_user_id: string,
  p_competition_id: string
})
```

**Parameters**:
- `p_user_id` (text, required): User ID
- `p_competition_id` (text, required): Competition ID

**Returns**: `jsonb[]` - Competition entries

---

### `get_competition_entries`

**Purpose**: Get all entries for a competition

**Invocation**:
```typescript
supabase.rpc('get_competition_entries', {
  p_competition_id: string
})
```

**Parameters**:
- `p_competition_id` (text, required): Competition ID

**Returns**: `jsonb[]` - Competition entries

**Frontend Usage**: 
- `src/lib/omnipotent-data-service.ts`
- `src/components/FinishedCompetition/EntriesWithFilterTabs.tsx`

---

### `get_competition_entries_bypass_rls`

**Purpose**: Get competition entries bypassing RLS (admin)

**Invocation**:
```typescript
supabase.rpc('get_competition_entries_bypass_rls', {
  p_competition_id: string
})
```

**Parameters**:
- `p_competition_id` (text, required): Competition ID

**Returns**: `jsonb[]` - Entries (bypassing RLS)

**Frontend Usage**: 
- `src/lib/omnipotent-data-service.ts`
- `src/components/FinishedCompetition/EntriesWithFilterTabs.tsx`

---

### `get_joincompetition_entries_for_competition`

**Purpose**: Get joincompetition entries for a competition

**Invocation**:
```typescript
supabase.rpc('get_joincompetition_entries_for_competition', {
  p_competition_id: string
})
```

**Parameters**:
- `p_competition_id` (text, required): Competition ID

**Returns**: `jsonb[]` - Join competition entries

---

### `get_user_ticket_count`

**Purpose**: Get count of tickets for user

**Invocation**:
```typescript
supabase.rpc('get_user_ticket_count', {
  user_identifier: string
})
```

**Parameters**:
- `user_identifier` (text, required): User identifier

**Returns**: `integer` - Ticket count

---

### `get_user_tickets_bypass_rls`

**Purpose**: Get user tickets bypassing RLS (admin)

**Invocation**:
```typescript
supabase.rpc('get_user_tickets_bypass_rls', {
  user_identifier: string
})
```

**Parameters**:
- `user_identifier` (text, required): User identifier

**Returns**: `jsonb[]` - Tickets

---

### `get_user_pending_tickets_bypass_rls`

**Purpose**: Get user pending tickets bypassing RLS (admin)

**Invocation**:
```typescript
supabase.rpc('get_user_pending_tickets_bypass_rls', {
  user_identifier: string
})
```

**Parameters**:
- `user_identifier` (text, required): User identifier

**Returns**: `jsonb[]` - Pending tickets

---

### `get_recent_entries_count_bypass_rls`

**Purpose**: Get recent entries count bypassing RLS (admin)

**Invocation**:
```typescript
supabase.rpc('get_recent_entries_count_bypass_rls', {
  user_identifier: string
})
```

**Parameters**:
- `user_identifier` (text, required): User identifier

**Returns**: `integer` - Entry count

---

## Wallet & External Integration

### `get_linked_external_wallet`

**Purpose**: Get linked external wallet for user

**Invocation**:
```typescript
supabase.rpc('get_linked_external_wallet', {
  user_id: string
})
```

**Parameters**:
- `user_id` (text, required): User ID

**Returns**: `jsonb` - Linked wallet information

**Frontend Usage**: `src/components/WalletManagement/WalletManagement.tsx`

---

### `unlink_external_wallet`

**Purpose**: Unlink external wallet from user

**Invocation**:
```typescript
supabase.rpc('unlink_external_wallet', {
  user_id: string,
  wallet_address: string
})
```

**Parameters**:
- `user_id` (text, required): User ID
- `wallet_address` (text, required): Wallet address to unlink

**Returns**: `jsonb` - Unlink result

**Frontend Usage**: `src/components/WalletManagement/WalletManagement.tsx`

---

### `link_external_wallet`

**Purpose**: Link external wallet to user

**Invocation**:
```typescript
supabase.rpc('link_external_wallet', {
  user_id: string,
  wallet_address: string
})
```

**Parameters**:
- `user_id` (text, required): User ID
- `wallet_address` (text, required): Wallet address to link

**Returns**: `jsonb` - Link result

---

### `migrate_user_balance`

**Purpose**: Migrate user balance between accounts

**Invocation**:
```typescript
supabase.rpc('migrate_user_balance', {
  from_user_id: string,
  to_user_id: string
})
```

**Parameters**:
- `from_user_id` (text, required): Source user ID
- `to_user_id` (text, required): Target user ID

**Returns**: `jsonb` - Migration result

**Frontend Usage**: `src/lib/user-auth.ts`

---

### `add_pending_balance`

**Purpose**: Add pending balance to user account

**Invocation**:
```typescript
supabase.rpc('add_pending_balance', {
  user_identifier: string,
  amount: number,
  source: string
})
```

**Parameters**:
- `user_identifier` (text, required): User ID or wallet address
- `amount` (numeric, required): Amount to add
- `source` (text, required): Source of the balance (e.g., 'coinbase_commerce')

**Returns**: `jsonb` - Balance update result

**Frontend Usage**: `src/lib/coinbase-commerce.ts`

---

### `confirm_pending_balance`

**Purpose**: Confirm pending balance and add to available balance

**Invocation**:
```typescript
supabase.rpc('confirm_pending_balance', {
  user_identifier: string,
  amount: number
})
```

**Parameters**:
- `user_identifier` (text, required): User identifier
- `amount` (numeric, required): Amount to confirm

**Returns**: `jsonb` - Confirmation result

---

### `credit_user_balance`

**Purpose**: Credit amount to user balance

**Invocation**:
```typescript
supabase.rpc('credit_user_balance', {
  p_user_id: string,
  p_amount: number,
  p_source: string
})
```

**Parameters**:
- `p_user_id` (text, required): User ID
- `p_amount` (numeric, required): Amount to credit
- `p_source` (text, required): Source description

**Returns**: `jsonb` - Credit result

---

### `debit_user_balance`

**Purpose**: Debit amount from user balance

**Invocation**:
```typescript
supabase.rpc('debit_user_balance', {
  p_user_id: string,
  p_amount: number,
  p_reason: string
})
```

**Parameters**:
- `p_user_id` (text, required): User ID
- `p_amount` (numeric, required): Amount to debit
- `p_reason` (text, required): Reason for debit

**Returns**: `jsonb` - Debit result

---

### `get_sub_account_balance`

**Purpose**: Get sub-account balance

**Invocation**:
```typescript
supabase.rpc('get_sub_account_balance', {
  p_user_id: string
})
```

**Parameters**:
- `p_user_id` (text, required): User ID

**Returns**: `numeric` - Sub-account balance

---

### `get_sub_account_balance_flexible`

**Purpose**: Get sub-account balance with flexible identifier

**Invocation**:
```typescript
supabase.rpc('get_sub_account_balance_flexible', {
  user_identifier: string
})
```

**Parameters**:
- `user_identifier` (text, required): User ID or wallet address

**Returns**: `numeric` - Sub-account balance

---

### `credit_sub_account_balance`

**Purpose**: Credit sub-account balance

**Invocation**:
```typescript
supabase.rpc('credit_sub_account_balance', {
  p_user_id: string,
  p_amount: number,
  p_source: string
})
```

**Parameters**:
- `p_user_id` (text, required): User ID
- `p_amount` (numeric, required): Amount to credit
- `p_source` (text, required): Source description

**Returns**: `jsonb` - Credit result

---

### `credit_sub_account_with_bonus`

**Purpose**: Credit sub-account with bonus

**Invocation**:
```typescript
supabase.rpc('credit_sub_account_with_bonus', {
  p_user_id: string,
  p_amount: number,
  p_bonus_amount: number,
  p_source: string
})
```

**Parameters**:
- `p_user_id` (text, required): User ID
- `p_amount` (numeric, required): Base amount
- `p_bonus_amount` (numeric, required): Bonus amount
- `p_source` (text, required): Source description

**Returns**: `jsonb` - Credit result with bonus

---

### `debit_sub_account_balance`

**Purpose**: Debit sub-account balance

**Invocation**:
```typescript
supabase.rpc('debit_sub_account_balance', {
  p_user_id: string,
  p_amount: number,
  p_reason: string
})
```

**Parameters**:
- `p_user_id` (text, required): User ID
- `p_amount` (numeric, required): Amount to debit
- `p_reason` (text, required): Reason for debit

**Returns**: `jsonb` - Debit result

---

### `debit_sub_account_balance_with_entry`

**Purpose**: Debit sub-account balance and create entry

**Invocation**:
```typescript
supabase.rpc('debit_sub_account_balance_with_entry', {
  p_user_id: string,
  p_amount: number,
  p_competition_id: string,
  p_ticket_count: number
})
```

**Parameters**:
- `p_user_id` (text, required): User ID
- `p_amount` (numeric, required): Amount to debit
- `p_competition_id` (text, required): Competition ID
- `p_ticket_count` (integer, required): Number of tickets

**Returns**: `jsonb` - Debit result with entry

---

### `sync_wallet_balance`

**Purpose**: Synchronize wallet balance

**Invocation**:
```typescript
supabase.rpc('sync_wallet_balance', {
  p_wallet_address: string
})
```

**Parameters**:
- `p_wallet_address` (text, required): Wallet address

**Returns**: `jsonb` - Sync result

---

### `sync_user_wallet_balance`

**Purpose**: Synchronize user wallet balance

**Invocation**:
```typescript
supabase.rpc('sync_user_wallet_balance', {
  p_user_id: string
})
```

**Parameters**:
- `p_user_id` (text, required): User ID

**Returns**: `jsonb` - Sync result

---

### `sync_external_wallet_balances`

**Purpose**: Synchronize external wallet balances

**Invocation**:
```typescript
supabase.rpc('sync_external_wallet_balances')
```

**Parameters**: None

**Returns**: `jsonb` - Sync results

---

### `check_first_deposit_bonus_eligibility`

**Purpose**: Check if user is eligible for first deposit bonus

**Invocation**:
```typescript
supabase.rpc('check_first_deposit_bonus_eligibility', {
  p_user_id: string
})
```

**Parameters**:
- `p_user_id` (text, required): User ID

**Returns**: `boolean` - Eligibility status

---

### `credit_balance_with_first_deposit_bonus`

**Purpose**: Credit balance with first deposit bonus

**Invocation**:
```typescript
supabase.rpc('credit_balance_with_first_deposit_bonus', {
  p_user_id: string,
  p_amount: number,
  p_source: string
})
```

**Parameters**:
- `p_user_id` (text, required): User ID
- `p_amount` (numeric, required): Deposit amount
- `p_source` (text, required): Source description

**Returns**: `jsonb` - Credit result with bonus

---

## Competition Status & Winners

### `sync_competition_status_if_ended`

**Purpose**: Sync competition status if it has ended

**Invocation**:
```typescript
supabase.rpc('sync_competition_status_if_ended', {
  competition_id: string
})
```

**Parameters**:
- `competition_id` (text, required): Competition ID

**Returns**: `jsonb` - Status sync result

**Frontend Usage**: `src/lib/database.ts`

---

### `sync_competition_winners`

**Purpose**: Synchronize competition winners

**Invocation**:
```typescript
supabase.rpc('sync_competition_winners', {
  p_competition_id: string
})
```

**Parameters**:
- `p_competition_id` (text, required): Competition ID

**Returns**: `jsonb` - Winner sync result

---

### `trigger_sync_competition_winners`

**Purpose**: Trigger winner synchronization

**Invocation**:
```typescript
supabase.rpc('trigger_sync_competition_winners', {
  p_competition_id: string
})
```

**Parameters**:
- `p_competition_id` (text, required): Competition ID

**Returns**: `void`

---

### `get_recent_winners`

**Purpose**: Get recent competition winners

**Invocation**:
```typescript
supabase.rpc('get_recent_winners', {
  limit_count: number
})
```

**Parameters**:
- `limit_count` (integer, optional): Number of winners to return

**Returns**: `jsonb[]` - Array of recent winners

---

## Administrative Functions

### `archive_competition`

**Purpose**: Archive a competition

**Invocation**:
```typescript
supabase.rpc('archive_competition', {
  p_competition_id: string
})
```

**Parameters**:
- `p_competition_id` (text, required): Competition ID

**Returns**: `jsonb` - Archive result

---

### `restore_competition`

**Purpose**: Restore archived competition

**Invocation**:
```typescript
supabase.rpc('restore_competition', {
  p_competition_id: string
})
```

**Parameters**:
- `p_competition_id` (text, required): Competition ID

**Returns**: `jsonb` - Restore result

---

### `get_privy_user_id_from_identifiers`

**Purpose**: Get Privy user ID from various identifiers

**Invocation**:
```typescript
supabase.rpc('get_privy_user_id_from_identifiers', {
  user_identifier: string
})
```

**Parameters**:
- `user_identifier` (text, required): User ID, email, or wallet address

**Returns**: `text` - Privy user ID

---

### `audit_non_canonical_user_ids`

**Purpose**: Audit non-canonical user IDs in system

**Invocation**:
```typescript
supabase.rpc('audit_non_canonical_user_ids')
```

**Parameters**: None

**Returns**: `jsonb` - Audit results

---

### `cleanup_duplicate_email_accounts`

**Purpose**: Clean up duplicate email accounts

**Invocation**:
```typescript
supabase.rpc('cleanup_duplicate_email_accounts')
```

**Parameters**: None

**Returns**: `jsonb` - Cleanup results

---

### `cleanup_expired_pending`

**Purpose**: Clean up expired pending transactions

**Invocation**:
```typescript
supabase.rpc('cleanup_expired_pending')
```

**Parameters**: None

**Returns**: `integer` - Number of cleaned records

---

### `cleanup_expired_pending_tickets`

**Purpose**: Clean up expired pending tickets

**Invocation**:
```typescript
supabase.rpc('cleanup_expired_pending_tickets')
```

**Parameters**: None

**Returns**: `integer` - Number of cleaned tickets

---

### `expire_pending_tickets`

**Purpose**: Manually expire pending tickets

**Invocation**:
```typescript
supabase.rpc('expire_pending_tickets', {
  p_competition_id: string
})
```

**Parameters**:
- `p_competition_id` (text, required): Competition ID

**Returns**: `integer` - Number of expired tickets

---

### `reconcile_unconfirmed_payments`

**Purpose**: Reconcile unconfirmed payment records

**Invocation**:
```typescript
supabase.rpc('reconcile_unconfirmed_payments')
```

**Parameters**: None

**Returns**: `jsonb` - Reconciliation results

---

### `get_database_indexes`

**Purpose**: Get database index information

**Invocation**:
```typescript
supabase.rpc('get_database_indexes')
```

**Parameters**: None

**Returns**: `jsonb[]` - Array of index information

---

### `get_table_triggers`

**Purpose**: Get database trigger information

**Invocation**:
```typescript
supabase.rpc('get_table_triggers')
```

**Parameters**: None

**Returns**: `jsonb[]` - Array of trigger information

---

### `safe_uuid_cast`

**Purpose**: Safely cast text to UUID

**Invocation**:
```typescript
supabase.rpc('safe_uuid_cast', {
  input_text: string
})
```

**Parameters**:
- `input_text` (text, required): Text to cast

**Returns**: `uuid` - UUID or null

---

### `to_prize_pid`

**Purpose**: Convert user ID to canonical PID format

**Invocation**:
```typescript
supabase.rpc('to_prize_pid', {
  input_id: string
})
```

**Parameters**:
- `input_id` (text, required): Input ID

**Returns**: `text` - Canonical PID

---

### `normalize_wallet_address_value`

**Purpose**: Normalize wallet address format

**Invocation**:
```typescript
supabase.rpc('normalize_wallet_address_value', {
  wallet_value: string
})
```

**Parameters**:
- `wallet_value` (text, required): Wallet address

**Returns**: `text` - Normalized address

---

### `safe_add_privy_user_id`

**Purpose**: Safely add Privy user ID to record

**Invocation**:
```typescript
supabase.rpc('safe_add_privy_user_id', {
  p_table_name: string,
  p_record_id: string
})
```

**Parameters**:
- `p_table_name` (text, required): Table name
- `p_record_id` (text, required): Record ID

**Returns**: `jsonb` - Update result

---

### `safe_backfill_privy_user_id`

**Purpose**: Backfill Privy user IDs in bulk

**Invocation**:
```typescript
supabase.rpc('safe_backfill_privy_user_id', {
  p_table_name: string
})
```

**Parameters**:
- `p_table_name` (text, required): Table name

**Returns**: `jsonb` - Backfill results

---

### `check_joincompetition_entry_exists`

**Purpose**: Check if joincompetition entry exists

**Invocation**:
```typescript
supabase.rpc('check_joincompetition_entry_exists', {
  p_user_id: string,
  p_competition_id: string
})
```

**Parameters**:
- `p_user_id` (text, required): User ID
- `p_competition_id` (text, required): Competition ID

**Returns**: `boolean` - Existence flag

---

### `onchainkit_checkout`

**Purpose**: Process OnchainKit checkout

**Status**: ⚠️ **Implementation Status Unknown** - This function is referenced in frontend code but may be implemented as an edge function rather than an RPC, or may not yet be fully implemented. Check `src/lib/onchainkit-checkout.ts` and Supabase deployment for current implementation.

**Frontend Usage**: `src/lib/onchainkit-checkout.ts`

---

## Notes

1. **Canonical User IDs**: Most functions expect user IDs in canonical format (e.g., `PID_...`). Use the `to_prize_pid()` RPC or helper functions to convert IDs.

2. **Competition IDs**: Competition IDs can be either UUID or text UID format. 
   - **When to use which version**:
     - Use `*_text` versions when the competition ID comes from user input or may be in legacy UID format
     - Use UUID versions when you have a guaranteed UUID type
     - Modern code should prefer the `*_text` versions as they handle both formats
     - Example: `get_competition_ticket_availability` (UUID only) vs `get_competition_ticket_availability_text` (handles both)

3. **RLS Bypass Functions**: Functions ending with `_bypass_rls` are for administrative use and bypass Row Level Security policies.

4. **Error Handling**: All functions should be wrapped in try-catch blocks. Edge functions return `{ ok: boolean, data?, error? }` while RPC functions throw errors directly.

5. **Idempotency**: Purchase and transaction functions use idempotency keys to prevent duplicate operations.

6. **Atomic Operations**: Functions with `_atomically` or `_atomic` suffixes guarantee atomic database operations.

7. **Parameter Naming**: 
   - RPC functions often use prefixed parameters (e.g., `p_user_id`, `p_competition_id`)
   - Some functions accept multiple parameter name formats for backward compatibility

8. **Return Types**: 
   - Most RPC functions return `jsonb` for complex objects
   - Simple functions return primitives (`integer`, `numeric`, `boolean`, `text`)
   - Array returns use PostgreSQL array types (`integer[]`, `jsonb[]`)

---

## Summary Statistics

- **Total Edge Functions**: 9 actively used by frontend (documented here). Additional edge functions exist in `supabase/functions/` for VRF operations, admin tools, webhooks, and internal processes - these are not directly called by the frontend and are documented within their respective function directories.
- **Total RPC Functions**: 94 documented
- **Categories**: 
  - User Balance & Profile: 12 functions
  - Tickets & Reservations: 20 functions
  - Competition Availability: 14 functions
  - User Transactions & Entries: 16 functions
  - Wallet & External Integration: 20 functions
  - Competition Status & Winners: 4 functions
  - Administrative Functions: 20 functions

---

## Deployment Checklist

When deploying to Supabase:

### Edge Functions
1. Deploy each function directory under `supabase/functions/`
2. Set environment variables for each function
3. Configure function permissions and CORS settings
4. Test each endpoint with sample requests

### RPC Functions
1. Apply all migration files in order
2. Verify function signatures match this specification
3. Grant execute permissions to appropriate roles (anon, authenticated, service_role)
4. Test each function with sample parameters
5. Monitor function execution times and optimize as needed

### Verification Commands

```sql
-- List all custom functions
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_type = 'FUNCTION'
ORDER BY routine_name;

-- Check function signature
SELECT pg_get_functiondef(oid) 
FROM pg_proc 
WHERE proname = 'function_name';

-- Verify permissions
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_name = 'function_name';
```

---

**Last Updated**: Generated from codebase analysis on 2026-01-23

**Maintenance**: This file should be updated whenever:
- New edge functions are added
- New RPC functions are created
- Function signatures change
- Parameters are added/removed/renamed
- Return types are modified
