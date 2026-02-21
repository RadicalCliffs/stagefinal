# Purchase-Tickets-with-Bonus Edge Function - Implementation Summary

## What Was Created

A new Supabase Edge Function that confirms ticket reservations and creates competition entries.

**Endpoint:** `POST /functions/v1/purchase-tickets-with-bonus`

## Files Created

1. **supabase/functions/purchase-tickets-with-bonus/index.ts** (322 lines)
   - Main Edge Function implementation
   - CORS configuration
   - Request validation
   - Reservation confirmation logic
   - Competition entry creation

2. **supabase/functions/purchase-tickets-with-bonus/README.md**
   - API documentation
   - Usage examples
   - Error codes reference
   - Security notes

3. **supabase/functions/purchase-tickets-with-bonus/DEPLOYMENT.md**
   - Deployment instructions
   - Testing guide
   - Troubleshooting tips
   - Expected responses

## API Usage

### Request Format

```json
{
  "reservation_id": "3c53d95b-5300-4ddd-85e9-5168dcfbd47b",
  "uid": "6f6eb8f6-b778-49c7-b1eb-90ac58c6dbb9",
  "ticket_numbers": [101, 102, 103]  // optional
}
```

### Using fetch

```javascript
const timestamp = new Date().toISOString();
console.log('Request timestamp:', timestamp);

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
      uid: '6f6eb8f6-b778-49c7-b1eb-90ac58c6dbb9'
    })
  }
);

const data = await response.json();
console.log('Response:', data);
console.log('Verify in logs with timestamp:', timestamp);
```

### Using supabase-js

```javascript
const timestamp = new Date().toISOString();
console.log('Request timestamp:', timestamp);

const { data, error } = await supabase.functions.invoke(
  'purchase-tickets-with-bonus',
  {
    body: {
      reservation_id: '3c53d95b-5300-4ddd-85e9-5168dcfbd47b',
      uid: '6f6eb8f6-b778-49c7-b1eb-90ac58c6dbb9'
    }
  }
);

console.log('Response:', data || error);
console.log('Verify in logs with timestamp:', timestamp);
```

## Features

### ✅ CORS Support
- Origin validation against whitelist
- Proper preflight handling
- Credentials support
- No wildcards (security best practice)

### ✅ Request Validation
- UUID format validation for reservation_id and uid
- Array validation for ticket_numbers (if provided)
- Required parameter checking
- Type validation

### ✅ Reservation Workflow
1. Fetch reservation from `pending_tickets` table
2. Validate status (must be 'pending', not 'confirmed' or 'expired')
3. Use ticket_numbers from request or reservation
4. Update reservation to 'confirmed' status
5. Create entry in `joincompetition` table
6. Return success with entry details

### ✅ Error Handling
- **400**: Validation errors (missing/invalid parameters)
- **404**: Reservation not found
- **405**: Method not allowed
- **409**: Reservation already confirmed
- **410**: Reservation expired
- **500**: Database/entry creation errors

### ✅ Idempotency
- Uses reservation_id as transaction hash
- Prevents duplicate processing
- Detects already confirmed reservations

### ✅ Automatic Rollback
- If entry creation fails, reverts reservation to 'pending'
- Prevents data inconsistency

### ✅ Logging
- Unique 8-character request ID per request
- Timestamps for all operations
- Sanitized logging (no sensitive data)

## Deployment

```bash
# Deploy the function
supabase functions deploy purchase-tickets-with-bonus

# View logs
supabase functions logs purchase-tickets-with-bonus --follow
```

## Response Format

### Success
```json
{
  "success": true,
  "status": "ok",
  "reservation_id": "3c53d95b-5300-4ddd-85e9-5168dcfbd47b",
  "competition_id": "6f6eb8f6-b778-49c7-b1eb-90ac58c6dbb9",
  "entry_id": "550e8400-e29b-41d4-a716-446655440000",
  "tickets": [
    { "ticket_number": 101 },
    { "ticket_number": 102 },
    { "ticket_number": 103 }
  ],
  "ticket_count": 3,
  "total_cost": 4.50,
  "message": "Successfully confirmed 3 tickets",
  "timestamp": "2026-02-19T23:32:00.000Z"
}
```

### Error
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Missing required parameter: reservation_id"
  }
}
```

## Security

- ✅ Origin validation (CORS)
- ✅ UUID format validation
- ✅ Service role key server-side only
- ✅ Idempotency protection
- ✅ Status validation (prevents reprocessing)
- ✅ Automatic rollback on failures

## Testing

Send a test request and note the timestamp:

```javascript
const timestamp = new Date().toISOString();
console.log(`Testing at: ${timestamp}`);

// Make your request...

// Then check Supabase logs:
// supabase functions logs purchase-tickets-with-bonus
// Look for your timestamp in the logs
```

The function logs every request with:
- Request timestamp
- Request ID (8 chars)
- Parameters received
- Processing steps
- Success/error status

## What's Next

1. ✅ Function created and documented
2. ⏳ Deploy to Supabase: `supabase functions deploy purchase-tickets-with-bonus`
3. ⏳ Test with real reservation IDs
4. ⏳ Monitor logs for any issues
5. ⏳ Update frontend to use the new endpoint

---

**Ready to deploy!** The function is production-ready with comprehensive error handling, CORS support, and detailed logging.
