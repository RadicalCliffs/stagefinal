# Supabase Todo List - Madmen Sync Implementation

**Based on:** January 31, 2026 Madmen Sync Call  
**Priority:** Immediate (1-3 days)  
**Status:** Active Development

---

## 🔴 CRITICAL (Day 1 - Deploy Immediately)

### 1. Deploy Balance Ledger Trigger Fix ⚠️

**Issue:** Top-up balance trigger may not be deployed to production  
**Conversation Reference:** (21:13) Max to implement trigger on balance_ledger, (23:40) trigger fix deployment priority  
**Impact:** Top-ups may not credit user balances correctly  
**Status:** CODE EXISTS, NEEDS DEPLOYMENT

**File Ready:** `/supabase/FIX_TOPUP_NOW.sql`

**Deployment Steps:**

#### Step 1: Verify Current State
```sql
-- Check if functions exist
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'credit_balance_with_first_deposit_bonus',
    'credit_sub_account_balance'
  );

-- Check table structure
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'user_transactions'
  AND column_name IN ('tx_id', 'wallet_address', 'wallet_credited');
```

#### Step 2: Apply Fix
1. Go to Supabase Dashboard → SQL Editor
2. Open `/supabase/FIX_TOPUP_NOW.sql`
3. Copy entire file contents
4. Paste into SQL Editor
5. Click "Run"
6. Verify success messages in output

#### Step 3: Verification Tests
```sql
-- Test credit_balance_with_first_deposit_bonus
SELECT credit_balance_with_first_deposit_bonus(
  'test-user-' || gen_random_uuid()::text,
  50.00,
  'Test top-up',
  'test-ref-' || gen_random_uuid()::text
);

-- Verify balance was credited
SELECT * FROM sub_account_balances
WHERE canonical_user_id LIKE 'test-user-%'
ORDER BY created_at DESC
LIMIT 1;

-- Verify ledger entry created
SELECT * FROM balance_ledger
WHERE canonical_user_id LIKE 'test-user-%'
ORDER BY created_at DESC
LIMIT 1;

-- Cleanup test data
DELETE FROM sub_account_balances WHERE canonical_user_id LIKE 'test-user-%';
DELETE FROM balance_ledger WHERE canonical_user_id LIKE 'test-user-%';
```

#### Step 4: Test in Staging
1. Create new test user account
2. Initiate $10 top-up transaction
3. Verify balance credited within 30 seconds
4. Check balance_ledger for audit entry
5. Verify 20% bonus applied if first deposit

**Expected Behavior After Fix:**
- Top-up transaction creates entry in `user_transactions`
- Webhook calls `credit_balance_with_first_deposit_bonus`
- Function credits `sub_account_balances.available_balance`
- Function creates `balance_ledger` entry
- If first deposit, 20% bonus added to `bonus_balance`
- Frontend realtime subscription updates balance display

**Rollback Plan:**
If issues occur, previous functions remain in place. This is an OR REPLACE operation, so it's safe.

**Estimated Time:** 30 minutes (deployment) + 30 minutes (testing) = 1 hour

---

### 2. Create Automated Pending Ticket Cleanup Job ❌

**Issue:** Expired pending tickets accumulate, blocking ticket purchases  
**Conversation Reference:** (06:05) Pending tickets prevent users from purchasing, (01:05:10) Clear pending tickets priority  
**Impact:** CRITICAL - Users can't purchase tickets even with sufficient balance  
**Status:** NEEDS IMPLEMENTATION

**Current State:**
- ✅ Manual cleanup function exists: `/supabase/functions/fix-pending-tickets/index.ts`
- ❌ No automated/scheduled cleanup
- ❌ Pending tickets pile up from failed/abandoned transactions

**Solution A: Create Edge Function Cron Job**

#### File to Create: `/supabase/functions/cleanup-expired-tickets-cron/index.ts`

