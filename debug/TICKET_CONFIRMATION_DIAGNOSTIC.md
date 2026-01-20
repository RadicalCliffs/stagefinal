# Ticket Confirmation Infrastructure Diagnostic Guide

**Created:** January 19, 2026  
**Purpose:** Diagnose and resolve ticket confirmation breakages caused by infrastructure, environment, or configuration issues

---

## Quick Diagnosis Steps

If ticket confirmations are failing (after Jan 15/16 or any future breakage), follow these steps in order:

### 1. Check Health Endpoints

Health check endpoints provide immediate visibility into the confirmation stack:

#### Netlify Proxy Health Check
```bash
curl https://YOUR_NETLIFY_SITE.netlify.app/api/confirm-pending-tickets/health
```

**Expected Response (Healthy):**
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
    "supabase_edge_function": {
      "status": "pass",
      "message": "Supabase Edge Function reachable"
    }
  }
}
```

#### Supabase Edge Function Health Check
```bash
curl -X GET https://YOUR_PROJECT.supabase.co/functions/v1/confirm-pending-tickets \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

**Expected Response (Healthy):**
```json
{
  "healthy": true,
  "timestamp": "2026-01-19T15:30:00.000Z",
  "incidentId": "health-check-1737306600-xyz789",
  "source": "supabase_function",
  "endpoint": "/confirm-pending-tickets",
  "environment": {
    "deno": true,
    "denoVersion": "1.x.x"
  },
  "checks": {
    "env_supabase_url": {
      "status": "pass"
    },
    "env_service_role_key": {
      "status": "pass"
    },
    "database_connection": {
      "status": "pass"
    },
    "pending_tickets_table": {
      "status": "pass"
    }
  }
}
```

**If either returns `"healthy": false` or HTTP 503**, check the `checks` object for specific failures.

### 2. Check Incident Logs

All confirmation errors are now logged to the database with full context:

```sql
-- View recent confirmation incidents (last 24 hours)
SELECT 
  timestamp,
  incident_id,
  source,
  error_type,
  error_message,
  user_id,
  competition_id,
  env_context
FROM confirmation_incident_log
WHERE timestamp > NOW() - INTERVAL '24 hours'
ORDER BY timestamp DESC
LIMIT 50;
```

**Common Error Types:**
- `env_var_missing` - Environment variable not set or rotated
- `supabase_error` - Database connection or query failure
- `network_error` - Timeout or connectivity issue
- `validation_error` - Invalid request data
- `UnknownError` - Unexpected exception

### 3. Verify Environment Variables

#### Netlify Environment Variables

Check in: Netlify Dashboard → Site Settings → Environment Variables

**Required Variables:**
```
SUPABASE_URL or VITE_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

**Verify:**
```bash
# From Netlify CLI
netlify env:list

# Or check via API
curl -X GET "https://api.netlify.com/api/v1/sites/YOUR_SITE_ID/env" \
  -H "Authorization: Bearer YOUR_NETLIFY_TOKEN"
```

**Test locally:**
```bash
# Set env vars
export VITE_SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"

# Test health endpoint
netlify dev
# Then: curl http://localhost:8888/api/confirm-pending-tickets/health
```

#### Supabase Environment Variables

Check in: Supabase Dashboard → Edge Functions → Secrets

**Required Variables:**
```
SUPABASE_URL (auto-injected)
SUPABASE_SERVICE_ROLE_KEY (auto-injected)
```

**Verify:**
```bash
# Using Supabase CLI
supabase secrets list

# Test function locally
supabase functions serve confirm-pending-tickets --env-file .env.local
```

### 4. Check Supabase Permissions

Ensure the service role key has proper permissions:

```sql
-- Check if RPC functions exist and are accessible
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'log_confirmation_incident',
    'confirm_ticket_purchase',
    'confirm_pending_to_sold'
  );

-- Check table permissions
SELECT tablename, tableowner
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'pending_tickets',
    'tickets',
    'joincompetition',
    'confirmation_incident_log'
  );
```

**If tables/functions missing:** Run migrations:
```bash
cd supabase
supabase db push
```

---

## Calling Supabase Edge Function Directly

If the Netlify proxy is broken, you can call the Supabase function directly:

### Method 1: Using curl

```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/confirm-pending-tickets \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -d '{
    "reservationId": "RESERVATION_UUID",
    "userId": "prize:pid:0x...",
    "competitionId": "COMPETITION_UUID",
    "transactionHash": "0x...",
    "paymentProvider": "coinbase",
    "sessionId": "SESSION_UUID"
  }'
```

### Method 2: Using JavaScript/Node

```javascript
const response = await fetch(
  'https://YOUR_PROJECT.supabase.co/functions/v1/confirm-pending-tickets',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      reservationId: 'RESERVATION_UUID',
      userId: 'prize:pid:0x...',
      competitionId: 'COMPETITION_UUID',
      transactionHash: '0x...',
      paymentProvider: 'coinbase',
      sessionId: 'SESSION_UUID',
    }),
  }
);

const result = await response.json();
console.log(result);
```

### Method 3: Test Script

Create `test-confirmation.mjs`:

```javascript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, serviceKey);

// Get a pending reservation to test with
const { data: reservation } = await supabase
  .from('pending_tickets')
  .select('*')
  .eq('status', 'pending')
  .limit(1)
  .single();

if (!reservation) {
  console.log('No pending reservations found');
  process.exit(0);
}

console.log('Testing with reservation:', reservation.id);

// Call the Edge Function
const response = await fetch(
  `${supabaseUrl}/functions/v1/confirm-pending-tickets`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      reservationId: reservation.id,
      userId: reservation.user_id,
      competitionId: reservation.competition_id,
      sessionId: reservation.session_id,
      paymentProvider: 'test',
    }),
  }
);

