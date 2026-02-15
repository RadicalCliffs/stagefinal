# Pre-Launch Testing and Verification Scripts

This directory contains automated scripts for pre-launch verification, testing, and monitoring setup.

## Overview

These scripts automate the critical pre-launch tasks outlined in the documentation:

1. **Pre-Launch Verification** - Automated checklist validation
2. **VRF Testing** - Real-world VRF system testing
3. **Sentry Setup** - Error tracking integration
4. **Load Testing** - Performance and scalability testing

---

## Scripts

### 1. Pre-Launch Verification (`pre-launch-verification.mjs`)

Automates verification of the 13-section pre-launch checklist.

**What it checks:**
- Environment variables configuration
- Database migrations and schema
- Security settings (RLS, CORS, API keys)
- Payment system configuration
- VRF system configuration
- Database performance
- Email system setup
- Monitoring configuration

**Usage:**
```bash
# Set environment variables first
export VITE_SUPABASE_URL=your_supabase_url
export VITE_SUPABASE_ANON_KEY=your_anon_key
# ... other environment variables

# Run verification
node scripts/pre-launch-verification.mjs --environment=staging

# Or for production
node scripts/pre-launch-verification.mjs --environment=production
```

**Output:**
- Console output with colored status indicators
- JSON results file in `test-results/`
- Exit code: 0 (success) or 1 (failure)

**Example output:**
```
=== Section 1: Environment Configuration ===
  ✓ VITE_SUPABASE_URL: https://xxx...
  ✓ VITE_CDP_PROJECT_ID: 71e24c24...
  ✗ VITE_TREASURY_ADDRESS: Missing

SUMMARY
Total checks: 45
Passed: 42
Failed: 3
Warnings: 5
Pass Rate: 93.3%

⚠️  MOSTLY READY - Address warnings before launch
```

---

### 2. VRF Real-World Testing (`vrf-testing.mjs`)

Automates VRF testing scenarios with real competitions and blockchain transactions.

**Scenarios:**
1. **Happy Path** - Automatic VRF draw end-to-end
2. **Manual Trigger** - Manual VRF trigger via admin dashboard
3. **Concurrent Draws** - Multiple competitions ending simultaneously
4. **Low LINK Balance** - Handling insufficient subscription balance (testnet)
5. **Network Congestion** - High gas price handling
6. **Callback Recovery** - VRF callback failure recovery

**Usage:**
```bash
# Set environment variables
export VITE_SUPABASE_URL=your_supabase_url
export SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Run a specific scenario
node scripts/vrf-testing.mjs --scenario=1 --auto-cleanup

# Scenarios:
# 1 = Happy Path (recommended first test)
# 2 = Manual Trigger
# 3 = Concurrent Draws
```

**Important Notes:**
- Uses real blockchain transactions
- Creates test competitions that end quickly (1 minute)
- Creates test users and entries
- Monitors VRF draw process in real-time
- Verifies winner selection
- Auto-cleanup removes test data when complete

**Time Required:**
- Scenario 1: ~2-3 minutes (1 min competition + monitoring)
- Scenario 2: ~2-3 minutes + manual trigger
- Scenario 3: ~2-3 minutes (3 concurrent competitions)

**Example output:**
```
═══ Scenario 1: Happy Path - Automatic VRF Draw ═══
✓ Supabase client initialized
Creating 3 test users...
  ✓ Created test user 1: test-user-xxx-1
Creating test competition: VRF Test - Happy Path
  ✓ Competition created: abc-123
  End time: 2026-02-15T17:35:00Z
Adding test entries...
  ✓ Added 3 tickets for user 1
Waiting for competition to end (1 minute)...
Monitoring competition abc-123...
  Status: ended, VRF: pending
  Status: ended, VRF: fulfilled
✓ Competition completed! Winner: test-user-xxx-2
  VRF Request ID: 12345
  VRF TX Hash: 0xabc...
✓ Winner verification passed

✅ SCENARIO 1 PASSED
Duration: 2.3 minutes
```

---

### 3. Sentry Integration Setup (`setup-sentry.mjs`)

Automates Sentry error tracking integration.

**What it does:**
- Creates Sentry configuration file
- Updates main.tsx with initialization
- Creates error boundary components
- Adds environment variables to .env.example
- Provides usage examples

**Usage:**
```bash
# Get your Sentry DSN from https://sentry.io
# Settings > Projects > [Your Project] > Client Keys (DSN)

node scripts/setup-sentry.mjs --dsn=https://xxx@xxx.ingest.sentry.io/xxx
```

**Creates:**
- `src/lib/sentry.ts` - Sentry configuration
- `src/components/ErrorBoundary.tsx` - React error boundary
- Updates to `src/main.tsx` and `.env.example`

**After running:**
```bash
# Install Sentry package
npm install @sentry/react

# Add to .env.production
VITE_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
VITE_APP_VERSION=1.0.0

# Test error tracking
# In your app, throw an error: throw new Error('test');
# Check Sentry dashboard for the error
```

**Features:**
- Error filtering (browser extensions, MetaMask)
- Session replay for debugging
- Performance monitoring
- User context tracking
- Breadcrumb logging
- Environment-aware (dev vs prod)

---

### 4. Load Testing (`load-testing.mjs`)

Simulates concurrent users to test performance under load.

**What it does:**
- Simulates realistic user behavior
- Gradual ramp-up of concurrent users
- Random endpoint selection with weights
- Measures response times and success rates
- Identifies performance bottlenecks

