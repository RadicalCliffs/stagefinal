# Purchase Tickets with Bonus Edge Function

## Overview

This Edge Function confirms ticket reservations and creates competition entries. It accepts a reservation ID and competition UID, then confirms the purchase.

## API Specification

### Endpoint
```
POST {SUPABASE_URL}/functions/v1/purchase-tickets-with-bonus
```

### Headers
```
Authorization: Bearer <user-token-or-anon-key>
Content-Type: application/json
apikey: <anon-key>
```

### Request Body
```typescript
{
  reservation_id: string;      // UUID of the reservation (required)
  uid: string;                 // UUID of the competition (required)
  ticket_numbers?: number[];   // Optional: array of ticket numbers
}
```

### Success Response (200)
```typescript
{
  success: true,
  status: "ok",
  reservation_id: string,
  competition_id: string,
  entry_id: string,
  tickets: Array<{ ticket_number: number }>,
  ticket_count: number,
  total_cost: number,
  message: string,
  timestamp: string
}
```

### Error Response (4xx/5xx)
```typescript
{
  success: false,
  error: {
    code: string,
    message: string
  }
}
```

## Usage Examples

### Using fetch
```typescript
const response = await fetch(
  'https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/purchase-tickets-with-bonus',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': '<your-anon-key>',
      'Authorization': 'Bearer <user-token-or-anon-key>',
    },
    body: JSON.stringify({
      reservation_id: '3c53d95b-5300-4ddd-85e9-5168dcfbd47b',
      uid: '6f6eb8f6-b778-49c7-b1eb-90ac58c6dbb9',
      // ticket_numbers: [101, 102, 103] // optional
    })
  }
);

const data = await response.json();
```

### Using supabase-js
```typescript
const { data, error } = await supabase.functions.invoke(
  'purchase-tickets-with-bonus',
  {
    body: {
      reservation_id: '3c53d95b-5300-4ddd-85e9-5168dcfbd47b',
      uid: '6f6eb8f6-b778-49c7-b1eb-90ac58c6dbb9',
      // ticket_numbers: [101, 102, 103] // optional
    }
  }
);
```

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Missing or invalid parameters |
| `METHOD_NOT_ALLOWED` | 405 | Wrong HTTP method (not POST) |
| `NOT_FOUND` | 404 | Reservation not found |
| `ALREADY_PROCESSED` | 409 | Reservation already confirmed |
| `RESERVATION_EXPIRED` | 410 | Reservation has expired |
| `DATABASE_ERROR` | 500 | Database query failed |
| `UPDATE_ERROR` | 500 | Failed to update reservation |
| `ENTRY_ERROR` | 500 | Failed to create competition entry |
| `CONFIGURATION_ERROR` | 500 | Missing environment variables |
| `INTERNAL_ERROR` | 500 | Unhandled server error |

## Workflow

1. Validate request parameters (reservation_id, uid)
2. Fetch reservation from `pending_tickets` table
3. Check reservation status (must be 'pending', not 'confirmed' or 'expired')
4. Use ticket_numbers from request if provided, otherwise from reservation
5. Update reservation status to 'confirmed'
6. Create entry in `joincompetition` table
7. Return success response with entry details

## CORS Support

The function supports CORS with the following origins:
- https://stage.theprize.io
- https://theprize.io
- https://www.theprize.io
- https://theprizeio.netlify.app
- https://vocal-cascaron-bcef9b.netlify.app
- http://localhost:3000
- http://localhost:5173
- http://localhost:8888

## Logging

Each request generates a unique 8-character request ID for tracing:
```
[purchase-tickets-with-bonus][a1b2c3d4] Processing request
```

## Deployment

```bash
# Deploy to Supabase
supabase functions deploy purchase-tickets-with-bonus

# View logs
supabase functions logs purchase-tickets-with-bonus --follow
```

## Security

- ✅ Origin validation (no wildcards)
- ✅ UUID format validation
- ✅ Reservation status checks
- ✅ Idempotency via reservation_id as transaction hash
- ✅ Automatic rollback on entry creation failure
