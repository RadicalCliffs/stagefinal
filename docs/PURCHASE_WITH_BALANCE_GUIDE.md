# Purchase with Balance - Implementation Guide

This document describes the three-tier implementation for purchasing tickets with balance, providing a robust and secure solution with fallback options.

## Architecture Overview

1. **Edge Function** (`supabase/functions/purchase-with-balance/index.ts`)
   - Runs on Supabase Edge Runtime (Deno)
   - Uses `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS
   - Accepts authenticated requests from browser (user token or anon key)
   - Proxies to the `purchase_tickets_with_balance` RPC function

2. **Browser Client** (`src/lib/purchase-with-balance-client.ts`)
   - Primary method for frontend applications
   - Uses user session token or anon key for authentication
   - Calls the Edge Function endpoint

3. **Server Direct** (`src/lib/purchase-with-balance-server.ts`)
   - Redundancy/fallback option for server environments only
   - **NEVER use in browser** - directly uses service role key
   - For Node.js or Deno server applications only

## Usage Examples

### 1. Browser/Frontend Usage (Primary Method)

```typescript
import { purchaseWithBalanceViaEdge } from '@/lib/purchase-with-balance-client';
import { supabase } from '@/lib/supabase';

async function handlePurchase() {
  try {
    const result = await purchaseWithBalanceViaEdge({
      p_user_identifier: 'user-canonical-id',
      p_competition_id: '550e8400-e29b-41d4-a716-446655440000',
      p_ticket_price: 1.50,
      p_ticket_count: 3, // or null for lucky dip
      p_ticket_numbers: [10, 20, 30], // or null for lucky dip
      p_idempotency_key: crypto.randomUUID(),
      supabaseClient: supabase,
    });
    
    console.log('Purchase successful:', result);
    // Handle success: update UI, show confirmation, etc.
  } catch (error) {
    console.error('Purchase failed:', error);
    // Handle error: show error message to user
  }
}
```

### 2. Server-Only Usage (Fallback/Redundancy)

**IMPORTANT**: Only use this in a trusted server environment (Node.js backend, Deno server, etc.). Never in browser code!

```typescript
// In a Node.js or Deno server file (NOT in browser)
import { serverPurchaseDirect } from '@/lib/purchase-with-balance-server';

async function processServerPurchase() {
  try {
    const result = await serverPurchaseDirect({
      p_user_identifier: 'user-canonical-id',
      p_competition_id: '550e8400-e29b-41d4-a716-446655440000',
      p_ticket_price: 1.50,
      p_ticket_count: 3,
      p_ticket_numbers: [10, 20, 30],
      p_idempotency_key: crypto.randomUUID(),
    });
    
    console.log('Server purchase successful:', result);
  } catch (error) {
    console.error('Server purchase failed:', error);
  }
}
```

## Parameters

All methods accept the same parameters matching the `purchase_tickets_with_balance` RPC function:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `p_user_identifier` | `string` | Yes | User's canonical ID (text) |
| `p_competition_id` | `string` | Yes | Competition UUID |
| `p_ticket_price` | `number` | Yes | Price per ticket (numeric) |
| `p_ticket_count` | `number \| null` | No | Number of tickets (null for selected numbers) |
| `p_ticket_numbers` | `number[] \| null` | No | Specific ticket numbers (null for lucky dip) |
| `p_idempotency_key` | `string` | Yes* | UUID for idempotency (null allowed but recommended) |
| `supabaseClient` | `SupabaseClient` | Yes** | Supabase client instance (browser method only) |

\* Required for browser method, optional for server method  
\** Only required for `purchaseWithBalanceViaEdge`

## Deployment

### Edge Function Deployment

To deploy the Edge Function to Supabase:

```bash
# Using Supabase CLI
supabase functions deploy purchase-with-balance

# Verify deployment
supabase functions list
```

### Environment Variables

The Edge Function requires these environment variables in Supabase:

- `SUPABASE_URL` - Automatically provided by Supabase
- `SUPABASE_SERVICE_ROLE_KEY` - Automatically provided by Supabase

The server-side direct method requires:

- `SUPABASE_SERVICE_ROLE_KEY` - Must be set in your server environment

**Security Warning**: Never expose `SUPABASE_SERVICE_ROLE_KEY` to browser/client code!

## Error Handling

All methods throw errors on failure. Always wrap calls in try/catch:

```typescript
try {
  const result = await purchaseWithBalanceViaEdge({ ... });
  // Success handling
} catch (error) {
  if (error instanceof Error) {
    // Check error message for specific failures
    if (error.message.includes('insufficient balance')) {
      // Handle insufficient balance
    } else if (error.message.includes('404')) {
      // Handle not found
    } else {
      // Generic error handling
    }
  }
}
```

## Testing

To test the implementation:

1. **Edge Function**: Deploy to Supabase and test with curl or Postman
   ```bash
   # Replace YOUR_PROJECT_URL with your actual Supabase project URL
   # e.g., https://your-project.supabase.co
   curl -X POST YOUR_PROJECT_URL/functions/v1/purchase-with-balance \
     -H "Authorization: Bearer YOUR_USER_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "p_user_identifier": "test-user-id",
       "p_competition_id": "test-comp-id",
       "p_ticket_price": 1.0,
       "p_ticket_count": 1,
       "p_idempotency_key": "test-key-123"
     }'
   ```

2. **Browser Client**: Use in your React/Vue/etc. components with proper error handling

3. **Server Direct**: Test in a Node.js script or Deno server environment only

## Migration from Previous Methods

If you're migrating from the old `usePurchaseWithBalance` hook:

1. The hook at `src/hooks/usePurchaseWithBalance.ts` currently calls a different endpoint
2. You can update it to use `purchaseWithBalanceViaEdge` instead
3. Or use `purchaseWithBalanceViaEdge` directly in your components

## Security Considerations

1. ✅ **Edge Function** uses service role key safely on server
2. ✅ **Browser Client** only exposes user token/anon key (safe)
3. ⚠️ **Server Direct** requires service role key - server environment only!
4. 🔒 All methods enforce the same RPC permissions and validations

## Troubleshooting

**Edge Function returns 405**: Using wrong HTTP method, must be POST

**Edge Function returns 400**: Missing required parameters (user_identifier, competition_id, or ticket_price)

**Edge Function returns 500**: Server configuration issue, check Supabase environment variables

**Browser client fails with CORS**: Edge Function not deployed or wrong URL

**Server direct fails**: Service role key not set in environment or not accessible

## Support

For issues or questions:
1. Check Supabase Edge Function logs: `supabase functions logs purchase-with-balance`
2. Verify environment variables are set correctly
3. Test with minimal parameters first
4. Check the RPC function `purchase_tickets_with_balance` exists in database
