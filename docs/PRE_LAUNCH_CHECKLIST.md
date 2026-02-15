# Pre-Launch Checklist for Wednesday Launch

## Overview
This checklist ensures all systems are ready for the Wednesday production launch. Complete all items before deployment.

**Target Launch Date**: Wednesday, [DATE]  
**Launch Time**: 09:00 UTC  
**Checklist Owner**: [NAME]  
**Last Updated**: 2026-02-15

---

## 1. Environment Configuration ✅

### Production Environment Variables

Verify all required environment variables are set in production (Netlify/hosting platform):

#### Frontend Environment Variables (Netlify)
- [ ] `VITE_SUPABASE_URL` - Production Supabase URL
- [ ] `VITE_SUPABASE_ANON_KEY` - Production Supabase anon key
- [ ] `VITE_CDP_PROJECT_ID` - Coinbase Developer Platform project ID
- [ ] `VITE_ONCHAINKIT_PROJECT_ID` - OnchainKit project ID (same as CDP)
- [ ] `VITE_CDP_CLIENT_API_KEY` - Coinbase client API key
- [ ] `VITE_BASE_MAINNET` - Set to `true` for mainnet
- [ ] `VITE_TREASURY_ADDRESS` - Production treasury wallet address
- [ ] `VITE_GA_MEASUREMENT_ID` - Google Analytics ID
- [ ] `VITE_APP_NAME` - "The Prize - Win Big with Crypto"
- [ ] `VITE_APP_LOGO_URL` - https://theprize.io/logo.png

**Verify**:
```bash
# Check all frontend env vars are set
netlify env:list --context production
```

#### Backend Environment Variables (Supabase Edge Functions)
- [ ] `SENDGRID_API_KEY` - Email delivery service key
- [ ] `SENDGRID_FROM_EMAIL` - contact@theprize.io
- [ ] `SENDGRID_TEMPLATE_WELCOME` - Welcome email template ID
- [ ] `CDP_API_KEY_ID` - Server-side CDP API key ID
- [ ] `CDP_API_KEY_SECRET` - Server-side CDP API key secret
- [ ] `COMMERCE_WEBHOOK_SECRET` - Coinbase Commerce webhook secret

**Verify**:
```bash
# Check Supabase secrets
supabase secrets list
```

#### Blockchain Configuration
- [ ] VRF Coordinator Address verified for Base Mainnet
- [ ] VRF Key Hash configured correctly
- [ ] VRF Subscription ID has sufficient LINK tokens (minimum 10 LINK)
- [ ] Treasury wallet has sufficient gas for transactions
- [ ] USDC contract address set to Base Mainnet (0x833589fcd6edb6e08f4c7c32d4f71b54bda02913)

**Verify VRF Subscription**:
```
Visit: https://vrf.chain.link/base/[SUBSCRIPTION_ID]
Confirm: Balance > 10 LINK
```

---

## 2. Database Migrations 🗄️

### Pre-Migration Backup
- [ ] Create full database backup before any migrations
- [ ] Store backup in secure location with timestamp
- [ ] Test backup restoration process

**Backup Command**:
```bash
# Via Supabase CLI
supabase db dump -f backup-pre-launch-$(date +%Y%m%d).sql

# Via Supabase Dashboard
# Settings > Database > Backups > Manual Backup
```

### Apply Pending Migrations
- [ ] Review all pending migrations in `/supabase/migrations/`
- [ ] Test migrations in staging environment first
- [ ] Apply migrations to production database
- [ ] Verify migration success

**Migration Command**:
```bash
# Check pending migrations
supabase migration list

# Apply migrations
supabase db push

# Verify applied migrations
SELECT * FROM supabase_migrations.schema_migrations 
ORDER BY version DESC LIMIT 10;
```

### Post-Migration Verification
- [ ] All tables have correct schema
- [ ] All indexes are created and used
- [ ] All RLS policies are active
- [ ] All triggers are functioning
- [ ] All RPC functions exist and work

