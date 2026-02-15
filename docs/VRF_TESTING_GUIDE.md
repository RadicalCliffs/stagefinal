# VRF Real-World Testing Guide

## Overview
This guide provides comprehensive procedures for testing the Chainlink VRF (Verifiable Random Function) system that ensures provably fair winner selection. **VRF testing with real on-chain transactions is CRITICAL before launch.**

## Why VRF Testing is Critical

The VRF system is the core of our provably fair draws. A failure means:
- Winners cannot be selected
- Competitions cannot complete
- User trust is lost
- Platform becomes unusable

**Risk Level**: 🔴 **CRITICAL** (High Impact, Medium Likelihood)

---

## VRF System Architecture

### Components

1. **Chainlink VRF Coordinator** (on-chain)
   - Deployed on Base Mainnet
   - Handles randomness requests
   - Requires LINK token payments

2. **VRF Subscription** (on-chain)
   - Holds LINK tokens for VRF requests
   - Must be funded before any draws
   - Tracks usage and balance

3. **ThePrize VRF Consumer Contract** (on-chain)
   - Our smart contract that requests randomness
   - Receives random numbers from Chainlink
   - Emits events for result tracking

4. **VRF Edge Functions** (server-side)
   - `vrf-trigger-draw`: Initiates VRF request when competition ends
   - `vrf-sync-results`: Syncs VRF results back to database
   - `chainlink-vrf-webhook`: Receives Chainlink notifications

5. **VRF Admin Dashboard** (frontend)
   - `/admin/vrf-dashboard`
   - Monitors VRF status
   - Manual intervention tools

---

## Pre-Test Setup

### 1. Environment Configuration

Verify these environment variables are set:

```bash
# Check frontend VRF config
echo $VITE_VRF_COORDINATOR_ADDRESS
echo $VITE_VRF_SUBSCRIPTION_ID
echo $VITE_VRF_KEY_HASH

# Check backend VRF config (Supabase secrets)
supabase secrets list | grep VRF
```

**Required Values (Base Mainnet)**:
- `VRF_COORDINATOR_ADDRESS`: `0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634` (Base Mainnet)
- `VRF_KEY_HASH`: `0x...` (300 gwei lane for Base)
- `VRF_SUBSCRIPTION_ID`: Your subscription ID from VRF dashboard

### 2. Fund VRF Subscription

**CRITICAL**: Ensure subscription has sufficient LINK tokens.

1. Visit: https://vrf.chain.link/base
2. Connect wallet (owner wallet)
3. Navigate to your subscription
4. **Add minimum 10 LINK tokens** (allows ~50-100 draws)
5. Verify balance updated

**Cost per VRF request**: ~0.1-0.2 LINK (varies with gas prices)

### 3. Verify Smart Contract Deployment

```bash
# Check contract exists on Base
# Visit: https://basescan.org/address/[CONTRACT_ADDRESS]

# Verify contract is:
# - Deployed and verified
# - Subscription is set correctly
# - Callback gas limit is adequate (2,500,000)
```

### 4. Create Test Competition

Create a short-duration competition for testing:

```sql
-- Insert test competition
INSERT INTO competitions (
  name, 
  description, 
  prize,
  ticket_price, 
  max_tickets_available, 
  start_date, 
  end_date,
  status,
  competition_type
) VALUES (
  'VRF Test Draw - DO NOT BID',
  'This is a test competition to verify VRF system. Will be deleted after test.',
  'Test Prize',
  1.00,
  10,
  NOW(),
  NOW() + INTERVAL '30 minutes',  -- Ends in 30 minutes
  'active',
  'standard'
);

-- Get the competition ID
SELECT id, name, end_date FROM competitions 
WHERE name LIKE '%VRF Test%' 
ORDER BY created_at DESC LIMIT 1;
```

---

## Test Scenarios

### Test 1: Happy Path - Automatic VRF Draw

**Objective**: Verify VRF triggers automatically and completes successfully

**Steps**:

1. **Purchase Test Entries** (from 3+ different test users):
   ```sql
   -- As admin, grant free entries to test users
   INSERT INTO competition_entries (competition_id, user_id, ticket_count, purchase_price_paid)
   VALUES 
     ('[COMPETITION_ID]', '[TEST_USER_1]', 3, 0.00),
     ('[COMPETITION_ID]', '[TEST_USER_2]', 2, 0.00),
     ('[COMPETITION_ID]', '[TEST_USER_3]', 1, 0.00);
   ```

2. **Wait for Competition to End**:
   - Monitor the competition status
   - Watch the countdown timer
   - Note exact end time