**Usage:**
```bash
# Basic usage (defaults)
node scripts/load-testing.mjs --url=https://theprize.io

# Custom configuration
node scripts/load-testing.mjs \
  --url=https://staging.theprize.io \
  --users=200 \
  --duration=120 \
  --rampUp=20

# Options:
#   --url: Base URL to test (default: http://localhost:5173)
#   --users: Number of concurrent users (default: 100)
#   --duration: Test duration in seconds (default: 60)
#   --rampUp: Ramp-up time in seconds (default: 10)
```

**Tested Endpoints:**
- `/` (Homepage) - 30% of requests
- `/competitions` (Competitions list) - 25%
- `/dashboard` (User dashboard) - 20%
- `/how-to-play` (Info pages) - 15%
- `/faq` (FAQ) - 10%

**Performance Criteria:**
- ✅ Success rate ≥95%
- ✅ Average response time <2s
- ✅ P95 response time <5s

**Example output:**
```
╔════════════════════════════════════════════╗
║          LOAD TESTING SCRIPT              ║
╚════════════════════════════════════════════╝

Configuration:
  Base URL: https://theprize.io
  Concurrent Users: 100
  Test Duration: 60s
  Ramp-up Time: 10s

✓ URL accessible
Starting load test...
  Ramping up... 10/100 users
  ...
✓ All 100 users started
Running test for 60 seconds...

╔════════════════════════════════════════════╗
║          TEST RESULTS                      ║
╚════════════════════════════════════════════╝

Requests:
  Total: 2847
  Successful: 2821 (99.1%)
  Failed: 26
  Requests/sec: 47.45

Response Times (ms):
  Min: 145
  Max: 4521
  Avg: 892
  P50 (median): 765
  P95: 1843
  P99: 2956

Performance Assessment:
  Success rate ≥95%: ✓
  Avg response time <2s: ✓
  P95 response time <5s: ✓

✅ LOAD TEST PASSED
```

---

## Prerequisites

### All Scripts
```bash
# Install Node.js dependencies
npm install

# Ensure Node.js 18+ is installed
node --version
```

### Pre-Launch Verification
```bash
# Required environment variables
export VITE_SUPABASE_URL=your_url
export VITE_SUPABASE_ANON_KEY=your_key
# ... all other env vars from .env.example
```

### VRF Testing
```bash
# Required environment variables
export VITE_SUPABASE_URL=your_url
export SUPABASE_SERVICE_ROLE_KEY=your_service_role_key  # For admin operations

# VRF subscription must have LINK tokens
# Check: https://vrf.chain.link/base/[SUBSCRIPTION_ID]
```

### Load Testing
```bash
# Server must be running
npm run dev  # For local testing
# Or test against deployed environment
```

---

## Test Results

All scripts save detailed results to `test-results/` directory:

```
test-results/
├── pre-launch-staging-1708019123456.json
├── pre-launch-production-1708019234567.json
├── vrf-test-1-1708019345678.json
├── load-test-1708019456789.json
└── ...
```

Results include:
- Timestamp
- Configuration used
- All check/test details
- Pass/fail status
- Duration
- Errors and warnings

---

## CI/CD Integration

These scripts can be integrated into CI/CD pipelines:

**GitHub Actions Example:**
```yaml
name: Pre-Launch Verification

on:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - run: npm install
      
      - name: Run Pre-Launch Verification
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
        run: node scripts/pre-launch-verification.mjs --environment=staging
      
      - name: Upload Results
        uses: actions/upload-artifact@v3
        with:
          name: verification-results
          path: test-results/
```

---

## Troubleshooting

### "Missing Supabase credentials"
Set environment variables:
```bash
export VITE_SUPABASE_URL=your_url
export VITE_SUPABASE_ANON_KEY=your_key
```

### "URL not accessible" (Load Testing)
Ensure the server is running:
```bash
npm run dev
```

### VRF Testing Timeout
- Check VRF subscription has sufficient LINK (>1 LINK)
- Verify network is not congested
- Check VRF Edge Functions are deployed
- Visit admin dashboard to manually trigger

### Permission Errors
For VRF testing, use service role key:
```bash
export SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

---

## Best Practices

### Before Running Tests

1. **Backup Production Data**
   ```bash
   supabase db dump -f backup-pre-test.sql
   ```

2. **Use Staging First**
   Always test on staging environment before production

3. **Review Test Plans**
   Read the full testing guides in `/docs`:
   - `PRE_LAUNCH_CHECKLIST.md`
   - `VRF_TESTING_GUIDE.md`

### During Testing

1. **Monitor Resources**
   - Watch database connections
   - Monitor API rate limits
   - Check VRF subscription balance

2. **Document Results**
   - Save test result files
   - Note any anomalies
   - Record manual interventions

### After Testing

1. **Review Results**
   - Check all test result JSON files
   - Address any failures or warnings
   - Document issues found

2. **Cleanup**
   - Remove test data if not auto-cleaned
   - Reset any modified configurations
   - Update documentation with findings

---

## Support

For issues or questions:
- Check `/docs/INCIDENT_RESPONSE_RUNBOOK.md`
- Check `/docs/VRF_TESTING_GUIDE.md`
- Review test result files in `test-results/`

---

## Script Development

To add new checks or tests:

1. Follow existing script patterns
2. Use colored console output
3. Save detailed results to JSON
4. Provide clear error messages
5. Exit with appropriate codes (0=success, 1=failure)
6. Update this README

---

**Last Updated**: 2026-02-15  
**Scripts Version**: 1.0.0