**Verification Queries**:
```sql
-- Check critical tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('profiles', 'competitions', 'competition_entries', 
                   'balance_ledger', 'pending_topups', 'pending_tickets');

-- Check RLS is enabled on critical tables
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND rowsecurity = false;  -- Should be empty

-- Check indexes exist
SELECT tablename, indexname FROM pg_indexes 
WHERE schemaname = 'public' 
ORDER BY tablename;
```

---

## 3. Security Review 🔒

### API Keys and Secrets
- [ ] All production API keys rotated from development keys
- [ ] No development/test keys in production environment
- [ ] All secrets stored in secure environment variables (not in code)
- [ ] Webhook secrets configured and verified
- [ ] Service role keys only on server-side, never exposed to frontend

**Audit**:
```bash
# Check for any hardcoded secrets in codebase
grep -r "sk_" src/
grep -r "secret" src/ | grep -i "=" 
grep -r "api_key" src/ | grep -i "="
# All above should return no results
```

### Row Level Security (RLS)
- [ ] RLS enabled on all user-facing tables
- [ ] Test RLS policies with different user roles
- [ ] Verify users can only access their own data
- [ ] Admin users have appropriate elevated access
- [ ] No bypass mechanisms exist in production

**RLS Test**:
```sql
-- Test as regular user
SET LOCAL ROLE authenticator;
SET LOCAL request.jwt.claim.sub = '[TEST_USER_ID]';

-- Should only return this user's data
SELECT * FROM profiles;
SELECT * FROM balance_ledger;
SELECT * FROM competition_entries;

-- Should fail or return empty
SELECT * FROM profiles WHERE id != '[TEST_USER_ID]';
```

### CORS Configuration
- [ ] CORS restricted to production domain only
- [ ] No wildcard (*) origins in production
- [ ] Supabase CORS settings verified
- [ ] Netlify CORS headers configured

**Supabase CORS Check**:
```
Dashboard > API Settings > CORS Configuration
Allowed Origins: https://theprize.io
```

### Authentication Security
- [ ] Email verification enabled
- [ ] Password requirements enforced (if using email/password)
- [ ] Session timeout configured appropriately
- [ ] Magic link expiration set
- [ ] JWT secret rotated

**Verify Auth Settings**:
```
Supabase Dashboard > Authentication > Settings
- Email confirmation: Enabled
- JWT expiry: 3600 seconds (1 hour)
- Refresh token expiry: 2592000 seconds (30 days)
```

---

## 4. Payment System Verification 💳

### Coinbase Commerce
- [ ] Production API keys configured
- [ ] Webhook URL configured: `[SUPABASE_URL]/functions/v1/commerce-webhook`
- [ ] Webhook secret set and verified
- [ ] Test transaction processed successfully
- [ ] Charge creation working for all amounts
- [ ] Dynamic checkout URLs generating correctly

**Test Commerce Integration**:
```bash
# Test charge creation endpoint
curl -X POST '[SUPABASE_URL]/functions/v1/commerce-webhook/test' \
  -H 'Authorization: Bearer [ANON_KEY]'
```

### Base Account SDK
- [ ] Treasury address configured and funded
- [ ] USDC balance verified in treasury
- [ ] Test payment processed successfully
- [ ] Payment confirmation working
- [ ] Balance updates in real-time

**Test Base Account Payment**:
```
1. Connect wallet in staging
2. Attempt $5 top-up via Base Account
3. Verify payment on Base block explorer
4. Confirm balance updated in app
```

### Payment Confirmation Flow
- [ ] `pending_topups` processed correctly
- [ ] `pending_tickets` confirmed automatically
- [ ] Balance ledger updates trigger correctly
- [ ] Webhook processing working
- [ ] Failed payments handled gracefully

**Monitor Pending Payments**:
```sql
-- Should be minimal/zero pending items
SELECT COUNT(*) FROM pending_topups WHERE confirmed_at IS NULL;
SELECT COUNT(*) FROM pending_tickets WHERE confirmed_at IS NULL;
```

---

