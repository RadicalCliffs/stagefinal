# Edge Function Deployment Instructions

## Prerequisites

1. Supabase CLI installed: `npm install -g supabase`
2. Logged in to Supabase CLI: `supabase login`
3. Linked to your project: `supabase link --project-ref YOUR_PROJECT_REF`

## Deployment Steps

### 1. Deploy the Edge Function

```bash
# From the root of the repository
supabase functions deploy purchase-with-balance
```

### 2. Verify Deployment

```bash
# List all deployed functions
supabase functions list

# You should see 'purchase-with-balance' in the list
```

### 3. Test the Edge Function

#### Using curl:

```bash
# Get your user token (from browser console or auth flow)
# Or use the anon key for testing

curl -X POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/purchase-with-balance \
  -H "Authorization: Bearer YOUR_USER_TOKEN_OR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "p_user_identifier": "test-user-canonical-id",
    "p_competition_id": "550e8400-e29b-41d4-a716-446655440000",
    "p_ticket_price": 1.50,
    "p_ticket_count": 3,
    "p_ticket_numbers": [10, 20, 30],
    "p_idempotency_key": "test-idempotency-key-123"
  }'
```

#### Expected Success Response:

```json
{
  "status": "ok",
  "entry_id": "...",
  "tickets": [...],
  "new_balance": 98.50,
  "total_cost": 4.50
}
```

#### Expected Error Response (insufficient balance):

```json
{
  "error": "Insufficient balance"
}
```

### 4. View Logs

```bash
# View real-time logs
supabase functions logs purchase-with-balance --follow

# View recent logs
supabase functions logs purchase-with-balance
```

## Environment Variables

The Edge Function automatically has access to:

- `SUPABASE_URL` - Your project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Your service role key

These are automatically injected by Supabase and do not need to be configured manually.

## Integration with Frontend

Once deployed, update your frontend code to use the new function:

```typescript
import { purchaseWithBalanceViaEdge } from '@/lib/purchase-with-balance-client';
import { supabase } from '@/lib/supabase';

const result = await purchaseWithBalanceViaEdge({
  p_user_identifier: canonicalUserId,
  p_competition_id: competitionId,
  p_ticket_price: ticketPrice,
  p_ticket_count: ticketCount,
  p_ticket_numbers: ticketNumbers,
  p_idempotency_key: crypto.randomUUID(),
  supabaseClient: supabase,
});
```

## Troubleshooting

### Function not found (404)

- Verify deployment: `supabase functions list`
- Check project ref is correct
- Re-deploy: `supabase functions deploy purchase-with-balance`

### Authorization error

- Check that you're passing a valid user token or anon key
- Verify the token is not expired
- Ensure the Authorization header is formatted correctly: `Bearer TOKEN`

### RPC error

- Verify the `purchase_tickets_with_balance` function exists in your database
- Check Supabase logs for database errors
- Ensure the RPC function has correct permissions

### Service role key error

- This should not happen in production as Supabase automatically injects it
- If testing locally, ensure you've set up local development correctly

## Local Development

To test the Edge Function locally:

```bash
# Start Supabase locally
supabase start

# Serve the function locally
supabase functions serve purchase-with-balance

# The function will be available at:
# http://localhost:54321/functions/v1/purchase-with-balance
```

## Monitoring

After deployment, monitor the function:

1. Check Supabase Dashboard → Edge Functions → purchase-with-balance
2. View metrics: invocations, errors, duration
3. Set up alerts for high error rates
4. Review logs regularly for issues

## Security Notes

✅ Service role key is safe - runs on server, never exposed to client
✅ User authentication required - function validates the user token
✅ RPC permissions enforced - database function has its own security
⚠️ Rate limiting - consider implementing if needed
⚠️ Input validation - function validates required parameters

## Next Steps

1. Deploy the function to production
2. Test with real user credentials
3. Monitor error rates and performance
4. Update any existing purchase flows to use the new function
5. Consider adding monitoring/alerting