```typescript
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Cleanup Expired Tickets Cron Job
 * 
 * Runs every 5 minutes to clean up expired pending ticket reservations.
 * 
 * Schedule: */5 * * * * (every 5 minutes)
 * Endpoint: https://[project].supabase.co/functions/v1/cleanup-expired-tickets-cron
 */

Deno.serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const now = new Date().toISOString();
    
    // Step 1: Find expired pending tickets
    const { data: expiredTickets, error: fetchError } = await supabase
      .from('pending_tickets')
      .select('id, user_id, competition_id, ticket_numbers, expires_at')
      .eq('status', 'pending')
      .lt('expires_at', now);

    if (fetchError) {
      throw new Error(`Failed to fetch expired tickets: ${fetchError.message}`);
    }

    console.log(`Found ${expiredTickets?.length || 0} expired pending tickets`);

    if (!expiredTickets || expiredTickets.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No expired tickets to clean up',
          cleaned: 0
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Step 2: Delete expired pending ticket items
    const ticketIds = expiredTickets.map(t => t.id);
    const { error: deleteItemsError } = await supabase
      .from('pending_ticket_items')
      .delete()
      .in('pending_ticket_id', ticketIds);

    if (deleteItemsError) {
      console.error('Error deleting pending ticket items:', deleteItemsError);
    }

    // Step 3: Delete expired pending tickets
    const { error: deleteTicketsError } = await supabase
      .from('pending_tickets')
      .delete()
      .in('id', ticketIds);

    if (deleteTicketsError) {
      throw new Error(`Failed to delete expired tickets: ${deleteTicketsError.message}`);
    }

    // Step 4: Clean up orphaned pending tickets (invalid user or competition)
    const { data: orphanedTickets } = await supabase
      .from('pending_tickets')
      .select(`
        id,
        user_id,
        competition_id,
        canonical_users!inner(canonical_user_id),
        competitions!inner(id)
      `);

    // Find tickets where user or competition doesn't exist
    const { error: orphanCleanupError } = await supabase.rpc(
      'cleanup_orphaned_pending_tickets'
    );

    if (orphanCleanupError) {
      console.error('Orphan cleanup error:', orphanCleanupError);
    }

    console.log(`Successfully cleaned up ${expiredTickets.length} expired tickets`);

    return new Response(
      JSON.stringify({ 
        success: true,
        message: `Cleaned up ${expiredTickets.length} expired pending tickets`,
        cleaned: expiredTickets.length,
        timestamp: now
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Cleanup cron error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
});
```

#### Database Function to Create: `cleanup_orphaned_pending_tickets`

```sql
-- Add this to a new migration file
CREATE OR REPLACE FUNCTION cleanup_orphaned_pending_tickets()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER := 0;
BEGIN
  -- Delete pending tickets where user no longer exists
  DELETE FROM pending_ticket_items
  WHERE pending_ticket_id IN (
    SELECT pt.id
    FROM pending_tickets pt
    LEFT JOIN canonical_users cu ON pt.canonical_user_id = cu.canonical_user_id
    WHERE cu.canonical_user_id IS NULL
      OR pt.canonical_user_id IS NULL
      OR pt.user_id IS NULL
  );
  
  DELETE FROM pending_tickets
  WHERE id IN (
    SELECT pt.id
    FROM pending_tickets pt
    LEFT JOIN canonical_users cu ON pt.canonical_user_id = cu.canonical_user_id
    WHERE cu.canonical_user_id IS NULL
      OR pt.canonical_user_id IS NULL
      OR pt.user_id IS NULL
  );
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Delete pending tickets where competition no longer exists
  DELETE FROM pending_ticket_items
  WHERE pending_ticket_id IN (
    SELECT pt.id
    FROM pending_tickets pt
    LEFT JOIN competitions c ON pt.competition_id = c.id
    WHERE c.id IS NULL
  );
  
  DELETE FROM pending_tickets pt
  USING pending_tickets pt2
  LEFT JOIN competitions c ON pt2.competition_id = c.id
  WHERE pt.id = pt2.id
    AND c.id IS NULL;
  
  GET DIAGNOSTICS deleted_count = deleted_count + ROW_COUNT;
  
  RETURN deleted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION cleanup_orphaned_pending_tickets() TO service_role;
```

