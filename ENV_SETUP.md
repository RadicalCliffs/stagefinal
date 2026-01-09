# Environment Variables Setup

This document describes the required environment variables for The Prize application.

## Required Environment Variables

### Coinbase Developer Platform (CDP)

The application uses CDP for embedded wallets and onramp functionality. Both features require the same CDP project ID.

- **VITE_CDP_PROJECT_ID**: `71e24c24-c628-460c-82e3-f830a2b0daf1`
  - Used for CDP React Provider (embedded wallet creation)
  - Must be configured in Netlify environment variables
  
- **VITE_ONCHAINKIT_PROJECT_ID**: `71e24c24-c628-460c-82e3-f830a2b0daf1`
  - Used for OnchainKit onramp functionality
  - Should be the same value as VITE_CDP_PROJECT_ID
  - Has a fallback to VITE_CDP_PROJECT_ID if not set

- **VITE_CDP_API_KEY**: Your CDP API key
  - Get from: https://portal.cdp.coinbase.com
  - Required for OnchainKit RPC calls

**Important**: Make sure your domain is whitelisted in the CDP Portal at:
https://portal.cdp.coinbase.com/products/embedded-wallets/domains

Add:
- `localhost:5173` (for local development)
- Your production domain (e.g., `theprize.io`)

### Supabase

- **VITE_SUPABASE_URL**: Your Supabase project URL
- **VITE_SUPABASE_ANON_KEY**: Your Supabase anonymous key

### Network Configuration

- **VITE_BASE_MAINNET**: Set to `'true'` for Base Mainnet, anything else for Base Sepolia testnet
- **VITE_BASE_MAINNET_RPC**: (Optional) Base Mainnet RPC URL (default: `https://mainnet.base.org`)
- **VITE_BASE_SEPOLIA_RPC**: (Optional) Base Sepolia RPC URL (default: `https://sepolia.base.org`)

### Treasury & Contracts

- **VITE_TREASURY_ADDRESS**: The wallet address that receives payments
- **VITE_USDC_CONTRACT_ADDRESS**: (Optional) USDC contract address
  - Auto-selected based on network if not provided:
  - Mainnet: `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`
  - Sepolia: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`

### Commerce (Optional)

- **VITE_COMMERCE_WEBHOOK_URL**: Webhook URL for commerce events

## Setting Environment Variables in Netlify

1. Go to your Netlify site dashboard
2. Navigate to **Site settings** > **Environment variables**
3. Add each variable with its corresponding value
4. Deploy the site for changes to take effect

## Local Development

For local development:

1. Copy `.env.example` to `.env`
2. Fill in your environment-specific values
3. Run `npm run dev`

**Note**: Never commit the `.env` file to version control.

## Verification

After deploying with the correct environment variables:

1. Check the browser console for CDP configuration logs
2. You should see: `CDP Project ID configured: 71e24c24-c628-460c-82e3-f830a2b0daf1`
3. Test embedded wallet creation via email sign-in
4. Test onramp functionality in the wallet top-up modal

## Troubleshooting

### Embedded Wallets Not Working
- Verify `VITE_CDP_PROJECT_ID` is set correctly
- Check that your domain is whitelisted in CDP Portal
- Ensure the API key is valid and has the correct permissions

### OnchainKit Features Failing
- Verify `VITE_CDP_API_KEY` is set and valid
- Check that `VITE_ONCHAINKIT_PROJECT_ID` or `VITE_CDP_PROJECT_ID` is set
- Review browser console for specific error messages