3. **Monitor VRF Trigger** (within 5 minutes of end time):
   ```bash
   # Watch VRF Edge Function logs
   supabase functions logs vrf-trigger-draw --tail
   
   # Look for:
   # "VRF draw triggered for competition [ID]"
   # "VRF request submitted: [REQUEST_ID]"
   # "Transaction hash: [TX_HASH]"
   ```

4. **Verify On-Chain Transaction**:
   - Copy transaction hash from logs
   - Visit: https://basescan.org/tx/[TX_HASH]
   - Verify:
     - ✅ Transaction successful
     - ✅ Gas used reasonable (<1M gas)
     - ✅ Event "RandomWordsRequested" emitted

5. **Monitor VRF Fulfillment** (5-10 minutes):
   ```bash
   # Watch for Chainlink callback
   supabase functions logs chainlink-vrf-webhook --tail
   
   # Or check database
   SELECT id, name, vrf_status, vrf_request_id, vrf_tx_hash 
   FROM competitions 
   WHERE id = '[COMPETITION_ID]';
   ```

6. **Verify Winner Selection** (within 15 minutes of end time):
   ```sql
   SELECT 
     c.id, 
     c.name, 
     c.status,
     c.vrf_status,
     c.vrf_request_id,
     c.vrf_tx_hash,
     c.winner_user_id,
     c.vrf_draw_completed_at,
     p.email as winner_email
   FROM competitions c
   LEFT JOIN profiles p ON c.winner_user_id = p.id
   WHERE c.id = '[COMPETITION_ID]';
   ```

   **Expected Results**:
   - `status`: 'completed'
   - `vrf_status`: 'fulfilled'
   - `vrf_request_id`: populated
   - `vrf_tx_hash`: populated
   - `winner_user_id`: one of the test users
   - `vrf_draw_completed_at`: timestamp
   - `winner_email`: should match one of test users

7. **Verify Winner Notification**:
   - Check SendGrid dashboard for winner email sent
   - Check winner's user dashboard shows "Won" status
   - Check losers' dashboards show "Lost" status

8. **Verify VRF Dashboard**:
   - Visit `/admin/vrf-dashboard`
   - Find test competition
   - Verify status shows as completed
   - Check transaction link works

**Success Criteria**:
- ✅ VRF triggered automatically within 5 minutes
- ✅ VRF fulfilled within 10 minutes
- ✅ Winner selected from valid entrants
- ✅ Winner notified
- ✅ All data recorded correctly
- ✅ No errors in logs

---

### Test 2: Manual VRF Trigger

**Objective**: Verify manual trigger works if automatic fails

**Steps**:

1. **Create Another Test Competition** (same as Test 1)

2. **Let Competition End Naturally**

3. **Disable Automatic Trigger** (simulate failure):
   ```sql
   -- Temporarily mark as if trigger already attempted
   UPDATE competitions 
   SET vrf_status = 'pending'
   WHERE id = '[COMPETITION_ID]';
   ```

4. **Manual Trigger via Admin Dashboard**:
   - Visit `/admin/vrf-dashboard`
   - Find pending competition
   - Click "Trigger Draw" button
   - Confirm action

5. **Monitor VRF Process** (same as Test 1, steps 4-8)

**Success Criteria**:
- ✅ Manual trigger initiates VRF request
- ✅ Process completes same as automatic trigger
- ✅ Winner selected correctly

---

### Test 3: Multiple Concurrent Draws

**Objective**: Verify system handles multiple competitions ending simultaneously

**Steps**:

1. **Create 3 Test Competitions** with same end time (30 minutes from now)

2. **Add Test Entries to Each**

3. **Monitor All Three Competitions**:
   ```sql
   SELECT id, name, end_date, vrf_status, winner_user_id
   FROM competitions
   WHERE name LIKE '%VRF Test%'
   ORDER BY end_date;
   ```

4. **Verify VRF Processes All**:
   - Each should trigger separately
   - Check VRF subscription balance decreases appropriately
   - All should complete within 15 minutes

**Success Criteria**:
- ✅ All 3 competitions trigger VRF
- ✅ All 3 complete successfully
- ✅ No race conditions or conflicts
- ✅ Correct winners selected for each

---

### Test 4: Low LINK Balance Handling

**Objective**: Verify system alerts when LINK balance too low

**WARNING**: Only test in staging/testnet. In production, always maintain >10 LINK.

**Steps**:

1. **Reduce LINK Balance** (in testnet only):
   - Withdraw LINK to bring balance to <1 LINK

2. **Attempt VRF Draw**:
   - Create test competition
   - Wait for end time
   - Monitor logs for errors