## 5. VRF System Testing 🎲

### VRF Configuration
- [ ] VRF Coordinator address correct for Base Mainnet
- [ ] VRF Key Hash matches network
- [ ] VRF Subscription funded (>10 LINK)
- [ ] Gas lane (key hash) appropriate for Base Mainnet
- [ ] Callback gas limit sufficient (2,500,000)

**Verify VRF Config**:
```typescript
// In src/constants/vrf.ts
export const VRF_COORDINATOR_ADDRESS = '0x...'; // Base Mainnet
export const VRF_KEY_HASH = '0x...'; // Correct for Base Mainnet
export const VRF_SUBSCRIPTION_ID = '...'; // Funded subscription
```

### End-to-End VRF Testing

**⚠️ CRITICAL: Complete REAL WORLD VRF TEST before launch**

- [ ] Create test competition with short duration (1 hour)
- [ ] Purchase test entries from multiple users
- [ ] Wait for competition to end naturally
- [ ] Verify VRF automatically triggered
- [ ] Confirm Chainlink VRF request submitted
- [ ] Monitor VRF fulfillment (should complete in ~5-10 minutes)
- [ ] Verify winner selected correctly
- [ ] Confirm winner notification sent
- [ ] Check VRF transaction on Base block explorer
- [ ] Verify all VRF data recorded in database

**VRF Test Checklist**:
```sql
-- After test draw completes
SELECT 
  id, name, status,
  vrf_status, vrf_request_id, vrf_tx_hash,
  winner_user_id, vrf_draw_completed_at
FROM competitions
WHERE id = '[TEST_COMPETITION_ID]';

-- Should show:
-- status: 'completed'
-- vrf_status: 'fulfilled'
-- vrf_tx_hash: populated
-- winner_user_id: populated
-- vrf_draw_completed_at: populated
```

### VRF Failure Scenarios

Test and document handling of:
- [ ] Insufficient LINK balance (should alert admin)
- [ ] Network congestion (should retry with higher gas)
- [ ] VRF callback failure (should log and retry)
- [ ] Manual intervention process documented

---

## 6. Real-Time Features 📡

### Supabase Realtime
- [ ] Realtime enabled for critical tables
- [ ] WebSocket connections working
- [ ] Balance updates trigger UI changes
- [ ] Competition status updates in real-time
- [ ] Ticket counter updates live

**Test Realtime**:
```javascript
// In browser console on production site
const subscription = supabase
  .channel('balance-updates')
  .on('postgres_changes', 
      { event: '*', schema: 'public', table: 'balance_ledger' }, 
      payload => console.log('Balance update:', payload))
  .subscribe();

// Make a balance change and verify console logs fire
```

### Balance Synchronization
- [ ] Balance updates immediately after top-up
- [ ] Optimistic UI updates working
- [ ] Balance rolls back if payment fails
- [ ] No race conditions in balance calculation
- [ ] Balance audit trail complete

---

## 7. Email System 📧

### SendGrid Configuration
- [ ] Production API key configured
- [ ] Sender email verified (contact@theprize.io)
- [ ] Domain authentication (SPF, DKIM) configured
- [ ] All email templates published

**Verify Domain Authentication**:
```
SendGrid Dashboard > Settings > Sender Authentication
Status: Verified ✅
```

### Email Templates
- [ ] Welcome email template active
- [ ] Winner notification template active
- [ ] Entry confirmation template active
- [ ] Password reset template active (if applicable)

**Test Each Template**:
```bash
# Send test emails to team
# Verify formatting, links, branding
```

### Email Deliverability
- [ ] Test emails delivered to inbox (not spam)
- [ ] Unsubscribe links working
- [ ] Email open/click tracking enabled
- [ ] Bounce handling configured

---

## 8. Frontend Build & Deployment 🚀

### Build Optimization
- [ ] Production build successful
- [ ] No console errors in build
- [ ] Bundle size optimized (<5MB total)
- [ ] Code splitting working correctly
- [ ] Tree shaking removing unused code

