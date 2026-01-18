# Payment System Diagnostics

This directory contains diagnostic tools and scripts to troubleshoot payment system issues.

## Quick Start

If test payments are going through but not reflecting in Coinbase Commerce or Supabase, start here:

### 1. Read the Diagnostic Guide

📖 **[../PAYMENT_ARCHITECTURE_DIAGNOSTIC.md](../PAYMENT_ARCHITECTURE_DIAGNOSTIC.md)**

This comprehensive guide covers:
- Complete payment architecture
- Why payments might not be reflected
- Step-by-step troubleshooting
- Common fixes

### 2. Run Health Check

Check the current state of the payment system:

```bash
# Connect to your Supabase database
psql $DATABASE_URL -f payment_health_check.sql
```

This will show:
- Recent transactions
- Stuck payments
- Payments needing reconciliation
- Webhook event log
- Overall health status

### 3. Verify Webhook Configuration

Test that webhooks can reach your Supabase instance:

```bash
# Set your Supabase URL
export SUPABASE_URL="https://your-project.supabase.co"

# Run verification script
./verify_webhook_config.sh
```

This will:
- Test webhook endpoint accessibility
- Check CORS configuration
- Verify DNS resolution
- Provide next steps

## Files in This Directory

### `payment_health_check.sql`
SQL script to check payment system health. Run this regularly to identify issues.

**Usage:**
```bash
psql $DATABASE_URL -f payment_health_check.sql
```

**Output:**
- Transaction status overview
- Stuck payments (>30 min in pending)
- Payments needing reconciliation
- Completed but unconfirmed entries
- Top-ups not credited to balance
- Webhook event log
- Payment pipeline metrics
- Health status summary

### `verify_webhook_config.sh`
Bash script to verify Coinbase Commerce webhook configuration.

**Usage:**
```bash
export SUPABASE_URL="https://your-project.supabase.co"
./verify_webhook_config.sh
```

**Tests:**
1. Webhook endpoint accessibility
2. CORS preflight (OPTIONS)
3. DNS resolution
4. Mock webhook payload

## Common Issues and Quick Fixes

### Issue 1: Payments Complete But No Updates in Supabase

**Most Likely Cause:** Webhook not configured in Coinbase Commerce

**Quick Fix:**
1. Go to [Coinbase Commerce Dashboard](https://commerce.coinbase.com/dashboard/settings)
2. Navigate to **Settings → Webhooks**
3. Add endpoint: `https://YOUR_PROJECT.supabase.co/functions/v1/commerce-webhook`
4. Select all events (especially `charge:confirmed`)
5. Copy webhook secret
6. Add to Supabase: Dashboard → Edge Functions → Secrets
   - Key: `COINBASE_COMMERCE_WEBHOOK_SECRET`
   - Value: (paste secret)

**Verification:**
```sql
-- Check if webhooks are being received
SELECT COUNT(*) FROM payment_webhook_events
WHERE provider = 'coinbase_commerce'
  AND created_at > NOW() - INTERVAL '24 hours';
-- Should be > 0 if webhooks are configured
```

### Issue 2: Webhooks Failing with "Invalid Signature"

**Cause:** Webhook secret mismatch

**Fix:**
1. Get webhook secret from Coinbase Commerce Dashboard
2. Update in Supabase Edge Functions secrets
3. Ensure secret is NOT base64 encoded (use raw value)

**Verification:**
Check Supabase Edge Function logs for:
```
Search: "Invalid webhook signature" or "Signature verification error"
```

### Issue 3: Payments Stuck in "Pending" Status

**Cause:** Multiple possible causes (see diagnostic guide)

**Quick Check:**
```bash
# Run health check
psql $DATABASE_URL -f payment_health_check.sql

# Look at section: "2. Stuck Payments"
# If count > 0, check:
# - Are webhooks configured?
# - Check Supabase Edge Function logs for errors
```

## Monitoring Queries

### Daily Health Check
```sql
-- Run this daily to monitor payment system health
SELECT 
  'Completed Payments' as metric,
  COUNT(*) as count
FROM user_transactions
WHERE status IN ('finished', 'completed')
  AND created_at > NOW() - INTERVAL '24 hours'

UNION ALL

SELECT 
  'Webhook Events' as metric,
  COUNT(*) as count
FROM payment_webhook_events
WHERE provider = 'coinbase_commerce'
  AND created_at > NOW() - INTERVAL '24 hours';
```

### Find Specific Transaction
```sql
-- Find transaction by Coinbase charge ID
SELECT 
  ut.*,
  pt.status as pending_status,
  pt.ticket_numbers
FROM user_transactions ut
LEFT JOIN pending_tickets pt ON pt.session_id = ut.id
WHERE ut.tx_id = 'YOUR_COINBASE_CHARGE_ID';
```

### Check User Balance History
```sql
-- Check balance changes for a user
SELECT 
  canonical_user_id,
  available_balance,
  pending_balance,
  last_updated
FROM sub_account_balances
WHERE canonical_user_id = 'prize:pid:0x...'
ORDER BY last_updated DESC;
```

## Support

If issues persist after using these tools:

1. Collect diagnostic data:
   - Run `payment_health_check.sql` and save output
   - Run `verify_webhook_config.sh` and save output
   - Get transaction IDs from `user_transactions` table
   - Export Supabase Edge Function logs (last 100 lines)

2. Review **[PAYMENT_ARCHITECTURE_DIAGNOSTIC.md](../PAYMENT_ARCHITECTURE_DIAGNOSTIC.md)** for detailed troubleshooting

3. Check GitHub Issues for similar problems

4. Contact development team with collected data

## Additional Resources

- **Payment Architecture Documentation**: `../PAYMENT_ARCHITECTURE_DIAGNOSTIC.md`
- **Supabase Edge Functions**: Check logs in Supabase Dashboard → Edge Functions → Logs
- **Coinbase Commerce Dashboard**: https://commerce.coinbase.com/dashboard
- **Webhook Documentation**: Coinbase Commerce Webhook Security Docs

---

**Last Updated:** January 18, 2026