#### Setup Cron Job in Supabase

1. Go to Supabase Dashboard → Database → Cron Jobs
2. Create new cron job:
   - **Name:** cleanup-expired-tickets
   - **Schedule:** `*/5 * * * *` (every 5 minutes)
   - **Command:** 
     ```sql
     SELECT
       net.http_post(
         url := 'https://YOUR_PROJECT.supabase.co/functions/v1/cleanup-expired-tickets-cron',
         headers := '{"Authorization": "Bearer ' || current_setting('app.service_role_key') || '"}'::jsonb
       ) AS request_id;
     ```

**Alternative: Using pg_cron directly**

```sql
-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule cleanup job (runs every 5 minutes)
SELECT cron.schedule(
  'cleanup-expired-pending-tickets',
  '*/5 * * * *',
  $$
    DELETE FROM pending_ticket_items
    WHERE pending_ticket_id IN (
      SELECT id FROM pending_tickets
      WHERE status = 'pending'
        AND expires_at < NOW()
    );
    
    DELETE FROM pending_tickets
    WHERE status = 'pending'
      AND expires_at < NOW();
  $$
);
```

**Immediate Manual Cleanup (Run Once Now):**

```sql
-- Clean up all currently expired tickets
BEGIN;

-- Count before cleanup
SELECT COUNT(*) as expired_count
FROM pending_tickets
WHERE status = 'pending' AND expires_at < NOW();

-- Delete expired ticket items
DELETE FROM pending_ticket_items
WHERE pending_ticket_id IN (
  SELECT id FROM pending_tickets
  WHERE status = 'pending' AND expires_at < NOW()
);

-- Delete expired tickets
DELETE FROM pending_tickets
WHERE status = 'pending' AND expires_at < NOW();

-- Verify cleanup
SELECT COUNT(*) as remaining_pending
FROM pending_tickets
WHERE status = 'pending';

COMMIT;
```

**Testing:**
1. Create test pending ticket with past expires_at
2. Wait 5 minutes for cron job
3. Verify ticket was deleted
4. Check cron job logs for success

**Estimated Time:** 4 hours (implementation + testing)

---

### 3. Fix Balance Sync Between canonical_users and sub_account_balances ⚠️

**Issue:** Race conditions cause balance display inconsistencies  
**Conversation Reference:** (56:53) Discrepancies traced to race conditions, (56:00) Sync tables priority  
**Impact:** Users see wrong balance amounts  
**Status:** NEEDS INVESTIGATION + FIX

**Current Problem:**
- `canonical_users.balance` (legacy field)
- `sub_account_balances.available_balance` (current source of truth)
- Sometimes out of sync due to race conditions

**Solution: Create Sync Function + Trigger**

#### Migration File: `20260131000000_sync_balance_tables.sql`

