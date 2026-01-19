# Testing Ticket Confirmation Observability Features

## Overview

This document provides commands and steps to test the newly added observability and health check features for the ticket confirmation system.

**Created:** January 19, 2026

---

## Prerequisites

Before testing, ensure:
1. Migrations have been applied to the database
2. Netlify functions are deployed
3. Supabase Edge Functions are deployed

---

## 1. Apply Database Migrations

```bash
cd supabase

# Apply the incident log table migration
supabase db push

# Or apply specific migrations
psql $DATABASE_URL -f migrations/20260119210000_create_confirmation_incident_log_table.sql
psql $DATABASE_URL -f migrations/20260119210001_create_log_confirmation_incident_rpc.sql
```

**Verify:**
```sql
-- Check that table exists
SELECT * FROM confirmation_incident_log LIMIT 1;

-- Check that RPC function exists
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_name = 'log_confirmation_incident';
```

---

## 2. Test Health Check Endpoints

### Netlify Proxy Health Check

**Command:**
```bash
# Replace YOUR_SITE with your Netlify site URL
curl -i https://YOUR_SITE.netlify.app/api/confirm-pending-tickets/health
```

**Expected Response (200 OK):**
```json
{
  "healthy": true,
  "timestamp": "2026-01-19T15:30:00.000Z",
  "incidentId": "health-check-1737306600-abc123",
  "source": "netlify_proxy",
  "endpoint": "/api/confirm-pending-tickets/health",
  "environment": {
    "netlify": true,
    "nodeVersion": "v20.x.x",
    "platform": "linux"
  },
  "checks": {
    "env_supabase_url": {
      "status": "pass",
      "message": "Supabase URL configured"
    },
    "env_service_role_key": {
      "status": "pass",
      "message": "Service role key configured"
    },
    "supabase_connection": {
      "status": "pass",
      "message": "Supabase database connection successful"
    },
    "pending_tickets_table": {
      "status": "pass",
      "message": "pending_tickets table accessible"
    },
    "incident_log_table": {
      "status": "pass",
      "message": "Incident log table accessible"
    },
    "supabase_edge_function": {
      "status": "pass",
      "message": "Supabase Edge Function reachable"
    }
  }
}
```

**If Unhealthy (503 Service Unavailable):**
Check the `checks` object to see which component is failing.

### Supabase Edge Function Health Check

**Command:**
```bash
# Replace with your Supabase project URL and anon key
curl -i -X GET https://YOUR_PROJECT.supabase.co/functions/v1/confirm-pending-tickets \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

**Expected Response (200 OK):**
```json
{
  "healthy": true,
  "timestamp": "2026-01-19T15:30:00.000Z",
  "incidentId": "health-check-1737306600-xyz789",
  "source": "supabase_function",
  "endpoint": "/confirm-pending-tickets",
  "environment": {
    "deno": true,
    "denoVersion": "1.x.x",
    "v8Version": "...",
    "typescriptVersion": "..."
  },
  "checks": {
    "env_supabase_url": {
      "status": "pass",
      "message": "Supabase URL configured"
    },
    "env_service_role_key": {
      "status": "pass",
      "message": "Service role key configured"
    },
    "database_connection": {
      "status": "pass",
      "message": "Database connection successful"
    },
    "pending_tickets_table": {
      "status": "pass",
      "message": "pending_tickets table accessible"
    },
    "incident_log_table": {
      "status": "pass",
      "message": "Incident log table accessible"
    }
  }
}
```

---

## 3. Test Error Logging

### Trigger a Test Error

To test that errors are properly logged to the database, trigger an error:

**Method 1: Invalid Request Body**
```bash
curl -X POST https://YOUR_SITE.netlify.app/api/confirm-pending-tickets \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Method 2: Missing Environment Variable (Temporarily)**
```bash
# In Netlify dashboard, temporarily rename SUPABASE_URL to SUPABASE_URL_BACKUP
# Then make a request
curl -X POST https://YOUR_SITE.netlify.app/api/confirm-pending-tickets \
  -H "Content-Type: application/json" \
  -d '{"userId": "test", "competitionId": "test"}'

# Restore the environment variable immediately after
```

### Verify Error Was Logged

```sql
-- View recent incidents
SELECT 
  timestamp,
  incident_id,
  source,
  endpoint,
  error_type,
  error_message,
  user_id,
  competition_id,
  env_context
FROM confirmation_incident_log
ORDER BY timestamp DESC
LIMIT 10;
```

**Expected Results:**
- You should see an incident logged with:
  - `incident_id`: Unique identifier
  - `source`: "netlify_proxy" or "supabase_function"
  - `error_type`: e.g., "Error", "ValidationError", etc.
  - `error_message`: Descriptive error message
  - `env_context`: JSON object with environment info

---

## 4. Test Fallback Mechanism

The fallback mechanism automatically tries calling Supabase directly if the Netlify proxy fails.

### Simulate Netlify Proxy Failure

**Option 1: Block Netlify Temporarily**
```bash
# In browser console or via network throttling
# Block requests to *.netlify.app
# Then attempt a payment
```

**Option 2: Check Logs After Natural Failure**
Look for these console messages:
```
Netlify proxy confirmation failed after all retries, attempting direct Supabase call:
Attempting direct Supabase Edge Function call as fallback...
✅ Direct Supabase call succeeded! Tickets confirmed via fallback.
```

