# Admin Dashboard Guide

## Overview
This guide provides comprehensive instructions for using the admin dashboard to manage competitions, monitor payments, and troubleshoot issues.

## Accessing the Admin Dashboard

### URL
- Production: `https://theprize.io/admin`
- Development: `http://localhost:5173/admin`

### Authentication
Admin access is controlled by the `is_admin` flag in the `profiles` table. Only users with `is_admin = true` can access admin features.

```sql
-- Grant admin access to a user
UPDATE profiles SET is_admin = true WHERE id = '[USER_ID]';
```

---

## Admin Dashboard Features

### 1. Competition Management

#### Creating a New Competition

1. **Navigate to Admin > Create Competition**
2. **Fill in Competition Details**:
   - **Name**: Display name for the competition (e.g., "Win a Tesla Model 3")
   - **Description**: Detailed description with markdown support
   - **Prize**: Prize description and estimated value
   - **Ticket Price**: Price per entry in USD
   - **Total Tickets**: Maximum number of tickets available
   - **Start Date**: When ticket sales begin
   - **End Date**: When ticket sales close (draw happens automatically after)
   - **Type**: Select competition type:
     - `standard`: Traditional draw with single winner
     - `instant_win`: Instant win game with multiple prizes
     - `lucky_dip`: Quick draw with smaller prizes

3. **Upload Images**:
   - Main prize image (recommended: 1200x800px, <500KB)
   - Gallery images (optional, up to 5 images)

4. **Configure VRF Settings** (automatically handled):
   - VRF will be automatically triggered when end_date is reached
   - Competition ID is generated and associated with VRF request
   - Results are synced automatically via webhook

5. **Publish Competition**:
   - Click "Publish" to make the competition live
   - Competition will appear on the homepage immediately

#### Editing an Existing Competition

1. Navigate to **Admin > Competitions**
2. Find the competition in the list
3. Click **Edit**
4. Make changes (Note: Cannot edit after tickets have been sold)
5. Click **Save Changes**

#### Competition Status Management

| Status | Description | Actions Available |
|--------|-------------|-------------------|
| `draft` | Not yet published | Edit, Delete, Publish |
| `active` | Currently accepting entries | Edit (limited), End Early, View Entries |
| `ended` | Sales closed, awaiting draw | Trigger Draw Manually, View Entries |
| `drawing` | VRF draw in progress | Monitor VRF Status |
| `completed` | Winner selected | View Winner, View All Entries |
| `cancelled` | Cancelled (refunds issued) | View Audit Log |

#### Ending a Competition Early

```
⚠️ Use with caution - this immediately stops ticket sales
```

1. Navigate to competition details
2. Click **End Early**
3. Confirm action
4. VRF draw will be triggered automatically

---

### 2. VRF System Monitoring

#### VRF Dashboard (`/admin/vrf-dashboard`)

The VRF dashboard provides real-time monitoring of the Chainlink VRF system that ensures provably fair winner selection.

**Key Metrics Displayed**:
- **VRF Subscription Balance**: LINK tokens available for randomness requests
- **Pending Draws**: Competitions waiting for VRF fulfillment
- **Recent Draws**: Last 20 VRF draws with status
- **Failed Draws**: Any draws that need attention

#### VRF Status Indicators

| Status | Meaning | Action Required |
|--------|---------|-----------------|
| `pending` | VRF request submitted, awaiting Chainlink | None - monitor |
| `fulfilled` | Random number received from Chainlink | None |
| `synced` | Winner selected and recorded | None |
| `failed` | VRF request failed | Investigate and retry |
| `manual_selection` | Manual intervention required | Contact tech lead |

#### Triggering VRF Draw Manually

**When to use**: Competition ended but VRF hasn't automatically triggered

1. Navigate to **Admin > VRF Dashboard**
2. Find the competition in "Pending Draws"
3. Click **Trigger Draw**
4. Confirm the action
5. Monitor the VRF status

#### Troubleshooting VRF Issues

**Problem**: VRF request stuck in "pending" for >1 hour
```
Solutions:
1. Check Chainlink subscription balance
2. Verify network isn't congested (high gas prices)
3. Check VRF Edge Function logs for errors
4. If needed, manually call vrf-sync-results function
```