```sql
-- ============================================================================
-- Balance Synchronization Fix
-- Ensures canonical_users.balance stays in sync with sub_account_balances
-- ============================================================================

BEGIN;

-- Function to sync balance from sub_account_balances to canonical_users
CREATE OR REPLACE FUNCTION sync_canonical_user_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Update canonical_users.balance to match sub_account_balances.available_balance
  UPDATE canonical_users
  SET 
    balance = NEW.available_balance,
    updated_at = NOW()
  WHERE canonical_user_id = NEW.canonical_user_id;
  
  RETURN NEW;
END;
$$;

-- Trigger on sub_account_balances to auto-sync canonical_users
DROP TRIGGER IF EXISTS sync_balance_to_canonical_users ON sub_account_balances;
CREATE TRIGGER sync_balance_to_canonical_users
  AFTER INSERT OR UPDATE OF available_balance
  ON sub_account_balances
  FOR EACH ROW
  EXECUTE FUNCTION sync_canonical_user_balance();

-- Function to manually sync all balances (one-time fix)
CREATE OR REPLACE FUNCTION sync_all_user_balances()
RETURNS TABLE(canonical_user_id TEXT, old_balance NUMERIC, new_balance NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  UPDATE canonical_users cu
  SET 
    balance = sab.available_balance,
    updated_at = NOW()
  FROM sub_account_balances sab
  WHERE cu.canonical_user_id = sab.canonical_user_id
    AND cu.balance != sab.available_balance
  RETURNING 
    cu.canonical_user_id,
    cu.balance AS old_balance,
    sab.available_balance AS new_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_all_user_balances() TO service_role;
GRANT EXECUTE ON FUNCTION sync_canonical_user_balance() TO service_role;

-- Run initial sync to fix existing inconsistencies
SELECT * FROM sync_all_user_balances();

COMMIT;
```

**Apply Immediately:**
1. Copy above SQL to Supabase SQL Editor
2. Run migration
3. Review sync results

**Verification:**
```sql
-- Check for any remaining discrepancies
SELECT 
  cu.canonical_user_id,
  cu.balance as canonical_balance,
  sab.available_balance as sub_account_balance,
  (cu.balance - sab.available_balance) as difference
FROM canonical_users cu
JOIN sub_account_balances sab ON cu.canonical_user_id = sab.canonical_user_id
WHERE ABS(cu.balance - sab.available_balance) > 0.01
ORDER BY ABS(cu.balance - sab.available_balance) DESC;
```

**Estimated Time:** 2 hours (implementation + testing)

---

## 🟡 IMPORTANT (Day 2 - High Priority)

### 4. Add Indexes for Performance Optimization ❌

**Issue:** Queries may be slow on pending_tickets and balance_ledger  
**Impact:** Poor performance as user base grows  

**Indexes to Add:**

```sql
-- Pending tickets cleanup optimization
CREATE INDEX IF NOT EXISTS idx_pending_tickets_status_expires 
ON pending_tickets(status, expires_at) 
WHERE status = 'pending';

-- Balance ledger query optimization
CREATE INDEX IF NOT EXISTS idx_balance_ledger_user_created 
ON balance_ledger(canonical_user_id, created_at DESC);

-- User transactions lookup optimization
CREATE INDEX IF NOT EXISTS idx_user_transactions_wallet_credited 
ON user_transactions(canonical_user_id, wallet_credited, created_at DESC);

-- Competition entries optimization
CREATE INDEX IF NOT EXISTS idx_competition_entries_user_comp 
ON competition_entries(canonical_user_id, competition_id);

-- Analyze tables for query planner
ANALYZE pending_tickets;
ANALYZE balance_ledger;
ANALYZE sub_account_balances;
ANALYZE user_transactions;
```

**Estimated Time:** 1 hour

---

### 5. Create RPC for Balance Health Check ❌

**Issue:** Frontend needs to verify balance consistency  
**Impact:** Support for balance health monitoring  

**RPC to Create:**