### Verify Fallback Success

Check the incident log for both the proxy failure and the direct call:

```sql
SELECT 
  timestamp,
  incident_id,
  source,
  error_type,
  error_message
FROM confirmation_incident_log
WHERE timestamp > NOW() - INTERVAL '10 minutes'
ORDER BY timestamp DESC;
```

You should see:
1. An incident from `netlify_proxy` with a network error
2. No incident from direct Supabase call (meaning it succeeded)

---

## 5. Monitor Confirmation Health

### Real-Time Monitoring Query

Run this query every 5 minutes to detect issues:

```sql
-- Count recent failures by source and error type
SELECT 
  COUNT(*) as failure_count,
  source,
  error_type,
  MAX(timestamp) as last_seen
FROM confirmation_incident_log
WHERE timestamp > NOW() - INTERVAL '5 minutes'
GROUP BY source, error_type
ORDER BY failure_count DESC;
```

**Alert if `failure_count > 5` in 5 minutes.**

### Check Confirmation Success Rate

```sql
-- Success rate in the last hour
SELECT 
  COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed_count,
  COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
  COUNT(*) FILTER (WHERE status = 'expired') as expired_count,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE status = 'confirmed') / 
    NULLIF(COUNT(*), 0), 
    2
  ) as success_rate_pct
FROM pending_tickets
WHERE created_at > NOW() - INTERVAL '1 hour';
```

**Expected:** success_rate_pct should be > 95%

---

## 6. Export Incidents for Analysis

```bash
# Export last 1000 incidents to CSV
psql $DATABASE_URL -c "
  COPY (
    SELECT 
      timestamp,
      incident_id,
      source,
      error_type,
      error_message,
      user_id,
      competition_id,
      env_context::text
    FROM confirmation_incident_log
    ORDER BY timestamp DESC
    LIMIT 1000
  ) TO STDOUT WITH CSV HEADER
" > incidents_$(date +%Y%m%d_%H%M%S).csv

echo "Incidents exported to incidents_*.csv"
```

---

## 7. Test Incident ID Tracking

When an error occurs, users should receive an incident ID. Test that this works:

### Via Browser Console

1. Open browser console
2. Trigger a payment that will fail
3. Look for error response containing `incidentId` field
4. Use that ID to query the log:

```sql
SELECT *
FROM confirmation_incident_log
WHERE incident_id = 'YOUR_INCIDENT_ID';
```

### Via API Response

```bash
# Make a request that causes an error
curl -X POST https://YOUR_SITE.netlify.app/api/confirm-pending-tickets \
  -H "Content-Type: application/json" \
  -d '{"invalid": "data"}' | jq '.incidentId'
```

The response should include an `incidentId` field.

---

## 8. Clean Up Test Data

After testing, you may want to clean up test incidents:

```sql
-- View test incidents
SELECT * FROM confirmation_incident_log 
WHERE error_message LIKE '%test%' 
   OR user_id = 'test'
ORDER BY timestamp DESC;

-- Delete test incidents (be careful!)
-- DELETE FROM confirmation_incident_log 
-- WHERE error_message LIKE '%test%' 
--    OR user_id = 'test';
```

---

## Success Criteria

✅ **Health Checks Pass:**
- Netlify proxy health check returns HTTP 200 with `"healthy": true`
- Supabase Edge Function health check returns HTTP 200 with `"healthy": true`

✅ **Error Logging Works:**
- Errors are logged to `confirmation_incident_log` table
- Each incident has a unique `incident_id`
- Incident records include error context and environment info

✅ **Fallback Mechanism Works:**
- When Netlify proxy fails, direct Supabase call is attempted
- Console logs show fallback activation
- Tickets are successfully confirmed via fallback

✅ **No Auth Code Changes:**
- No modifications to login, sign-in, or authentication flows
- User authentication remains unchanged

---

## Troubleshooting

### Health Check Returns 503

**Problem:** Health check shows `"healthy": false`

**Solution:**
1. Check which specific check is failing in the response
2. Verify environment variables are set correctly
3. Check Supabase database is accessible
4. Review Netlify function logs for details

### Incidents Not Being Logged

**Problem:** Errors occur but no incidents in database

**Solution:**
1. Verify migrations were applied: `SELECT * FROM confirmation_incident_log LIMIT 1;`
2. Check RPC function exists: `SELECT * FROM information_schema.routines WHERE routine_name = 'log_confirmation_incident';`
3. Verify service role has permissions
4. Check function logs for "Failed to log incident to database" messages

### Fallback Not Working

**Problem:** Both proxy and direct calls fail

**Solution:**
1. Check Supabase Edge Function health directly
2. Verify environment variables in browser (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
3. Check browser console for detailed error messages
4. Verify Supabase Edge Function is deployed

---

## Additional Resources

- **Diagnostic Guide:** See `TICKET_CONFIRMATION_DIAGNOSTIC.md`
- **Payment Architecture:** See `PAYMENT_ARCHITECTURE_DIAGNOSTIC.md`
- **Payment Diagnostics:** See `supabase/diagnostics/README.md`

---

**Last Updated:** January 19, 2026