3. **Verify Alert Sent**:
   - Check admin dashboard shows warning
   - Verify error logged
   - Confirm no silent failure

**Expected Behavior**:
- ❌ VRF request fails with insufficient LINK error
- 🔔 Admin alert triggered
- 📝 Error logged clearly
- 🚫 Competition not marked as failed permanently

**Recovery**:
- Top up LINK balance
- Retry VRF draw
- Verify completes successfully

---

### Test 5: Network Congestion Handling

**Objective**: Verify system handles high gas prices and network congestion

**Steps**:

1. **Monitor Base Network Gas Prices**:
   - Visit: https://basescan.org/gastracker
   - Note current gas prices

2. **Create Test During High Gas Period** (if possible):
   - Schedule competition to end during peak hours
   - Monitor transaction submission

3. **Verify Gas Handling**:
   - Check transaction uses appropriate gas price
   - Verify not stuck due to low gas
   - Confirm completes despite high gas

**Expected Behavior**:
- Transaction adjusts gas price dynamically
- May take slightly longer but completes
- No manual intervention required

---

### Test 6: VRF Callback Failure Recovery

**Objective**: Verify system can recover if Chainlink callback fails

**Steps**:

1. **Simulate Callback Failure** (in staging):
   - Create test competition
   - Trigger VRF
   - Manually fail the callback transaction

2. **Verify Manual Sync**:
   ```bash
   # Manually call sync function
   curl -X POST '[SUPABASE_URL]/functions/v1/vrf-sync-results' \
     -H 'Authorization: Bearer [SERVICE_ROLE_KEY]' \
     -H 'Content-Type: application/json' \
     -d '{"competitionId": "[COMPETITION_ID]"}'
   ```

3. **Verify Recovery**:
   - Check winner synced from on-chain data
   - Verify competition marked complete
   - Confirm all data correct

**Success Criteria**:
- ✅ Manual sync retrieves on-chain result
- ✅ Competition completes successfully
- ✅ Winner data matches on-chain record

---

## Monitoring VRF in Production

### Real-Time Monitoring

**Dashboard to Watch**: `/admin/vrf-dashboard`

**Key Metrics**:
- VRF Subscription Balance (alert if <5 LINK)
- Pending Draws (alert if >0 for >30 minutes)
- Failed Draws (alert immediately)
- Average Fulfillment Time (target: <10 minutes)

### Automated Alerts

Set up monitoring for:

```sql
-- Competitions stuck in "drawing" status
SELECT id, name, end_date, vrf_status
FROM competitions
WHERE status = 'ended'
  AND vrf_status = 'pending'
  AND end_date < NOW() - INTERVAL '30 minutes';

-- Failed VRF requests
SELECT id, name, vrf_status, vrf_error
FROM competitions
WHERE vrf_status = 'failed'
  AND created_at > NOW() - INTERVAL '24 hours';
```

### Daily VRF Health Check

Run daily:

```sql
-- VRF success rate (should be 100%)
SELECT 
  COUNT(*) FILTER (WHERE vrf_status = 'fulfilled') as successful,
  COUNT(*) FILTER (WHERE vrf_status = 'failed') as failed,
  COUNT(*) as total,
  ROUND(
    (COUNT(*) FILTER (WHERE vrf_status = 'fulfilled')::numeric / 
     NULLIF(COUNT(*), 0)) * 100, 
    2
  ) as success_rate_pct
FROM competitions
WHERE end_date >= CURRENT_DATE - INTERVAL '24 hours'
  AND status = 'completed';
```

---

## Troubleshooting Common Issues

### Issue: VRF Not Triggering Automatically

**Symptoms**: Competition ended but VRF status still 'pending' after 10 minutes

**Diagnosis**:
```bash
# Check Edge Function logs
supabase functions logs vrf-trigger-draw --tail

# Check cron job status (if using scheduled function)
SELECT * FROM pg_cron.job;
```

**Solutions**:
1. Verify Edge Function deployed correctly
2. Check cron schedule is active
3. Manually trigger via admin dashboard
4. Check for errors in function logs

---

### Issue: VRF Request Submitted But Not Fulfilled

**Symptoms**: VRF request ID exists but no fulfillment after 20+ minutes

**Diagnosis**:
```sql
-- Check VRF status
SELECT id, name, vrf_status, vrf_request_id, vrf_tx_hash
FROM competitions
WHERE id = '[COMPETITION_ID]';

-- Check on-chain status
# Visit Chainlink VRF dashboard
# Look up request ID
```

**Possible Causes**:
1. **Insufficient LINK Balance**: Top up subscription
2. **Network Congestion**: Wait longer (can take up to 1 hour during extreme congestion)
3. **Callback Gas Limit Too Low**: Increase in contract configuration
4. **Subscription Cancelled**: Re-create subscription