```sql
CREATE OR REPLACE FUNCTION check_balance_health(
  p_canonical_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_canonical_balance NUMERIC;
  v_sub_account_balance NUMERIC;
  v_ledger_balance NUMERIC;
  v_difference NUMERIC;
  v_status TEXT;
BEGIN
  -- Get balance from canonical_users
  SELECT balance INTO v_canonical_balance
  FROM canonical_users
  WHERE canonical_user_id = p_canonical_user_id;
  
  -- Get balance from sub_account_balances
  SELECT available_balance INTO v_sub_account_balance
  FROM sub_account_balances
  WHERE canonical_user_id = p_canonical_user_id AND currency = 'USD';
  
  -- Calculate balance from ledger (sum of all transactions)
  SELECT 
    COALESCE(SUM(CASE 
      WHEN transaction_type IN ('deposit', 'bonus', 'credit') THEN amount
      WHEN transaction_type IN ('purchase', 'debit', 'withdrawal') THEN -amount
      ELSE 0
    END), 0) INTO v_ledger_balance
  FROM balance_ledger
  WHERE canonical_user_id = p_canonical_user_id;
  
  -- Calculate difference
  v_difference := ABS(COALESCE(v_canonical_balance, 0) - COALESCE(v_sub_account_balance, 0));
  
  -- Determine status
  IF v_difference < 0.01 THEN
    v_status := 'healthy';
  ELSIF v_difference < 1.00 THEN
    v_status := 'minor_discrepancy';
  ELSE
    v_status := 'major_discrepancy';
  END IF;
  
  RETURN jsonb_build_object(
    'status', v_status,
    'canonical_balance', COALESCE(v_canonical_balance, 0),
    'sub_account_balance', COALESCE(v_sub_account_balance, 0),
    'ledger_calculated_balance', COALESCE(v_ledger_balance, 0),
    'difference', v_difference,
    'needs_sync', v_difference >= 0.01
  );
END;
$$;

GRANT EXECUTE ON FUNCTION check_balance_health(TEXT) TO authenticated, service_role;
```

**Usage:**
```typescript
// Frontend can call this
const { data } = await supabase.rpc('check_balance_health', {
  p_canonical_user_id: userId
});

if (data.status === 'major_discrepancy') {
  // Show warning to user
  // Trigger sync
}
```

**Estimated Time:** 2 hours

---

### 6. Improve Error Logging for Top-Up Webhooks ❌

**Issue:** Hard to debug failed top-ups  
**Impact:** Support burden, unclear why top-ups fail  

**Enhancement to onramp-webhook:**

```typescript
// Add to /supabase/functions/onramp-webhook/index.ts

// Enhanced logging
const logWebhookEvent = async (event: any, result: any) => {
  await supabase.from('webhook_logs').insert({
    webhook_type: 'onramp',
    event_type: event.eventType,
    event_data: event,
    result_data: result,
    status: result.success ? 'success' : 'error',
    error_message: result.error || null,
    created_at: new Date().toISOString()
  });
};

// Add retries with exponential backoff
const creditBalanceWithRetry = async (params: any, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await supabase.rpc('credit_balance_with_first_deposit_bonus', params);
      
      if (result.error) {
        if (attempt === maxRetries) throw result.error;
        await sleep(Math.pow(2, attempt) * 1000); // Exponential backoff
        continue;
      }
      
      return result;
    } catch (error) {
      if (attempt === maxRetries) throw error;
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }
};
```

**Create webhook_logs table:**

```sql
CREATE TABLE IF NOT EXISTS webhook_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  webhook_type TEXT NOT NULL,
  event_type TEXT,
  event_data JSONB,
  result_data JSONB,
  status TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX idx_webhook_logs_type_created ON webhook_logs(webhook_type, created_at DESC);
CREATE INDEX idx_webhook_logs_status ON webhook_logs(status);
```

**Estimated Time:** 3 hours

---

## 🟢 NICE TO HAVE (Day 3 - Enhancement)

### 7. Add Database Constraints for Data Integrity ❌

**Issue:** Some data integrity issues from orphaned records  
**Impact:** Database cleanliness  

**Constraints to Add:**

```sql
-- Ensure pending_tickets.user_id references valid user
ALTER TABLE pending_tickets
ADD CONSTRAINT fk_pending_tickets_canonical_user
FOREIGN KEY (canonical_user_id)
REFERENCES canonical_users(canonical_user_id)
ON DELETE CASCADE;

-- Ensure competition_entries reference valid competition
ALTER TABLE competition_entries
ADD CONSTRAINT fk_competition_entries_competition
FOREIGN KEY (competition_id)
REFERENCES competitions(id)
ON DELETE CASCADE;

-- Ensure balance_ledger references valid user
ALTER TABLE balance_ledger
ADD CONSTRAINT fk_balance_ledger_canonical_user
FOREIGN KEY (canonical_user_id)
REFERENCES canonical_users(canonical_user_id)
ON DELETE CASCADE;
```

