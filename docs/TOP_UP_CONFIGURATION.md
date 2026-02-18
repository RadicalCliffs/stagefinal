# Top-Up Wallet Configuration Guide

## Overview

The Prize platform supports wallet top-ups via **Coinbase Commerce**, allowing users to add funds to their balance using 60+ cryptocurrencies.

## Architecture

```
User clicks "Top Up"
        ↓
TopUpWalletModal opens
        ↓
Select amount (e.g., $50)
        ↓
Frontend: /api/create-charge
        ↓
Netlify Function: create-charge-proxy.mts
        ↓
Supabase Edge Function: create-charge
        ↓
Coinbase Commerce API
        ↓
User pays with crypto
        ↓
Coinbase Commerce webhook
        ↓
Supabase Edge Function: commerce-webhook
        ↓
User balance credited (with 50% first-deposit bonus if eligible)
```

## Required Environment Variables

### Frontend (Client-Side)

These are safe to expose in the frontend bundle:

```bash
# CDP Project ID - MUST be set to the same value in both variables
VITE_CDP_PROJECT_ID=your-project-id-here
VITE_ONCHAINKIT_PROJECT_ID=your-project-id-here

# CDP Client API Key (for OnchainKit)
VITE_CDP_CLIENT_API_KEY=your-client-api-key-here

# Treasury address where payments are received
VITE_TREASURY_ADDRESS=0xYourTreasuryAddressHere

# Network configuration
VITE_BASE_MAINNET=true  # or false for testnet
```

### Backend (Server-Side Only)

These must be kept secret and set in Supabase Edge Function secrets:

```bash
# Coinbase Commerce API Key
COINBASE_COMMERCE_API_KEY=your-commerce-api-key-here

# Supabase credentials
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Success redirect URL
SUCCESS_URL=https://yourdomain.com
```

### Netlify Functions

These must be set in Netlify environment variables:

```bash
# For the create-charge-proxy function
SUPABASE_FUNCTIONS_URL=https://your-project.supabase.co/functions/v1
VITE_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

## How to Get API Keys

### 1. CDP Project ID

1. Go to https://portal.cdp.coinbase.com
2. Sign in with your Coinbase account
3. Create a new project or select an existing one
4. Copy the Project ID
5. Set both `VITE_CDP_PROJECT_ID` and `VITE_ONCHAINKIT_PROJECT_ID` to this value

### 2. CDP Client API Key

1. In the CDP Portal (https://portal.cdp.coinbase.com)
2. Go to API Keys
3. Create a new Client API Key (frontend-safe)
4. Copy the key and set it as `VITE_CDP_CLIENT_API_KEY`

### 3. Coinbase Commerce API Key

1. Go to https://commerce.coinbase.com/dashboard
2. Sign in with your Coinbase account
3. Navigate to Settings → API Keys
4. Create a new API key
5. Copy the key and set it in Supabase Edge Function secrets:
   ```bash
   # Using Supabase CLI
   supabase secrets set COINBASE_COMMERCE_API_KEY=your-key-here
   ```

### 4. Treasury Address

This is your business wallet where all payments are received:

1. Create a secure wallet (hardware wallet recommended for production)
2. Get the wallet address (starts with 0x)
3. Set `VITE_TREASURY_ADDRESS` to this address

**IMPORTANT**: Keep the private key for this wallet extremely secure. All customer payments go here.

## Setting Up Supabase Edge Function Secrets

The Coinbase Commerce API key must be set in Supabase:

```bash
# Using Supabase CLI (recommended)
cd /path/to/theprize.io
supabase link --project-ref your-project-ref
supabase secrets set COINBASE_COMMERCE_API_KEY=your-key-here
supabase secrets set SUCCESS_URL=https://yourdomain.com
```

Or manually in the Supabase Dashboard:
1. Go to Project Settings → Edge Functions
2. Add secret: `COINBASE_COMMERCE_API_KEY`
3. Add secret: `SUCCESS_URL`

## Testing the Top-Up Flow

### Local Development

1. Set all required environment variables in `.env`:
   ```bash
   cp .env.example .env
   # Edit .env and fill in all values
   ```

2. Start the Supabase Edge Functions locally:
   ```bash
   supabase functions serve
   ```

3. Start the frontend development server:
   ```bash
   npm run dev
   ```

4. Test the flow:
   - Navigate to the dashboard
   - Click "Top Up"
   - Select an amount
   - Verify the checkout URL is generated
   - Complete a test payment (use testnet)

### Production

1. Deploy Supabase Edge Functions:
   ```bash
   supabase functions deploy create-charge
   supabase functions deploy commerce-webhook
   ```

2. Deploy to Netlify:
   ```bash
   npm run build
   # Deploy to Netlify (automatic via GitHub integration)
   ```

3. Verify environment variables are set:
   - Netlify: Check Site Settings → Environment Variables
   - Supabase: Check Project Settings → Edge Functions → Secrets

## Troubleshooting

### Issue: "No CDP project ID configured"

**Solution**: Ensure both `VITE_CDP_PROJECT_ID` and `VITE_ONCHAINKIT_PROJECT_ID` are set to the same value in your environment.

### Issue: "Payment service configuration error - missing API key"

**Solution**: The `COINBASE_COMMERCE_API_KEY` is not set in Supabase Edge Function secrets. Set it using:
```bash
supabase secrets set COINBASE_COMMERCE_API_KEY=your-key-here
```

### Issue: "Failed to create checkout"

**Causes**:
1. Invalid Coinbase Commerce API key
2. Supabase Edge Function not deployed
3. Network connectivity issues

**Debug steps**:
1. Check Supabase Edge Function logs:
   ```bash
   supabase functions logs create-charge
   ```
2. Verify API key is valid in Commerce dashboard
3. Test the Edge Function directly:
   ```bash
   curl -X POST https://your-project.supabase.co/functions/v1/create-charge \
     -H "Content-Type: application/json" \
     -H "apikey: your-anon-key" \
     -d '{"userId":"test-user","totalAmount":10,"type":"topup"}'
   ```

### Issue: Payments not crediting balance

**Causes**:
1. Webhook not configured in Coinbase Commerce
2. commerce-webhook Edge Function not deployed
3. Database permissions issues

**Debug steps**:
1. Check webhook configuration in Coinbase Commerce:
   - URL: `https://your-project.supabase.co/functions/v1/commerce-webhook`
   - Make sure it's active
