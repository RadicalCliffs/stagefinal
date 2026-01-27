# Top-Up Edge Function Error - Troubleshooting Guide

## Problem
Users are getting "edge function error" when trying to top up their wallet using Coinbase Onramp.

## Root Causes

### 1. Missing Coinbase API Keys (CRITICAL)
The `onramp-init` Supabase Edge Function requires two environment variables that are **NOT** automatically set:

- `CDC_CLIENT_API_KEY` - Coinbase Developer Platform API Key Name
- `CDC_SECRET_API_KEY` - Coinbase Developer Platform API Key Secret

**Error Message:**
```
Missing CDC_CLIENT_API_KEY or CDC_SECRET_API_KEY environment variable
```

### 2. How to Fix

#### Step 1: Get Coinbase API Keys
1. Go to https://portal.cdp.coinbase.com/access/api
2. Create a new API key
3. Copy the API Key Name (this is `CDC_CLIENT_API_KEY`)
4. Copy the API Key Secret (this is `CDC_SECRET_API_KEY`)

#### Step 2: Set Environment Variables in Supabase
You need to set these variables in your Supabase Edge Functions environment:

**Via Supabase Dashboard:**
1. Go to your Supabase project dashboard
2. Navigate to Edge Functions → Configuration
3. Add the following secrets:
   - `CDC_CLIENT_API_KEY` = your API key name from Coinbase
   - `CDC_SECRET_API_KEY` = your API key secret from Coinbase

**Via Supabase CLI:**
```bash
# Set the API keys as edge function secrets
supabase secrets set CDC_CLIENT_API_KEY=your_api_key_name
supabase secrets set CDC_SECRET_API_KEY=your_api_key_secret
```

#### Step 3: Redeploy Edge Functions
After setting the secrets, you may need to redeploy the edge functions:

```bash
supabase functions deploy onramp-init
```

### 3. Other Possible Causes

#### Client IP Detection Issues
The Coinbase API requires a valid client IP address. The edge function tries to extract this from headers:
- `cf-connecting-ip` (Cloudflare)
- `x-real-ip` (Nginx)
- `x-forwarded-for` (Standard proxy header)

If all fail, it falls back to `0.0.0.0` which may be rejected by Coinbase.

**Solution:** Ensure your proxy/CDN is forwarding the client IP properly.

#### Invalid JWT Generation
The edge function generates a JWT to authenticate with Coinbase API. If the API keys are wrong, JWT generation will fail.

**Error Message:**
```
Coinbase API error: 401 - Unauthorized
```

**Solution:** Double-check that you copied the correct API key name and secret.

#### CORS Issues
If the request is being blocked by CORS, check that your domain is in the allowed origins list in `onramp-init/index.ts`:

```typescript
const ALLOWED_ORIGINS = [
  'https://vocal-cascaron-bcef9b.netlify.app',
  'https://stage.theprize.io',
  'https://theprize.io',
  'https://www.theprize.io',
  'http://localhost:3000',
  'http://localhost:5173',
];
```

## Verification Steps

### 1. Check Edge Function Logs
View the Supabase Edge Function logs to see the exact error:

```bash
supabase functions logs onramp-init
```

Look for:
- `Missing CDC_CLIENT_API_KEY or CDC_SECRET_API_KEY`
- `Coinbase API error: XXX`
- Client IP address (should not be `0.0.0.0`)

### 2. Test the Edge Function Directly
You can test the edge function with curl:

```bash
curl -X POST https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/onramp-init \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{
    "destinationAddress": "0x1234567890123456789012345678901234567890",
    "destinationNetwork": "base",
    "assets": ["USDC"],
    "defaultAsset": "USDC"
  }'
```

### 3. Check Environment Variables
Verify the secrets are set:

```bash
supabase secrets list
```

You should see `CDC_CLIENT_API_KEY` and `CDC_SECRET_API_KEY` in the list.

## Related Files
- `/supabase/functions/onramp-init/index.ts` - Edge function implementation
- `/.env.example` - Updated with documentation for CDC keys
- `/src/lib/coinbaseClient.ts` - Client that calls the edge function

## Impact
Without these environment variables set:
- ✅ Instant wallet top-ups (direct USDC transfer) - Still works
- ✅ Balance payments - Now fixed with migration 20260127040000
- ❌ Coinbase Onramp (buy crypto with fiat) - Will fail
- ✅ OnchainKit components - Still work for other features

## Priority
**HIGH** - This affects users who want to buy crypto with fiat (credit card, bank transfer) to top up their wallet.
