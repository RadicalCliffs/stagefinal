# Incident Response Runbook

## Overview
This runbook provides step-by-step procedures for responding to incidents during and after the Wednesday launch.

## Severity Levels

### **CRITICAL (P0)** - Immediate Response Required
- Complete site outage
- Payment processing completely broken
- Data breach or security vulnerability
- VRF system failure causing winners not being selected

### **HIGH (P1)** - Response within 15 minutes
- Partial payment failures (affecting >25% of transactions)
- Database performance degradation causing timeouts
- Authentication system issues preventing user login
- Real-time balance updates not working

### **MEDIUM (P2)** - Response within 1 hour
- Non-critical UI bugs affecting user experience
- Email notifications not sending
- Analytics or monitoring system failures
- Minor payment provider issues (affecting <25% of transactions)

### **LOW (P3)** - Response within 4 hours
- Cosmetic issues
- Documentation errors
- Non-critical feature requests

---

## Common Incident Scenarios

### 1. Payment System Failure

#### Symptoms
- Users report unable to complete top-ups or entry purchases
- Increased error rates in payment endpoints
- Coinbase Commerce webhooks not processing

#### Immediate Actions
1. Check Coinbase Commerce dashboard for service status
2. Verify webhook endpoint is accessible: `/api/commerce-webhook`
3. Check Supabase Edge Function logs for errors
4. Review `pending_topups` and `pending_tickets` tables for stuck transactions

#### Diagnosis Commands
```bash
# Check recent failed payment transactions
SELECT * FROM pending_topups 
WHERE created_at > NOW() - INTERVAL '1 hour' 
AND status = 'failed' 
ORDER BY created_at DESC LIMIT 20;

# Check pending tickets that haven't been confirmed
SELECT * FROM pending_tickets 
WHERE created_at > NOW() - INTERVAL '1 hour' 
AND confirmed_at IS NULL 
ORDER BY created_at DESC LIMIT 20;

# Check Supabase Edge Function logs
supabase functions logs commerce-webhook --tail
```

#### Resolution Steps
1. **If Coinbase Commerce is down**: Display maintenance message, redirect users to alternative payment method
2. **If webhook processing is broken**: 
   - Deploy webhook fix immediately
   - Run manual reconciliation script to process stuck transactions
3. **If database trigger issues**: Check `balance_ledger` triggers are functioning

#### Communication Template
```
🚨 We're experiencing issues with payment processing. Our team is investigating. 
No funds have been charged. We'll update you within 15 minutes.
```

---

### 2. Database Performance Issues

#### Symptoms
- Slow page loads (>5 seconds)
- Database query timeouts
- High CPU or memory usage in Supabase dashboard

#### Immediate Actions
1. Check Supabase dashboard for resource usage
2. Identify slow queries using pg_stat_statements
3. Review recent database migrations
4. Check connection pool status

#### Diagnosis Commands
```sql
-- Find slow-running queries
SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
FROM pg_stat_activity
WHERE (now() - pg_stat_activity.query_start) > interval '5 seconds'
  AND state != 'idle';

-- Check table sizes
SELECT schemaname, tablename, 
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 10;

-- Check index usage
SELECT schemaname, tablename, indexname, idx_scan as index_scans
FROM pg_stat_user_indexes
ORDER BY idx_scan ASC;
```

#### Resolution Steps
1. **If specific query is slow**: Add or update indexes
2. **If connection pool exhausted**: Increase max connections in Supabase settings
3. **If table bloat**: Run VACUUM ANALYZE on affected tables
4. **If resource limits hit**: Scale up Supabase instance immediately

#### Mitigation
- Enable read replicas for heavy read queries
- Implement query result caching
- Add database connection pooling with PgBouncer

---

### 3. VRF System Failure

#### Symptoms
- Competition end time passed but no winner selected
- VRF transaction failed on-chain
- VRF request submitted but not fulfilled by Chainlink
- Users report "Drawing..." status stuck for >2 hours

