# Deployment Guide: purchase-tickets-with-bonus

## Prerequisites

1. Supabase CLI installed: `npm install -g supabase`
2. Logged in to Supabase CLI: `supabase login`
3. Linked to your project: `supabase link --project-ref mthwfldcjvpxjtmrqkqm`

## Deploy the Function

```bash
# From the repository root
cd /home/runner/work/theprize.io/theprize.io

# Deploy the function
supabase functions deploy purchase-tickets-with-bonus

# Verify deployment
supabase functions list
```

## Test the Function

### Using curl

```bash
# Replace with actual reservation_id and competition uid
curl -X POST https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/purchase-tickets-with-bonus \
  -H "Content-Type: application/json" \
  -H "apikey: <your-anon-key>" \
  -H "Authorization: Bearer <your-anon-key>" \
  -d '{
    "reservation_id": "3c53d95b-5300-4ddd-85e9-5168dcfbd47b",
    "uid": "6f6eb8f6-b778-49c7-b1eb-90ac58c6dbb9"
  }'
```

### Using JavaScript

```javascript
// Test with fetch
const timestamp = new Date().toISOString();
console.log(`Testing at: ${timestamp}`);

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
console.log('Response:', data);
console.log('Test timestamp:', timestamp);
```

## View Logs

```bash
# View real-time logs
supabase functions logs purchase-tickets-with-bonus --follow

# View recent logs
supabase functions logs purchase-tickets-with-bonus
```

## Expected Responses

### Success (200)
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

### Error - Missing Parameter (400)
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Missing required parameter: reservation_id"
  }
}
```

### Error - Not Found (404)
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Reservation not found"
  }
}
```

### Error - Already Confirmed (409)
```json
{
  "success": false,
  "error": {
    "code": "ALREADY_PROCESSED",
    "message": "Reservation already confirmed"
  }
}
```

## Troubleshooting

### Function not found (404)
- Verify deployment: `supabase functions list`
- Redeploy: `supabase functions deploy purchase-tickets-with-bonus`

### CORS errors
- Check request origin is in ALLOWED_ORIGINS list
- Verify Access-Control-Allow-Origin header in response

### Database errors
- Check that `pending_tickets` table exists
- Verify `joincompetition` table structure
- Check user has proper permissions

### Validation errors
- Ensure reservation_id and uid are valid UUIDs
- Check ticket_numbers is an array of integers (if provided)

## Monitoring

Look for these log patterns:
- `[purchase-tickets-with-bonus][XXXXXXXX] POST request received` - Request logged
- `[purchase-tickets-with-bonus][XXXXXXXX] Fetching reservation` - Processing started
- `[purchase-tickets-with-bonus][XXXXXXXX] Confirming N tickets` - Creating entry
- `[purchase-tickets-with-bonus][XXXXXXXX] Purchase successful!` - Completed

## Security Notes

- ✅ Function uses service role key server-side only
- ✅ Origin validation prevents unauthorized domains
- ✅ UUID validation prevents injection attacks
- ✅ Idempotency via reservation_id prevents duplicate processing
- ✅ Automatic rollback on failures