2. Check webhook logs:
   ```bash
   supabase functions logs commerce-webhook
   ```
3. Verify balance_ledger entries:
   ```sql
   SELECT * FROM balance_ledger 
   WHERE canonical_user_id = 'prize:pid:your-user-id' 
   ORDER BY created_at DESC;
   ```

## Payment Methods Available

The TopUpWalletModal supports multiple payment methods:

1. **Coinbase Commerce** (Default, Recommended)
   - Supports 60+ cryptocurrencies
   - Works with Coinbase account or any crypto wallet
   - Hosted checkout page (redirects user)
   - 50% first-deposit bonus applied automatically

2. **OnchainKit Crypto Checkout** (Alternative)
   - In-app modal (no redirect)
   - Supports Bitcoin, Ethereum, Litecoin, etc.
   - Requires CDP project ID configured

3. **Base Account** (For entries only, not top-ups)
   - One-tap USDC payment
   - Uses Base Account SDK
   - Instant confirmation

## First-Deposit Bonus

The system automatically applies a 50% bonus on the first deposit:

- User deposits $100
- Gets $100 in `available_balance`
- Gets $50 in `bonus_balance`
- Total usable balance: $150

This is tracked via the `has_used_new_user_bonus` flag in the `canonical_users` table.

## Database Tables Involved

### user_transactions
Stores all payment transactions:
```sql
SELECT * FROM user_transactions WHERE type = 'topup' ORDER BY created_at DESC;
```

### sub_account_balances
Stores user balances:
```sql
SELECT * FROM sub_account_balances WHERE canonical_user_id = 'prize:pid:user-id';
```

### balance_ledger
Audit trail of all balance changes:
```sql
SELECT * FROM balance_ledger WHERE canonical_user_id = 'prize:pid:user-id' ORDER BY created_at DESC;
```

### bonus_award_audit
Tracks bonus awards:
```sql
SELECT * FROM bonus_award_audit WHERE reason = 'commerce_topup' ORDER BY created_at DESC;
```

## Security Considerations

1. **Never expose backend API keys**: Only `VITE_*` variables are safe for frontend
2. **Validate webhook signatures**: Commerce webhook should verify Coinbase signatures
3. **Use HTTPS only**: All API calls must be over HTTPS
4. **Secure treasury wallet**: Use hardware wallet for production treasury
5. **Monitor transactions**: Set up alerts for unusual payment patterns

## Support

For issues or questions:
1. Check the Supabase Edge Function logs
2. Check the Netlify Function logs
3. Review the Coinbase Commerce dashboard
4. Contact support with transaction ID for payment issues
