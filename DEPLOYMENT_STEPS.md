# CDP Project ID Configuration - Next Steps

## Summary
This PR ensures that the frontend application is configured to use the correct CDP project ID: `71e24c24-c628-460c-82e3-f830a2b0daf1`

## Changes Made
1. ✅ Created `.env.example` file with the correct CDP project ID documented
2. ✅ Updated `TopUpWalletModal.tsx` to fallback to `VITE_CDP_PROJECT_ID` if `VITE_ONCHAINKIT_PROJECT_ID` is not set
3. ✅ Created `ENV_SETUP.md` with comprehensive documentation on environment variable configuration

## Required Action in Netlify

To complete the configuration, the following environment variables must be set in Netlify:

### Navigate to Netlify Dashboard
1. Go to https://app.netlify.com
2. Select your site
3. Go to **Site settings** > **Build & deploy** > **Environment**

### Add/Update Environment Variables

Set the following variables:

```
VITE_CDP_PROJECT_ID=71e24c24-c628-460c-82e3-f830a2b0daf1
VITE_ONCHAINKIT_PROJECT_ID=71e24c24-c628-460c-82e3-f830a2b0daf1
```

**Note**: Both variables should have the same value. The code has a fallback so if only `VITE_CDP_PROJECT_ID` is set, both features will work correctly.

### Other Required Variables

Ensure these are also set (get values from your previous configuration):
- `VITE_CDP_API_KEY` - Your CDP API key from https://portal.cdp.coinbase.com
- `VITE_SUPABASE_URL` - Your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Your Supabase anonymous key
- `VITE_BASE_MAINNET` - Set to `true` for mainnet, or `false`/omit for testnet
- `VITE_TREASURY_ADDRESS` - The wallet address that receives payments

### Deploy

After setting the environment variables:
1. Trigger a new deployment (or redeploy the site)
2. The build will include the correct CDP project ID

## Verification

After deployment, verify the configuration:

1. Open the site in your browser
2. Open browser console (F12)
3. Look for this log message:
   ```
   CDP Project ID configured: 71e24c24-c628-460c-82e3-f830a2b0daf1
   ```
4. Test embedded wallet creation by signing in with email
5. Test onramp functionality in the wallet top-up modal

## Important: Domain Whitelisting

Ensure your production domain is whitelisted in the CDP Portal:

1. Go to https://portal.cdp.coinbase.com/products/embedded-wallets/domains
2. Add your domain (e.g., `theprize.io`)
3. For local development, also add `localhost:5173`

Without domain whitelisting, embedded wallet sign-in will not work.

## Troubleshooting

If embedded wallets don't work after deployment:
- Check browser console for error messages
- Verify `VITE_CDP_PROJECT_ID` is set correctly in Netlify
- Confirm domain is whitelisted in CDP Portal
- Check that `VITE_CDP_API_KEY` is valid and has correct permissions

## Code Locations

The CDP project ID is used in these files:
- `src/main.tsx` - In the CDP React Provider configuration (`cdpConfig` object)
- `src/components/TopUpWalletModal.tsx` - In the `getOnrampBuyUrl` function call for OnchainKit onramp