**Solutions**:
1. If LINK balance low: Top up immediately
2. If network congested: Wait and monitor
3. If truly stuck: Contact Chainlink support with request ID

---

### Issue: Winner Not Syncing to Database

**Symptoms**: VRF fulfilled on-chain but winner_user_id still null

**Diagnosis**:
```bash
# Check sync function logs
supabase functions logs vrf-sync-results --tail

# Verify on-chain winner
# Visit: https://basescan.org/tx/[VRF_TX_HASH]
# Look for RandomWordsFulfilled event
```

**Solutions**:
1. Manually call vrf-sync-results function
2. Extract winner from on-chain event logs
3. Update database manually (document in audit log)

---

## Post-Test Cleanup

After completing tests:

```sql
-- Delete test competitions
DELETE FROM competition_entries WHERE competition_id IN (
  SELECT id FROM competitions WHERE name LIKE '%VRF Test%'
);

DELETE FROM competitions WHERE name LIKE '%VRF Test%';

-- Verify cleanup
SELECT COUNT(*) FROM competitions WHERE name LIKE '%VRF Test%';
-- Should return 0
```

---

## Production VRF Checklist

Before launching:

- [ ] VRF subscription has >10 LINK tokens
- [ ] All test scenarios completed successfully (Tests 1-6)
- [ ] Automatic trigger tested and working
- [ ] Manual trigger tested and working
- [ ] Multiple concurrent draws tested
- [ ] Low balance alerts working
- [ ] VRF admin dashboard functional
- [ ] Winner notification system tested
- [ ] On-call engineer trained on VRF troubleshooting
- [ ] Chainlink VRF support contact information available
- [ ] Emergency manual winner selection process documented

---

## Emergency Manual Winner Selection

**⚠️ ONLY USE AS LAST RESORT** - Must be transparent to users

If VRF completely fails after all recovery attempts:

1. **Document Failure**:
   ```sql
   INSERT INTO audit_log (event_type, competition_id, details, admin_user_id)
   VALUES (
     'vrf_failure',
     '[COMPETITION_ID]',
     '{"reason": "VRF system failure", "attempts": 5, "timestamp": "'||NOW()||'"}',
     '[ADMIN_USER_ID]'
   );
   ```

2. **Generate Random Number** (use secure source):
   ```bash
   # Use /dev/random or similar secure source
   # NOT Math.random() or predictable sources
   openssl rand -hex 32
   ```

3. **Select Winner**:
   ```sql
   -- Get all entries
   SELECT user_id, ticket_count 
   FROM competition_entries 
   WHERE competition_id = '[COMPETITION_ID]';
   
   -- Manually calculate winner based on secure random number
   -- Document the process
   ```

4. **Update Database**:
   ```sql
   UPDATE competitions
   SET 
     winner_user_id = '[SELECTED_USER_ID]',
     vrf_status = 'manual_selection',
     vrf_draw_completed_at = NOW(),
     status = 'completed'
   WHERE id = '[COMPETITION_ID]';
   ```

5. **Public Disclosure**:
   - Announce manual selection was necessary
   - Explain what happened with VRF
   - Show process was fair and random
   - Offer proof of randomness source
   - Maintain transparency and trust

---

## VRF Resources

- **Chainlink VRF Documentation**: https://docs.chain.link/vrf/v2/introduction
- **Base Network VRF Dashboard**: https://vrf.chain.link/base
- **Base Network Block Explorer**: https://basescan.org/
- **Chainlink Support**: https://chainlinkcommunity.typeform.com/to/OYQO67EF

---

## Test Results Log

Document all test results:

| Test | Date | Pass/Fail | Duration | Notes |
|------|------|-----------|----------|-------|
| Happy Path | [DATE] | ✅ / ❌ | [TIME] | |
| Manual Trigger | [DATE] | ✅ / ❌ | [TIME] | |
| Concurrent Draws | [DATE] | ✅ / ❌ | [TIME] | |
| Low LINK | [DATE] | ✅ / ❌ | [TIME] | |
| Network Congestion | [DATE] | ✅ / ❌ | [TIME] | |
| Callback Recovery | [DATE] | ✅ / ❌ | [TIME] | |

**Test Completed By**: _________________  
**Test Verified By**: _________________  
**Approved for Production**: ⬜ YES ⬜ NO  
**Date**: _________

---

**CRITICAL REMINDER**: VRF is the cornerstone of trust in the platform. All real-world tests must pass before launch. Do not skip VRF testing.
