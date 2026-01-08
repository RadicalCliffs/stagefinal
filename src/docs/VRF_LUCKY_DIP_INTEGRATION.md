# VRF Lucky Dip Integration Guide

## Overview

This guide documents the VRF-based lucky dip ticket reservation system. The implementation uses Verifiable Random Function (VRF) for fair, deterministic ticket selection when users want random tickets instead of choosing specific numbers.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Frontend: PremiumDrawTicketSelector                                  │
│  User sets slider: "I want 10 random tickets"                        │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Supabase Edge Function: lucky-dip-reserve                           │
│  1. Fetch available tickets from v_competition_available_now         │
│  2. Validate availability >= requested count                         │
│  3. Generate VRF seed (cryptographically secure)                     │
│  4. Use Fisher-Yates shuffle to select unique tickets                │
│  5. Call reserve_tickets_atomically RPC                              │
│  6. Return { reservationId, ticketNumbers, expiresAt, vrfSeed }      │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Frontend: PaymentModal                                               │
│  Shows selected tickets, starts countdown, collects payment          │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Supabase Edge Function: confirm-pending-tickets                     │
│  Finalizes tickets after payment success                             │
└──────────────────────────────────────────────────────────────────────┘
```

---

## API Reference

### 1. Lucky Dip Reserve

**Endpoint:** `POST /functions/v1/lucky-dip-reserve`

**Base URL:** `https://cyxjzycxnfqctxocolwr.supabase.co`

**Description:** Reserves a specified COUNT of randomly selected tickets using VRF.

#### Request Body

```typescript
interface LuckyDipReserveRequest {
  userId: string;           // User ID (Privy DID or internal ID)
  competitionId: string;    // Competition UUID
  count: number;            // Number of tickets to reserve (1-100)
  ticketPrice?: number;     // Price per ticket (defaults to 1)
  sessionId?: string;       // Optional session ID for idempotency
  holdMinutes?: number;     // Hold duration (1-60, defaults to 15)
}
```

#### Success Response (200)

```typescript
interface LuckyDipReserveResponse {
  success: true;
  reservationId: string;    // UUID for the reservation
  ticketNumbers: number[];  // Array of selected ticket numbers
  ticketCount: number;      // Number of tickets reserved
  totalAmount: number;      // Total price (count × ticketPrice)
  expiresAt: string;        // ISO timestamp when hold expires
  vrfSeed: string;          // Partial VRF seed for verification
  algorithm: string;        // "VRF-Fisher-Yates-xorshift128+"
  message: string;          // Human-readable message
}
```

#### Error Responses

**409 Insufficient Availability:**
```json
{
  "success": false,
  "error": "Insufficient availability",
  "errorCode": 409,
  "available_count": 3,
  "message": "Only 3 tickets available"
}
```

**400 Invalid Input:**
```json
{
  "success": false,
  "error": "count is required and must be between 1 and 100",
  "errorCode": 400
}
```

**404 Competition Not Found:**
```json
{
  "success": false,
  "error": "Competition not found",
  "errorCode": 404
}
```

#### Example Usage (React)

```typescript
import { supabase } from '../lib/supabase';

async function reserveLuckyDip(
  userId: string,
  competitionId: string,
  count: number,
  ticketPrice: number
) {
  const { data, error } = await supabase.functions.invoke('lucky-dip-reserve', {
    body: JSON.stringify({
      userId,
      competitionId,
      count,
      ticketPrice,
      sessionId: crypto.randomUUID(),
      holdMinutes: 15,
    }),
  });

  if (error) {
    // Handle error
    if (error.message?.includes('409')) {
      // Insufficient availability
      console.error('Not enough tickets available:', data?.available_count);
    }
    throw error;
  }

  if (!data?.success) {
    throw new Error(data?.error || 'Reservation failed');
  }

  return {
    reservationId: data.reservationId,
    ticketNumbers: data.ticketNumbers,
    expiresAt: data.expiresAt,
  };
}
```

---

### 2. Standard Reserve Tickets (for manual selection)

**Endpoint:** `POST /functions/v1/reserve-tickets`

**Description:** Reserves SPECIFIC ticket numbers chosen by the user.

#### Request Body

```typescript
interface ReserveTicketsRequest {
  userId: string;
  competitionId: string;
  selectedTickets: number[];  // Specific ticket numbers to reserve
  ticketPrice?: number;
  sessionId?: string;
}
```

#### Response

```typescript
interface ReserveTicketsResponse {
  success: boolean;
  reservationId: string;
  ticketNumbers: number[];
  ticketCount: number;
  totalAmount: number;
  expiresAt: string;
  message: string;
}
```

---

### 3. Confirm Pending Tickets (after payment)

**Endpoint:** `POST /functions/v1/confirm-pending-tickets`

**Description:** Finalizes reserved tickets after successful payment.

#### Request Body

```typescript
interface ConfirmTicketsRequest {
  reservationId: string;      // From reserve response
  userId: string;
  competitionId: string;
  transactionHash?: string;   // Payment transaction hash
  paymentProvider: string;    // "base_wallet" | "onchainkit" | "balance" | etc.
  walletAddress?: string;
  network?: string;           // e.g., "base"
}
```