**Build Command**:
```bash
npm run build

# Verify build output
ls -lh dist/
# Should see reasonable file sizes

# Check for source maps (should not be in production)
find dist/ -name "*.map" 
# Should be empty or configured for error tracking only
```

### Performance Optimization
- [ ] Images optimized and compressed
- [ ] Lazy loading implemented for images
- [ ] Code split by route
- [ ] Critical CSS inlined
- [ ] Font loading optimized

**Lighthouse Audit**:
```
Run Lighthouse on production URL
Target Scores:
- Performance: >90
- Accessibility: >95
- Best Practices: >95
- SEO: >90
```

### CDN Configuration
- [ ] Static assets served from CDN
- [ ] Cache headers configured correctly
- [ ] Image CDN configured (if applicable)
- [ ] Font files cached appropriately

**Verify Cache Headers**:
```bash
curl -I https://theprize.io/assets/main.js
# Should see: Cache-Control: max-age=31536000
```

---

## 9. Monitoring & Alerting 📊

### Error Tracking
- [ ] Sentry (or alternative) configured
- [ ] Error reporting working
- [ ] Source maps uploaded for better stack traces
- [ ] Alert thresholds configured

**Test Error Tracking**:
```javascript
// Trigger test error
throw new Error('Test error for monitoring');
// Verify appears in Sentry dashboard
```

### Performance Monitoring
- [ ] Google Analytics configured and receiving data
- [ ] Custom events tracking:
  - User signup
  - Competition view
  - Entry purchase
  - Top-up initiated
  - Top-up completed
- [ ] Conversion funnels set up

**Verify Analytics**:
```
Google Analytics > Real-time > Overview
Visit site and verify events appear
```

### Uptime Monitoring
- [ ] Uptime monitoring service configured (UptimeRobot, Pingdom, etc.)
- [ ] Check every 5 minutes
- [ ] Alert on >2 consecutive failures
- [ ] Alert channels configured (email, SMS, Slack)

**Endpoints to Monitor**:
- https://theprize.io (homepage)
- https://theprize.io/api/health (if available)
- [SUPABASE_URL]/rest/v1/ (database health)

### Alert Channels
- [ ] Email alerts configured
- [ ] Slack/Discord webhook configured
- [ ] SMS alerts for critical issues (optional)
- [ ] Escalation path documented

---

## 10. Final Smoke Tests 🧪

### User Journey Tests

**Test 1: New User Registration & First Purchase**
- [ ] Visit homepage as new user
- [ ] Sign up with email or wallet
- [ ] Verify welcome email received
- [ ] Top up balance ($10)
- [ ] Verify 50% first deposit bonus applied
- [ ] Browse competitions
- [ ] Purchase entry for competition
- [ ] Verify entry appears in dashboard
- [ ] Check balance updated correctly

**Test 2: Existing User Entry Purchase**
- [ ] Login as existing user
- [ ] Check balance displays correctly
- [ ] Purchase additional competition entry
- [ ] Verify real-time balance update
- [ ] Check entry confirmation
- [ ] Verify purchase history

**Test 3: Competition Draw Flow**
- [ ] Create test competition (short duration)
- [ ] Purchase entries from multiple test users
- [ ] Wait for competition to end
- [ ] Verify VRF draw triggers automatically
- [ ] Confirm winner selected within 10 minutes
- [ ] Verify winner notification sent
- [ ] Check competition marked as completed
- [ ] Verify runner-up users see "lost" status

**Test 4: Payment Methods**
- [ ] Test Coinbase Commerce payment
- [ ] Test Base Account payment (if available)
- [ ] Verify each payment method credits correctly
- [ ] Check payment history shows correct method

**Test 5: Mobile Experience**
- [ ] Test on iPhone (Safari)
- [ ] Test on Android (Chrome)
- [ ] Verify responsive design works
- [ ] Check wallet connection on mobile
- [ ] Verify payment flow on mobile

### Browser Compatibility
- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Edge (latest)
- [ ] Mobile Safari (iOS 15+)
- [ ] Mobile Chrome (Android 11+)