**Warning:** These will fail if orphaned records exist. Clean up first:

```sql
-- Clean up orphaned pending_tickets
DELETE FROM pending_tickets
WHERE canonical_user_id NOT IN (
  SELECT canonical_user_id FROM canonical_users
);

-- Clean up orphaned competition_entries
DELETE FROM competition_entries
WHERE competition_id NOT IN (
  SELECT id FROM competitions
);

-- Clean up orphaned balance_ledger
DELETE FROM balance_ledger
WHERE canonical_user_id NOT IN (
  SELECT canonical_user_id FROM canonical_users
);
```

**Estimated Time:** 2 hours

---

### 8. Create Admin Dashboard for Balance Monitoring ❌

**Issue:** No admin visibility into balance issues  
**Impact:** Hard to monitor system health  

**View to Create:**

```sql
CREATE OR REPLACE VIEW admin_balance_health AS
SELECT 
  cu.canonical_user_id,
  cu.email,
  cu.balance as canonical_balance,
  sab.available_balance as sub_account_balance,
  ABS(cu.balance - sab.available_balance) as discrepancy,
  CASE 
    WHEN ABS(cu.balance - sab.available_balance) < 0.01 THEN 'healthy'
    WHEN ABS(cu.balance - sab.available_balance) < 1.00 THEN 'minor'
    ELSE 'major'
  END as health_status,
  cu.created_at as user_created_at,
  sab.updated_at as balance_last_updated
FROM canonical_users cu
LEFT JOIN sub_account_balances sab 
  ON cu.canonical_user_id = sab.canonical_user_id
WHERE cu.balance IS NOT NULL OR sab.available_balance IS NOT NULL
ORDER BY ABS(cu.balance - COALESCE(sab.available_balance, 0)) DESC;

GRANT SELECT ON admin_balance_health TO service_role;
```

**Estimated Time:** 2 hours

---

## 📋 Deployment Checklist

### Pre-Deployment
- [ ] Backup database
- [ ] Test all SQL scripts in staging environment
- [ ] Review current table counts and function counts
- [ ] Document current state

### Day 1 Deployment
- [ ] Deploy FIX_TOPUP_NOW.sql
- [ ] Test top-up flow end-to-end
- [ ] Create cleanup-expired-tickets-cron function
- [ ] Set up cron job (every 5 minutes)
- [ ] Run manual cleanup of existing expired tickets
- [ ] Apply balance sync migration
- [ ] Verify balance sync trigger working

### Day 2 Deployment
- [ ] Add performance indexes
- [ ] Deploy balance health check RPC
- [ ] Enhance webhook logging
- [ ] Create webhook_logs table

### Day 3 Deployment
- [ ] Clean up orphaned records
- [ ] Add foreign key constraints
- [ ] Create admin views

### Post-Deployment
- [ ] Monitor error logs for 48 hours
- [ ] Check cron job execution logs
- [ ] Verify no balance discrepancies
- [ ] Test user flows (top-up, purchase, balance check)
- [ ] Update documentation

---

## 🎯 Summary

**Total Estimated Time:** 20-25 hours

**Critical Path (Day 1):**
1. Deploy balance trigger (1h)
2. Pending ticket cleanup (4h)
3. Balance sync fix (2h)

**Day 2:**
4. Performance indexes (1h)
5. Balance health RPC (2h)
6. Webhook logging (3h)

**Day 3:**
7. Data integrity constraints (2h)
8. Admin monitoring (2h)

---

**Last Updated:** January 31, 2026 12:06 UTC  
**Deployment Target:** Production (after staging verification)  
**Rollback Plan:** Available for all changes (OR REPLACE, idempotent scripts)