#### Response

```typescript
interface ConfirmTicketsResponse {
  success: boolean;
  entry_id: string;
  ticket_numbers: number[];
  competition_id: string;
  instant_wins?: Array<{
    ticket_number: number;
    prize_name: string;
    prize_value: number;
  }>;
}
```

---

## Frontend Integration Checklist

### 1. Lucky Dip Flow (PremiumDrawTicketSelector)

```typescript
// Step 1: User sets count with slider
const [ticketCount, setTicketCount] = useState(1);

// Step 2: On checkout, call lucky-dip-reserve
const handleCheckout = async () => {
  const response = await reserveLuckyDip(
    userId,
    competitionId,
    ticketCount,
    ticketPrice
  );

  // Store for payment flow
  setSelectedTickets(response.ticketNumbers);
  setReservationId(response.reservationId);
  setExpiresAt(response.expiresAt);

  // Show payment modal
  setShowPaymentModal(true);
};

// Step 3: On payment success, call confirm-pending-tickets
const handlePaymentSuccess = async (transactionHash: string) => {
  await confirmTickets({
    reservationId,
    userId,
    competitionId,
    transactionHash,
    paymentProvider: 'base_wallet',
  });

  // Refresh availability
  await fetchAvailableTickets();
};
```

### 2. Manual Selection Flow (TicketSelectorWithTabs)

```typescript
// Step 1: User clicks on specific ticket numbers
const handleTicketSelect = (ticketNumber: number) => {
  setSelectedTickets(prev => [...prev, ticketNumber]);
};

// Step 2: On checkout, call reserve-tickets
const handleCheckout = async () => {
  const response = await reserveTickets({
    userId,
    competitionId,
    selectedTickets,
    ticketPrice,
  });

  setReservationId(response.reservationId);
  setShowPaymentModal(true);
};
```

### 3. Error Handling

```typescript
try {
  const response = await reserveLuckyDip(userId, competitionId, count, price);
} catch (error) {
  if (error.available_count !== undefined) {
    // Insufficient availability
    showError(`Only ${error.available_count} tickets available`);

    // Option A: Auto-reduce count
    setTicketCount(error.available_count);

    // Option B: Ask user
    showPrompt(`Only ${error.available_count} available. Continue?`);
  } else if (error.errorCode === 404) {
    showError('Competition not found');
  } else {
    showError('Failed to reserve tickets. Please try again.');
  }

  // Refresh availability
  await fetchAvailableTickets();
}
```

---

## Database Objects

### View: `v_competition_available_now`

Returns currently available ticket numbers per competition.

```sql
SELECT * FROM v_competition_available_now
WHERE competition_id = 'uuid-here';
```

**Excludes:**
- Sold tickets (from `tickets` table)
- Confirmed entries (from `joincompetition` table)
- Active pending holds (from `pending_tickets` where status='pending' and not expired)

### RPC: `get_available_ticket_count(competition_id UUID)`

Returns the count of available tickets for quick availability checks.

```typescript
const { data: count } = await supabase.rpc('get_available_ticket_count', {
  p_competition_id: competitionId,
});
```

### RPC: `reserve_tickets_atomically(...)`

Existing atomic reservation function used by both reserve-tickets and lucky-dip-reserve.

---

## VRF Algorithm Details

The lucky dip uses a cryptographically secure VRF implementation:

1. **Seed Generation:** 256-bit cryptographically random seed
2. **PRNG:** xorshift128+ algorithm for high-quality pseudo-random numbers
3. **Selection:** Fisher-Yates partial shuffle for efficient unique selection
4. **Determinism:** Same seed + same available pool = same result (verifiable)

```typescript
// The algorithm identifier returned in responses
algorithm: 'VRF-Fisher-Yates-xorshift128+'
```

The partial VRF seed is returned in responses for verification purposes. Users can verify that their ticket selection was fair and deterministic.

---

## Security Notes

1. **Server-Side Selection:** Ticket selection happens server-side, preventing client manipulation
2. **Atomic Operations:** Uses PostgreSQL transactions to prevent race conditions
3. **Hold Expiry:** Reservations automatically expire after 15 minutes (configurable)
4. **Idempotency:** Using sessionId prevents duplicate reservations on retry
5. **Conflict Handling:** On race conditions, the system retries with fresh availability

---

## Testing

### Manual Testing

1. Set lucky dip slider to 5 tickets
2. Click "Lucky Dip" or "Checkout"
3. Verify 5 random ticket numbers are displayed
4. Complete payment
5. Verify tickets appear in user's entries

### Edge Cases

1. **Low Availability:** Request 10 tickets when only 5 available → Should return 409 with `available_count: 5`
2. **Race Condition:** Two users try to reserve last ticket → One succeeds, other gets 409
3. **Expired Hold:** Wait 15+ minutes before payment → Reservation expires, tickets released
4. **Retry:** Click checkout twice quickly → Same sessionId prevents duplicate reservation