### Load Testing
- [ ] Simulate 100 concurrent users
- [ ] Verify response times stay <2 seconds
- [ ] Check database connection pool doesn't saturate
- [ ] Monitor memory usage
- [ ] Verify no crashes or errors

**Simple Load Test**:
```bash
# Using Apache Bench
ab -n 1000 -c 100 https://theprize.io/

# Or using custom script
node scripts/load-test.js
```

---

## 11. Documentation Review 📚

- [ ] README.md updated with production info
- [ ] DEPLOYMENT_INSTRUCTIONS.md reviewed
- [ ] INCIDENT_RESPONSE_RUNBOOK.md accessible to team
- [ ] ADMIN_DASHBOARD_GUIDE.md reviewed by admins
- [ ] API documentation current
- [ ] Architecture diagrams updated

---

## 12. Team Preparation 👥

### Communication Plan
- [ ] Launch announcement prepared
- [ ] Social media posts scheduled
- [ ] Email blast to waitlist prepared
- [ ] Support team briefed on common issues
- [ ] FAQ page updated

### On-Call Schedule
- [ ] Primary on-call engineer assigned
- [ ] Backup on-call engineer assigned
- [ ] On-call contact information shared
- [ ] Escalation procedures documented

### Launch Day Schedule

**Tuesday Evening** (T-12 hours):
- [ ] Code freeze - no new changes
- [ ] Final database migration applied
- [ ] Final smoke tests completed
- [ ] Team standup - review checklist

**Wednesday 08:00** (T-1 hour):
- [ ] Final production checks
- [ ] Verify all monitoring working
- [ ] Team on standby

**Wednesday 09:00** (Launch):
- [ ] Deploy to production
- [ ] Verify deployment successful
- [ ] Run smoke tests on production
- [ ] Monitor error rates and performance

**Wednesday 09:30** (T+30 minutes):
- [ ] Verify all services operational
- [ ] Check first real user transactions
- [ ] Monitor VRF subscription balance

**Wednesday 10:00** (T+1 hour):
- [ ] Public announcement
- [ ] Enable social media promotion
- [ ] Monitor user feedback

---

## 13. Rollback Plan 🔄

In case of critical issues:

### Frontend Rollback
```bash
netlify rollback --site theprize-io
```

### Database Rollback
```bash
# Restore from pre-launch backup
supabase db restore backup-pre-launch-[TIMESTAMP].sql
```

### Rollback Triggers
Rollback if:
- Payment success rate <80% within first hour
- Site completely inaccessible for >5 minutes
- Critical security vulnerability discovered
- VRF system completely failing

---

## Sign-Off

### Checklist Completion
- [ ] All items checked by: _________________ Date: _________
- [ ] Technical review by: _________________ Date: _________
- [ ] Final approval by: _________________ Date: _________

### Launch Decision
- [ ] **GO** for launch ✅
- [ ] **NO GO** - Issues to resolve: ___________________________

**Launch approved by**: _________________  
**Date**: _________  
**Time**: _________

---

## Post-Launch Monitoring (First 24 Hours)

### Key Metrics to Watch
- [ ] User signups (target: >100)
- [ ] Payment success rate (target: >95%)
- [ ] Average page load time (target: <3s)
- [ ] Error rate (target: <1%)
- [ ] VRF draw success rate (target: 100%)

### Hour 1 Check-in
- [ ] No critical errors
- [ ] Payments processing successfully
- [ ] User feedback positive

### Hour 6 Check-in
- [ ] System stable
- [ ] Performance metrics within targets
- [ ] Support tickets manageable

### Hour 24 Check-in
- [ ] Post-launch retrospective scheduled
- [ ] Issues logged for follow-up
- [ ] Success metrics documented

---

**Emergency Contact**: [PHONE/SLACK]  
**Incident Response**: See INCIDENT_RESPONSE_RUNBOOK.md  
**Admin Guide**: See ADMIN_DASHBOARD_GUIDE.md