**Problem**: VRF subscription balance low (<2 LINK)
```
Immediate Action:
1. Top up LINK tokens in Chainlink VRF subscription
2. Visit: https://vrf.chain.link/base/[SUBSCRIPTION_ID]
3. Add at least 10 LINK tokens
```

**Problem**: VRF draw failed on-chain
```
Steps:
1. Check transaction hash on Base block explorer
2. Identify failure reason (gas limit, revert, etc.)
3. Retry draw with adjusted parameters
4. Document in incident log
```

---

### 3. User Management

#### Viewing User Details

1. Navigate to **Admin > Users**
2. Search by email, wallet address, or user ID
3. Click on user to view details:
   - Profile information
   - Balance history
   - Entry history
   - Transaction history
   - Linked wallets

#### Manual Balance Adjustments

**Use Case**: Refunds, promotions, error corrections

```sql
-- Credit user balance (adds money)
INSERT INTO balance_ledger (user_id, type, amount, description, category)
VALUES (
  '[USER_ID]',
  'credit',
  50.00,
  'Manual adjustment: [REASON]',
  'admin_adjustment'
);

-- Debit user balance (removes money)
INSERT INTO balance_ledger (user_id, type, amount, description, category)
VALUES (
  '[USER_ID]',
  'debit',
  25.00,
  'Manual adjustment: [REASON]',
  'admin_adjustment'
);
```

**Always document adjustments**:
```sql
INSERT INTO audit_log (event_type, user_id, details, admin_user_id)
VALUES (
  'manual_balance_adjustment',
  '[USER_ID]',
  '{"amount": 50.00, "reason": "Refund for cancelled competition", "previous_balance": 100.00}',
  '[ADMIN_USER_ID]'
);
```

#### Viewing User Competition Entries

1. Navigate to user profile in admin dashboard
2. Click **Entries** tab
3. View all competition entries with:
   - Competition name
   - Number of tickets
   - Purchase date and time
   - Payment method
   - Entry status (active, won, lost)

---

### 4. Payment Monitoring

#### Payment Dashboard (`/admin/payments`)

Monitor all payment transactions across the platform.

**Filters Available**:
- Date range
- Payment type (top-up, entry purchase)
- Payment method (crypto, commerce, base-account)
- Status (pending, confirmed, failed)
- Amount range

#### Payment Status Types

| Status | Description | Action Required |
|--------|-------------|-----------------|
| `pending` | Payment initiated, awaiting confirmation | Monitor |
| `confirmed` | Payment successfully processed | None |
| `failed` | Payment failed or rejected | Investigate |
| `expired` | Payment session expired without completion | None |
| `cancelled` | User cancelled payment | None |

#### Reconciling Stuck Payments

**Scenario**: User reports payment not credited

1. **Locate Transaction**:
   ```sql
   -- Find pending top-ups for user
   SELECT * FROM pending_topups
   WHERE user_id = '[USER_ID]'
   ORDER BY created_at DESC;
   
   -- Find pending tickets for user
   SELECT * FROM pending_tickets
   WHERE user_id = '[USER_ID]'
   ORDER BY created_at DESC;
   ```

2. **Check Payment Provider Status**:
   - For Coinbase Commerce: Check transaction in Commerce dashboard
   - For Base Account: Check transaction hash on Base block explorer

3. **Manual Confirmation** (if payment verified):
   ```sql
   -- For top-ups
   UPDATE pending_topups
   SET confirmed_at = NOW(), status = 'confirmed'
   WHERE id = '[TOPUP_ID]';
   
   -- For ticket purchases
   -- Call confirm-pending-tickets Edge Function
   ```

4. **Document in Audit Log**:
   ```sql
   INSERT INTO audit_log (event_type, details, admin_user_id)
   VALUES (
     'manual_payment_confirmation',
     '{"transaction_id": "[TX_ID]", "reason": "Payment stuck in pending", "user_id": "[USER_ID]"}',
     '[ADMIN_USER_ID]'
   );
   ```