#### Immediate Actions
1. Check VRF admin dashboard: `/admin/vrf-dashboard`
2. Review VRF Edge Function logs
3. Check Chainlink VRF subscription balance
4. Verify VRF contract configuration on Base blockchain

#### Diagnosis Commands
```bash
# Check VRF status for recent competitions
SELECT id, name, draw_date, vrf_status, vrf_tx_hash, vrf_draw_completed_at
FROM competitions
WHERE draw_date > NOW() - INTERVAL '24 hours'
ORDER BY draw_date DESC;

# Check VRF Edge Function logs
supabase functions logs vrf-trigger-draw --tail
supabase functions logs vrf-sync-results --tail

# Check Chainlink subscription
# Visit: https://vrf.chain.link (Base network)
```

#### Resolution Steps
1. **If Chainlink subscription empty**: 
   - Top up LINK tokens immediately
   - Manual trigger VRF request retry
2. **If VRF transaction failed**:
   - Check gas settings and network congestion
   - Retry with higher gas limit
3. **If VRF result not synced**:
   - Manually call `vrf-sync-results` function
   - Update competition status to reflect winner

#### Manual Winner Selection (Emergency Only)
```sql
-- ONLY use if VRF completely fails and manual intervention is required
-- This should be documented and transparent to users

-- 1. Generate random number using secure source
-- 2. Select winner manually
UPDATE competitions 
SET 
  winner_user_id = '[SELECTED_USER_ID]',
  vrf_status = 'manual_selection',
  vrf_draw_completed_at = NOW(),
  status = 'completed'
WHERE id = '[COMPETITION_ID]';

-- 3. Document in audit log
INSERT INTO audit_log (event_type, competition_id, details)
VALUES ('manual_winner_selection', '[COMPETITION_ID]', 
  '{"reason": "VRF system failure", "timestamp": "'||NOW()||'"}');
```

#### Communication Template
```
⚠️ We're experiencing a delay in announcing the winner for [COMPETITION NAME]. 
The draw is being verified. Winner will be announced shortly. 
All entries remain valid.
```

---

### 4. Authentication System Issues

#### Symptoms
- Users unable to log in
- Session tokens expiring too quickly
- Magic link emails not sending
- Wallet connection failures

#### Immediate Actions
1. Check Supabase Auth logs
2. Verify SendGrid email delivery
3. Test login flow in incognito mode
4. Check RLS policies haven't been changed

#### Diagnosis Commands
```bash
# Check recent auth errors
SELECT * FROM auth.audit_log_entries
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC LIMIT 50;

# Check SendGrid delivery
# Visit: https://app.sendgrid.com/email_activity

# Test Supabase connection
curl -X GET '[SUPABASE_URL]/rest/v1/' \
  -H "apikey: [SUPABASE_ANON_KEY]"
```

#### Resolution Steps
1. **If email delivery broken**: Check SendGrid API key, check spam filters
2. **If RLS blocking access**: Review and fix RLS policies
3. **If session issues**: Check JWT expiration settings in Supabase Auth
4. **If wallet connection broken**: Check WalletConnect/Coinbase SDK versions

---

### 5. Real-time Balance Update Failures

#### Symptoms
- User balance not updating after top-up
- Optimistic UI updates not reflected after confirmation
- Balance shows incorrect value

#### Immediate Actions
1. Check Supabase Realtime subscriptions
2. Verify balance_ledger triggers are firing
3. Check for race conditions in payment confirmation flow
4. Review pending_topups reconciliation

#### Diagnosis Commands
```sql
-- Check recent balance updates
SELECT * FROM balance_ledger
WHERE user_id = '[USER_ID]'
ORDER BY created_at DESC LIMIT 10;

-- Check for stuck pending top-ups
SELECT * FROM pending_topups
WHERE confirmed_at IS NULL
  AND created_at < NOW() - INTERVAL '10 minutes'
ORDER BY created_at DESC;

-- Verify balance calculation
SELECT 
  user_id,
  SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END) as calculated_balance
FROM balance_ledger
WHERE user_id = '[USER_ID]'
GROUP BY user_id;
```