const result = await response.json();
console.log('Result:', JSON.stringify(result, null, 2));
```

Run:
```bash
node test-confirmation.mjs
```

---

## Common Failure Scenarios

### Scenario 1: Environment Variables Rotated/Lost

**Symptoms:**
- Health check fails with "Missing SUPABASE_URL" or "Missing SUPABASE_SERVICE_ROLE_KEY"
- Incident log shows `env_var_missing` errors

**Fix:**
1. Get service role key from: Supabase Dashboard → Project Settings → API → service_role key
2. Set in Netlify: Site Settings → Environment Variables
3. Redeploy Netlify site
4. Verify with health check

### Scenario 2: Netlify Proxy Timeout/Network Issue

**Symptoms:**
- Health check shows "Supabase Edge Function request timed out"
- Confirmations work when calling Supabase directly
- Incident log shows `network_error` from `netlify_proxy`

**Fix:**
1. Check Netlify function logs for network errors
2. Verify Supabase URL is correct (not a staging/dev URL)
3. Check if Netlify has connectivity to Supabase
4. As temporary workaround, implement direct Supabase fallback (see below)

### Scenario 3: Database Table Permissions Changed

**Symptoms:**
- Health check shows "pending_tickets table not accessible"
- Incident log shows "permission denied" errors

**Fix:**
```sql
-- Restore service role permissions
GRANT ALL ON public.pending_tickets TO service_role;
GRANT ALL ON public.tickets TO service_role;
GRANT ALL ON public.joincompetition TO service_role;
GRANT ALL ON public.confirmation_incident_log TO service_role;

-- Restore RPC permissions
GRANT EXECUTE ON FUNCTION public.log_confirmation_incident TO service_role;
```

### Scenario 4: Migration Not Applied

**Symptoms:**
- Health check shows "Incident log table not accessible"
- Errors like "relation does not exist"

**Fix:**
```bash
# Apply migrations
cd supabase
supabase db push

# Or apply specific migration
psql $DATABASE_URL -f migrations/20260119210000_create_confirmation_incident_log_table.sql
```

---

## Monitoring & Alerting

### Set Up Monitoring Query

Run this query every 5 minutes to detect failures:

```sql
-- Count recent confirmation failures
SELECT 
  COUNT(*) as failure_count,
  source,
  error_type
FROM confirmation_incident_log
WHERE timestamp > NOW() - INTERVAL '5 minutes'
GROUP BY source, error_type;
```

**Alert if `failure_count > 5` in 5 minutes.**

### Check Confirmation Success Rate

```sql
-- Success rate in last hour
SELECT 
  COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed,
  COUNT(*) FILTER (WHERE status = 'pending') as pending,
  COUNT(*) FILTER (WHERE status = 'expired') as expired,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'confirmed') / NULLIF(COUNT(*), 0), 2) as success_rate
FROM pending_tickets
WHERE created_at > NOW() - INTERVAL '1 hour';
```

---

## Fallback: Direct Supabase Calls

If Netlify proxy consistently fails, implement a client-side fallback:

```typescript
// In client code (e.g., PaymentModal.tsx)
async function confirmTickets(data: ConfirmTicketsData) {
  try {
    // Try Netlify proxy first
    const response = await fetch('/api/confirm-pending-tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    
    if (!response.ok) throw new Error('Proxy failed');
    return await response.json();
  } catch (proxyError) {
    console.warn('Netlify proxy failed, falling back to direct Supabase call');
    
    // Fallback: Call Supabase Edge Function directly
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    
    const response = await fetch(
      `${supabaseUrl}/functions/v1/confirm-pending-tickets`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${anonKey}`,
        },
        body: JSON.stringify(data),
      }
    );
    
    if (!response.ok) {
      throw new Error('Both proxy and direct call failed');
    }
    
    return await response.json();
  }
}
```

---

## Log Analysis

### Find All Incidents for a User

```sql
SELECT *
FROM confirmation_incident_log
WHERE user_id = 'prize:pid:0x...'
ORDER BY timestamp DESC;
```

### Find Incidents by Competition

```sql
SELECT 
  timestamp,
  incident_id,
  error_type,
  error_message,
  user_id
FROM confirmation_incident_log
WHERE competition_id = 'COMPETITION_UUID'
ORDER BY timestamp DESC;
```

### Count Errors by Type

```sql
SELECT 
  error_type,
  COUNT(*) as count,
  MIN(timestamp) as first_seen,
  MAX(timestamp) as last_seen
FROM confirmation_incident_log
WHERE timestamp > NOW() - INTERVAL '24 hours'
GROUP BY error_type
ORDER BY count DESC;
```

### Export Incidents for Analysis

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
      env_context
    FROM confirmation_incident_log
    ORDER BY timestamp DESC
    LIMIT 1000
  ) TO STDOUT WITH CSV HEADER
" > incidents_$(date +%Y%m%d).csv
```

---

## Support Checklist

When reporting a confirmation issue, collect:

- [ ] Output of both health check endpoints
- [ ] Recent incident logs (last 24 hours)
- [ ] Netlify function logs (last 100 lines)
- [ ] Supabase Edge Function logs (last 100 lines)
- [ ] List of environment variables (names only, not values)
- [ ] Specific reservation IDs or transaction hashes that failed
- [ ] Timestamp when issue started

---

## Additional Resources

- **Payment Architecture:** See `PAYMENT_ARCHITECTURE_DIAGNOSTIC.md`
- **Payment Diagnostics:** See `supabase/diagnostics/README.md`
- **Netlify Functions Docs:** https://docs.netlify.com/functions/overview/
- **Supabase Edge Functions:** https://supabase.com/docs/guides/functions
- **GitHub Issues:** Report persistent issues at the repository

---

**Last Updated:** January 19, 2026