---

### 5. Analytics and Reporting

#### Key Performance Indicators (KPIs)

Access via **Admin > Analytics Dashboard**

**Revenue Metrics**:
- Total revenue (24h, 7d, 30d, all-time)
- Average transaction value
- Revenue by payment method
- Revenue by competition type

**User Metrics**:
- New user signups (24h, 7d, 30d)
- Active users (DAU, WAU, MAU)
- User retention rate
- Average tickets per user

**Competition Metrics**:
- Active competitions
- Ticket sales velocity
- Completion rate
- Prize pool size

**Payment Metrics**:
- Payment success rate
- Average processing time
- Failed payment rate
- Top-up vs entry purchase ratio

#### Generating Reports

**Daily Summary Report**:
```sql
SELECT 
  DATE(created_at) as date,
  COUNT(DISTINCT user_id) as unique_users,
  COUNT(*) as total_transactions,
  SUM(amount) as total_revenue,
  AVG(amount) as avg_transaction_value
FROM balance_ledger
WHERE type = 'credit'
  AND created_at >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

**Competition Performance Report**:
```sql
SELECT 
  c.id,
  c.name,
  c.status,
  COUNT(DISTINCT e.user_id) as unique_entrants,
  COUNT(e.id) as total_tickets_sold,
  c.max_tickets_available,
  ROUND((COUNT(e.id)::numeric / c.max_tickets_available) * 100, 2) as fill_rate_pct,
  SUM(c.ticket_price) as revenue_generated
FROM competitions c
LEFT JOIN competition_entries e ON c.id = e.competition_id
WHERE c.created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY c.id, c.name, c.status, c.max_tickets_available
ORDER BY revenue_generated DESC;
```

---

### 6. System Health Monitoring

#### Database Performance

**Check Active Connections**:
```sql
SELECT 
  count(*) as total_connections,
  SUM(CASE WHEN state = 'active' THEN 1 ELSE 0 END) as active_queries,
  SUM(CASE WHEN state = 'idle' THEN 1 ELSE 0 END) as idle_connections
FROM pg_stat_activity;
```

**Check Slow Queries** (queries running >5 seconds):
```sql
SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
FROM pg_stat_activity
WHERE (now() - pg_stat_activity.query_start) > interval '5 seconds'
  AND state = 'active';
```

**Check Table Sizes**:
```sql
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
  pg_total_relation_size(schemaname||'.'||tablename) as bytes
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY bytes DESC
LIMIT 10;
```

#### Edge Function Health

Check Edge Function logs via Supabase dashboard or CLI:
```bash
# View recent logs for specific function
supabase functions logs [function-name] --tail

# View logs with errors only
supabase functions logs [function-name] | grep ERROR
```

**Critical Edge Functions to Monitor**:
- `commerce-webhook`: Payment processing
- `vrf-trigger-draw`: Winner selection trigger
- `vrf-sync-results`: Winner sync after VRF fulfillment
- `confirm-pending-tickets`: Ticket confirmation
- `select-competition-winners`: Winner announcement

---

### 7. Promotional Tools

#### Creating Bonus Campaigns

**First Deposit Bonus** (50% bonus on first top-up):
- Already implemented in `useRealTimeBalance` hook
- Automatically applied to first top-up
- No admin action required

**Promotional Codes** (Future Feature):
```sql
-- Create promotional code
INSERT INTO promo_codes (code, discount_type, discount_value, valid_from, valid_until, max_uses)
VALUES (
  'LAUNCH50',
  'percentage',
  50.00,
  NOW(),
  NOW() + INTERVAL '7 days',
  1000
);
```

#### Manual Ticket Grants

**Use Case**: Contest winners, influencer promotions, compensations

```sql
-- Grant free tickets to user
INSERT INTO competition_entries (competition_id, user_id, ticket_count, purchase_price_paid)
VALUES (
  '[COMPETITION_ID]',
  '[USER_ID]',
  5,  -- number of tickets
  0.00  -- free tickets
);