#### Resolution Steps
1. **If realtime not working**: Restart Supabase Realtime service
2. **If trigger not firing**: Re-create balance_ledger triggers
3. **If balance calculation wrong**: Run balance reconciliation script
4. **Manual balance fix** (document in audit log):
```sql
-- Recalculate and fix user balance
WITH calculated AS (
  SELECT 
    user_id,
    SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END) as correct_balance
  FROM balance_ledger
  WHERE user_id = '[USER_ID]'
  GROUP BY user_id
)
UPDATE profiles
SET balance_usd = calculated.correct_balance
FROM calculated
WHERE profiles.id = calculated.user_id;
```

---

## Rollback Procedures

### Frontend Rollback
```bash
# If deployed via Netlify
netlify rollback

# If deployed via custom deployment
git revert [COMMIT_HASH]
npm run build
npm run deploy
```

### Database Migration Rollback
```bash
# Identify the migration to rollback
supabase migration list

# Create a down migration
supabase migration new rollback_[migration_name]

# Apply the rollback
supabase db push
```

### Edge Function Rollback
```bash
# Redeploy previous version
cd supabase/functions/[function-name]
git checkout [PREVIOUS_COMMIT] -- .
supabase functions deploy [function-name]
```

---

## Monitoring & Alerting

### Key Metrics to Monitor
1. **Payment Success Rate**: Should be >95%
2. **Page Load Time**: Should be <3 seconds (p95)
3. **API Response Time**: Should be <500ms (p95)
4. **Error Rate**: Should be <1%
5. **Database Connection Pool**: Should be <80% utilized

### Alert Thresholds
- **CRITICAL**: Payment success rate <90%, Site completely down
- **HIGH**: Payment success rate <95%, Page load time >5s, Error rate >5%
- **MEDIUM**: Payment success rate <98%, Page load time >3s, Error rate >2%

### Monitoring Tools
- **Supabase Dashboard**: Database performance, Edge Function logs
- **Netlify Analytics**: Frontend deployment status, traffic
- **Sentry** (when implemented): Error tracking and alerting
- **Google Analytics**: User behavior and conversion tracking

---

## Post-Incident Review

After resolving an incident, conduct a post-incident review within 24 hours:

### Review Template
1. **Incident Summary**: What happened?
2. **Timeline**: When did it start/end?
3. **Impact**: How many users were affected?
4. **Root Cause**: Why did it happen?
5. **Resolution**: How was it fixed?
6. **Action Items**: What can prevent this in the future?
7. **Documentation**: What needs to be updated?

### Action Item Tracking
- Create GitHub issues for follow-up tasks
- Assign owners and due dates
- Update runbook with lessons learned

---

## Emergency Contacts

### Internal Team
- **Technical Lead**: [NAME] - [PHONE/TELEGRAM]
- **DevOps**: [NAME] - [PHONE/TELEGRAM]
- **Product Owner**: [NAME] - [PHONE/TELEGRAM]

### External Services
- **Supabase Support**: support@supabase.com
- **Coinbase Commerce**: https://commerce.coinbase.com/dashboard
- **Netlify Support**: https://www.netlify.com/support/
- **Chainlink VRF**: https://chain.link/vrf

### Service Status Pages
- Supabase: https://status.supabase.com/
- Coinbase: https://status.coinbase.com/
- Base Network: https://status.base.org/
- Netlify: https://www.netlifystatus.com/

---

## Testing This Runbook

**Schedule regular drills** to ensure team familiarity:
- Monthly: Payment system failure simulation
- Quarterly: Full disaster recovery drill
- Before major launches: Complete runbook walkthrough

**Last Updated**: 2026-02-15
**Next Review Date**: 2026-03-15
