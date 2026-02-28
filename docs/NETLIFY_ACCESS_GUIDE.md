# Netlify Access Guide

## Overview

This document provides information about accessing and managing the Netlify deployment for ThePrize.io.

## Accessing Netlify Dashboard

### Production Site

- **Site Name**: theprize-io (or as configured)
- **URL**: https://app.netlify.com/sites/theprize-io
- **Live URL**: https://theprize.io

### Required Permissions

To access the Netlify dashboard, you need:

1. **Netlify Account**: Sign up at https://netlify.com
2. **Team Invitation**: Admin must invite you to the team/site
3. **Role**: Developer, Admin, or Owner role depending on required access

### Requesting Access

Contact the repository owner or team admin:

1. **Email Request**: Send email with:
   - Your Netlify account email
   - Required access level (view, deploy, admin)
   - Reason for access

2. **GitHub Team**: If you have GitHub repo access, request Netlify access via:
   - Repository Issues
   - Team Slack/Discord channel
   - Direct message to admin

## Netlify Functions

### Available Functions

The site uses several Netlify Functions for backend operations:

#### Email Functions
- `/api/send-email` - Send transactional emails via SendGrid
- `/api/fomo-email-scheduler` - FOMO weekly email (scheduled)
- `/api/comp-live-email-scheduler` - Competition live notifications (scheduled)

#### Top-Up Functions
- `/api/create-charge-proxy` - Create Coinbase Commerce charge
- `/api/instant-topup` - Verify and credit instant top-ups
- `/api/user-balance` - Manage user balance operations

#### Competition Functions
- `/api/confirm-pending-tickets` - Confirm ticket reservations
- `/api/purchase-with-balance-proxy` - Purchase tickets with balance
- `/api/verify-and-rescue-purchase` - Handle failed purchases

#### VRF Functions
- `/api/vrf-scheduler` - Check and process VRF draws (scheduled)
- Various VRF-related admin functions

### Viewing Function Logs

1. Go to Netlify Dashboard → Your Site
2. Click "Functions" in the sidebar
3. Select a function to view logs
4. Use the "Search logs" feature to filter

### Triggering Scheduled Functions Manually

#### Via Netlify Dashboard
1. Go to Functions → Select scheduled function
2. Click "Trigger function"
3. Optionally add test payload

#### Via API Call
```bash
# Example: Trigger FOMO email manually
curl -X POST https://theprize.io/api/fomo-email-scheduler \
  -H "Content-Type: application/json"

# Example: Trigger comp live email
curl -X POST https://theprize.io/api/comp-live-email-scheduler \
  -H "Content-Type: application/json"
```

## Environment Variables

### Viewing Environment Variables

1. Go to Netlify Dashboard → Site Settings
2. Click "Environment variables" in the sidebar
3. View/edit variables (requires admin access)

### Required Environment Variables

#### Supabase
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anonymous key
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (server-side only)

#### SendGrid Email
- `SENDGRID_API_KEY` - SendGrid API key
- `SENDGRID_FROM_EMAIL` - From email address (e.g., contact@theprize.io)
- `SENDGRID_TEMPLATE_WELCOME` - Welcome email template ID
- `SENDGRID_TEMPLATE_WINNER` - Winner email template ID
- `SENDGRID_TEMPLATE_FOMO` - FOMO email template ID
- `SENDGRID_TEMPLATE_COMP_LIVE` - Competition live template ID

#### Coinbase
- `VITE_CDP_PROJECT_ID` - Coinbase Developer Platform project ID
- `VITE_ONCHAINKIT_PROJECT_ID` - OnchainKit project ID
- `COINBASE_COMMERCE_API_KEY` - Commerce API key (server-side)
- `COINBASE_COMMERCE_WEBHOOK_SECRET` - Webhook secret

#### Blockchain
- `VITE_BASE_MAINNET` - Set to "true" for mainnet, false for testnet
- `VITE_CONTRACT_ADDRESS` - Smart contract address
- `VITE_TREASURY_ADDRESS` - Treasury wallet address

#### Other
- `VITE_FARCASTER_APP_FID` - Farcaster app frame ID

### Setting Environment Variables

1. Go to Site Settings → Environment variables
2. Click "Add a variable"
3. Enter key and value
4. Select scope (Production, Deploy Preview, Branch Deploy)
5. Click "Create variable"
6. Redeploy site for changes to take effect

## Deployment

### Deploy Triggers

1. **Automatic Deploys**: 
   - Push to `main` branch → Production deploy
   - Push to other branches → Preview deploy
   - Pull requests → Deploy preview

2. **Manual Deploys**:
   - Click "Trigger deploy" in Netlify Dashboard
   - Select "Deploy site" or "Clear cache and deploy"

### Deploy Contexts

- **Production**: Deploys from `main` branch to https://theprize.io
- **Deploy Previews**: Deploys from PRs to temporary URLs
- **Branch Deploys**: Deploys from specific branches

### Build Settings

- **Build Command**: `npm run build`
- **Publish Directory**: `dist`
- **Node Version**: 20.x (or as configured in `.nvmrc`)

## Monitoring

### Analytics

1. Go to Netlify Dashboard → Analytics
2. View page views, bandwidth, and function invocations
3. Monitor build performance

### Function Metrics

1. Go to Functions → Select function
2. View invocation count, error rate, execution time
3. Check resource usage

### Logs

1. **Build Logs**: Builds → Select build → View log
2. **Function Logs**: Functions → Select function → View log
3. **Deploy Logs**: Deploys → Select deploy → View log

## Troubleshooting

### Build Failures

1. Check build log for errors
2. Verify environment variables are set
3. Test build locally: `npm run build`
4. Clear cache and retry deploy

### Function Errors

1. Check function logs in Netlify Dashboard
2. Test function locally with Netlify CLI:
   ```bash
   netlify dev
   netlify functions:invoke function-name
   ```
3. Verify environment variables
4. Check function timeout (default 10s, max 26s for Netlify Functions)

### Email Not Sending

1. Verify SendGrid API key is set
2. Check SendGrid template IDs match
3. Review function logs for SendGrid errors
4. Test SendGrid API directly:
   ```bash
   curl -X POST https://api.sendgrid.com/v3/mail/send \
     -H "Authorization: Bearer YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{...}'
   ```

## CLI Access

### Install Netlify CLI

```bash
npm install -g netlify-cli
```

### Login

```bash
netlify login
```

### Link to Site

```bash
netlify link
```

### Common Commands

```bash
# Run local dev server with functions
netlify dev

# Deploy to production
netlify deploy --prod

# Deploy preview
netlify deploy

# View site info
netlify status

# Trigger function
netlify functions:invoke function-name

# View env variables
netlify env:list
```

## Security

### Access Control

1. **Minimum Required Access**: Request only the access level you need
2. **2FA**: Enable two-factor authentication on Netlify account
3. **API Keys**: Never commit API keys to Git
4. **Service Role Key**: Keep `SUPABASE_SERVICE_ROLE_KEY` secret (server-side only)

### Revoking Access

If access needs to be revoked:

1. Site Owner → Site Settings → Team & Guests
2. Find user and click "Remove"
3. Rotate any shared API keys if necessary

## Support

For Netlify-specific issues:

1. **Netlify Support**: https://www.netlify.com/support/
2. **Docs**: https://docs.netlify.com
3. **Community**: https://answers.netlify.com
4. **Status Page**: https://www.netlifystatus.com

For project-specific issues:

1. GitHub Issues: https://github.com/teamstack-xyz/theprize.io/issues
2. Team communication channels
3. Contact repository maintainers