-- Document in audit log
INSERT INTO audit_log (event_type, competition_id, user_id, details, admin_user_id)
VALUES (
  'manual_ticket_grant',
  '[COMPETITION_ID]',
  '[USER_ID]',
  '{"tickets": 5, "reason": "Promotional giveaway"}',
  '[ADMIN_USER_ID]'
);
```

---

## Security Best Practices

### Admin Account Security

1. **Use Strong Passwords**: Minimum 16 characters, mix of letters, numbers, symbols
2. **Enable 2FA**: Use authenticator app (Google Authenticator, Authy)
3. **Limit Admin Access**: Only grant admin privileges when absolutely necessary
4. **Regular Audits**: Review admin access list quarterly
5. **Separate Admin Accounts**: Don't use personal accounts for admin tasks

### Audit Logging

**All admin actions should be logged**:
```sql
-- Example: Log when viewing sensitive user data
INSERT INTO audit_log (event_type, user_id, details, admin_user_id)
VALUES (
  'admin_viewed_user_details',
  '[VIEWED_USER_ID]',
  '{"viewed_at": "'||NOW()||'", "ip_address": "[IP]"}',
  '[ADMIN_USER_ID]'
);
```

### Data Privacy

When accessing user data:
- Only access what's necessary for the task
- Don't share user data externally
- Redact sensitive information in screenshots
- Follow GDPR/privacy regulations

---

## Common Admin Tasks

### Task 1: Refund a User

```sql
-- 1. Credit user's balance
INSERT INTO balance_ledger (user_id, type, amount, description, category)
VALUES (
  '[USER_ID]',
  'credit',
  [AMOUNT],
  'Refund for: [REASON]',
  'refund'
);

-- 2. Document the refund
INSERT INTO audit_log (event_type, user_id, details, admin_user_id)
VALUES (
  'manual_refund',
  '[USER_ID]',
  '{"amount": [AMOUNT], "reason": "[REASON]", "original_transaction_id": "[TX_ID]"}',
  '[ADMIN_USER_ID]'
);

-- 3. Notify user (optional)
-- Send email via SendGrid or in-app notification
```

### Task 2: Cancel a Competition

```sql
-- 1. Update competition status
UPDATE competitions
SET status = 'cancelled', cancellation_reason = '[REASON]'
WHERE id = '[COMPETITION_ID]';

-- 2. Calculate refunds needed
SELECT 
  e.user_id,
  SUM(e.ticket_count * c.ticket_price) as refund_amount
FROM competition_entries e
JOIN competitions c ON e.competition_id = c.id
WHERE c.id = '[COMPETITION_ID]'
GROUP BY e.user_id;

-- 3. Process refunds for each user (use Task 1 process)

-- 4. Document cancellation
INSERT INTO audit_log (event_type, competition_id, details, admin_user_id)
VALUES (
  'competition_cancelled',
  '[COMPETITION_ID]',
  '{"reason": "[REASON]", "total_entries": [COUNT], "refunds_processed": [COUNT]}',
  '[ADMIN_USER_ID]'
);
```

### Task 3: Fix Duplicate User Accounts

```sql
-- Merge duplicate accounts (use canonical_user_id)
-- This should be done carefully with backup

-- 1. Identify duplicates
SELECT canonical_user_id, COUNT(*) as account_count
FROM profiles
GROUP BY canonical_user_id
HAVING COUNT(*) > 1;

-- 2. Keep primary account, migrate data from duplicates
-- 3. Soft-delete duplicate accounts
-- 4. Document in audit log
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + K` | Quick search |
| `Ctrl/Cmd + /` | Show help |
| `Esc` | Close modal |
| `Ctrl/Cmd + S` | Save changes |

---

## Support Resources

- **Technical Documentation**: `/docs`
- **API Reference**: `/docs/api`
- **Incident Response Runbook**: `/docs/INCIDENT_RESPONSE_RUNBOOK.md`
- **Database Schema**: `/docs/schema`
- **Supabase Dashboard**: https://app.supabase.com/
- **Coinbase Commerce**: https://commerce.coinbase.com/dashboard

---

**Last Updated**: 2026-02-15  
**Maintained By**: Technical Team  
**Review Schedule**: Monthly
