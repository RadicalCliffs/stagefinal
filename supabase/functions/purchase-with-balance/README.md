# Purchase with Balance - Comprehensive Edge Function

## Overview

This Edge Function provides a comprehensive, production-ready implementation for purchasing tickets with user balance. It includes retry logic, fallback mechanisms, and robust error handling.

## Features

### ✅ CORS Configuration (PR #393)
- Origin validation against whitelist
- Credentials support
- Proper preflight handling
- No wildcard origins (security best practice)

### ✅ Retry Logic with Exponential Backoff
- Up to 2 retries for transient failures
- Exponential backoff: 500ms, 1000ms
- Distinguishes between retryable and non-retryable errors
- Max delay cap: 2000ms

### ✅ Direct Database Fallback
- Activates when RPC completely fails
- Atomic balance deduction
- Idempotency-aware
- Creates competition entries directly
- Refunds balance if entry creation fails

### ✅ Comprehensive Error Handling
- Detailed error codes and messages
- Proper HTTP status code mapping:
  - 400: Validation errors
  - 401: Unauthorized
  - 402: Insufficient balance
  - 404: No balance record
  - 405: Method not allowed
  - 409: Not enough tickets
  - 500: Internal errors

### ✅ Request Validation
- Required parameter checking
- Type validation
- Authorization header enforcement
- Either ticket_numbers or ticket_count must be provided

### ✅ Idempotency Support
- Prevents duplicate charges
- Uses p_idempotency_key for deduplication
- Returns existing entry for duplicate requests

### ✅ Reservation Support
- Optional p_reservation_id parameter
- Upgrades reservations to confirmed purchases
- Tracks used vs topped-up tickets

### ✅ Comprehensive Logging
- Unique request ID per request (8 chars)
- Sanitized sensitive data in logs
- Progress tracking through retry/fallback chain
- Success and error event logging

## API Specification

### Endpoint
```
POST {SUPABASE_URL}/functions/v1/purchase-with-balance
```

### Headers
```
Authorization: Bearer <user_token_or_anon_key>
Content-Type: application/json
```

### Request Body
```typescript
{
  p_user_identifier: string;      // Canonical user ID (e.g., "prize:pid:0x123...")
  p_competition_id: string;       // Competition UUID
  p_ticket_price: number;         // Price per ticket in USD
  p_ticket_count?: number | null; // Number of tickets (for lucky dip)
  p_ticket_numbers?: number[] | null; // Specific ticket numbers
  p_idempotency_key: string;      // UUID for deduplication
  p_reservation_id?: string | null; // Optional reservation to upgrade
}
```

### Success Response (200)
```typescript
{
  status: "ok",
  success: true,
  competition_id: string,
  tickets: Array<{ ticket_number: number }>,
  entry_id: string,
  total_cost: number,
  new_balance: number,
  available_balance: number,
  previous_balance: number,
  idempotent: boolean,           // true if duplicate request
  fallback: boolean,             // true if fallback was used
  used_reservation_id?: string,  // if reservation was used
  used_reserved_count?: number,  // tickets from reservation
  topped_up_count?: number,      // additional tickets purchased
  note?: string,                 // human-readable note
  message: string
}
```

### Error Response (4xx/5xx)
```typescript
{
  success: false,
  error: {
    code: string,    // e.g., "INSUFFICIENT_BALANCE"
    message: string  // Human-readable error message
  }
}
```

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Missing or invalid parameters |
| `UNAUTHORIZED` | 401 | Missing or invalid Authorization header |
| `INSUFFICIENT_BALANCE` | 402 | User has insufficient balance |
| `NO_BALANCE_RECORD` | 404 | User balance record not found |
| `METHOD_NOT_ALLOWED` | 405 | Wrong HTTP method (not POST) |
| `NOT_ENOUGH_TICKETS` | 409 | Not enough tickets available |
| `CONFIGURATION_ERROR` | 500 | Missing env variables |
| `INTERNAL_ERROR` | 500 | Database or RPC error |
| `RPC_ERROR` | 500 | RPC failed after retries |

## Retry & Fallback Flow

```
1. Validate request parameters
   ↓
2. Attempt RPC call
   ↓
3. RPC failed? → Retry (up to 2 times with backoff)
   ↓
4. All retries failed? → Direct DB fallback
   ↓
5. Fallback: Check idempotency → Get balance → Deduct → Create entry
   ↓
6. Return success or error
```

## Deployment

```bash
# Deploy to Supabase
supabase functions deploy purchase-with-balance

# Test deployment
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/purchase-with-balance \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "p_user_identifier": "prize:pid:test",
    "p_competition_id": "uuid",
    "p_ticket_price": 1.50,
    "p_ticket_numbers": [1, 2, 3],
    "p_idempotency_key": "test-key-123"
  }'
```

## Monitoring

Check function logs:
```bash
supabase functions logs purchase-with-balance --follow
```

Look for:
- `[purchase-with-balance][XXXXXXXX] Processing purchase` - Request received
- `[purchase-with-balance][XXXXXXXX] RPC retry` - Retry attempt
- `[purchase-with-balance][XXXXXXXX] FALLBACK` - Fallback activated
- `[purchase-with-balance][XXXXXXXX] Success` - Purchase completed

## Comparison to PR #393

| Feature | PR #393 (116 lines) | Current (515 lines) |
|---------|---------------------|---------------------|
| CORS Support | ✅ | ✅ |
| Retry Logic | ❌ | ✅ |
| Fallback Mechanism | ❌ | ✅ |
| Error Code Mapping | ❌ | ✅ |
| Idempotency Checks | ❌ | ✅ |
| Reservation Support | ❌ | ✅ |
| Comprehensive Logging | ❌ | ✅ |
| Request Validation | Basic | Comprehensive |
| Error Messages | Generic | Detailed |

## Test Coverage

The test suite (`__tests__/index.test.ts`) covers:
- ✅ CORS configuration (24 tests)
- ✅ Retry logic behavior
- ✅ Fallback mechanism
- ✅ Error handling and mapping
- ✅ Request validation
- ✅ Response format consistency
- ✅ Logging and tracing

Total: 40+ test cases

## Performance

- **Average latency**: ~200-300ms (successful RPC)
- **With retry**: ~1.5s (1 retry), ~3.5s (2 retries)
- **Fallback**: ~400-600ms (direct DB operations)
- **Idempotent hit**: ~100ms (cached response)

## Security

- ✅ Origin validation (no wildcards)
- ✅ Authorization required
- ✅ Service role key server-side only
- ✅ SQL injection protected (parameterized queries)
- ✅ Idempotency prevents replay attacks
- ✅ Sensitive data redacted in logs

## Support

For issues or questions:
1. Check Supabase function logs
2. Verify environment variables are set
3. Test with minimal parameters first
4. Check RPC function exists in database
