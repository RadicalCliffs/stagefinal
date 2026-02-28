# VRF (Verifiable Random Function) Implementation Guide

## Overview

The Prize.io platform uses Chainlink VRF (Verifiable Random Function) on Base blockchain for provably fair winner selection. This document explains how VRF works, how transaction hashes are stored and displayed, and how to verify the implementation.

## Architecture

### VRF Flow

```
1. Competition Created
   ↓
   - Assigned onchain_competition_id
   - Stored in Base blockchain VRF contract

2. Competition Ends / Sold Out
   ↓
   - vrf_draw_requested_at timestamp set
   - VRF request sent to Chainlink

3. Chainlink VRF Callback
   ↓
   - Random number generated on-chain
   - Transaction hash recorded (vrf_tx_hash)
   - Winner selected from participants
   - Webhook called: chainlink-vrf-webhook

4. Winner Stored
   ↓
   - competitions.winner_address updated
   - competitions.vrf_tx_hash stored
   - competitions.vrf_status = 'completed'
   - Winner record created

5. Sync from Blockchain (Optional)
   ↓
   - vrf-sync-results function reads on-chain data
   - Verifies winners match blockchain state
   - Updates any missing data
```

## Database Schema

### Competitions Table VRF Fields

```sql
-- Standard field for all VRF transaction hashes
vrf_tx_hash TEXT

-- Legacy fields (kept for backwards compatibility)
rng_tx_hash TEXT
vrf_pregenerated_tx_hash TEXT

-- VRF tracking fields
vrf_status TEXT -- 'pending', 'processing', 'completed', 'failed'
vrf_request_id TEXT -- Chainlink VRF request ID
vrf_draw_requested_at TIMESTAMPTZ
vrf_draw_completed_at TIMESTAMPTZ
onchain_competition_id BIGINT -- ID in VRF contract

-- Winner data
winner_address TEXT
winning_ticket_id TEXT
draw_date TIMESTAMPTZ
```

### Competition Winners Table

```sql
competition_id UUID
wallet_address TEXT
ticket_number INTEGER
vrf_tx_hash TEXT -- Links to competition's VRF transaction
prize_value NUMERIC
prize_claimed BOOLEAN
```

## Field Standardization (Feb 2026)

### Problem
Multiple inconsistent field names were causing UI display issues:
- `vrf_pregenerated_tx_hash`
- `rng_tx_hash`
- `vrf_tx_hash`
- Various fields in winners table

### Solution
- **Primary field**: `vrf_tx_hash` in all tables
- **Migration**: Copies data from legacy fields
- **Functions updated**: Webhook and sync functions now populate `vrf_tx_hash`
- **UI updated**: Reads from standardized `vrf_tx_hash` field

## Smart Contract

**Address**: `0x8ce54644e3313934D663c43Aea29641DFD8BcA1A` (Base Mainnet)

**Key Functions**:
- `getCompetition(uint256)` - Get competition state
- `getWinners(uint256)` - Get winning ticket numbers and addresses
- `drawWinner(uint256)` - Trigger VRF draw

## Edge Functions

### chainlink-vrf-webhook

**Purpose**: Receives Chainlink VRF callbacks with random numbers

**Triggered by**: Chainlink VRF v2.5 when randomness is fulfilled

**Updates**:
```javascript
competitions.update({
  winner_address,
  winning_ticket_id,
  status: 'completed',
  rng_tx_hash: txHash,
  vrf_tx_hash: txHash,        // ← Standardized field
  vrf_status: 'completed',
  vrf_draw_completed_at: now
})
```

### vrf-sync-results

**Purpose**: Syncs winner data from blockchain to database

**Usage**: 
```bash
# Sync all pending competitions
npm run vrf:sync

# Sync specific competition
npm run vrf:sync -- --competition-id=abc-123
```

**What it does**:
1. Queries VRF contract for drawn competitions
2. Reads winning ticket numbers and addresses
3. Matches wallet addresses to users
4. Creates winner records
5. Updates competition status

## Verification & Testing

### Verify VRF Hashes

Check that all completed competitions have transaction hashes:

```bash
npm run vrf:verify
```

**Output**:
- Field existence check
- Statistics on TX hash coverage
- List of competitions missing data
- Winners table verification
- View functionality test

### Test VRF Call

Check specific competition or test sync:

```bash
# Check specific competition
npm run vrf:test -- --competition-id=abc-123

# Test blockchain sync
npm run vrf:test -- --test-sync

# Show recent competitions
npm run vrf:test
```

## Migration

### Applying the Migration

**Option 1: Supabase CLI**
```bash
cd supabase
supabase db push
```

**Option 2: SQL Editor**
1. Open Supabase Dashboard
2. Go to SQL Editor
3. Run: `supabase/migrations/20260228_standardize_vrf_fields.sql`

### What the Migration Does

1. **Adds vrf_tx_hash column** to competitions table
2. **Migrates existing data** from rng_tx_hash and vrf_pregenerated_tx_hash
3. **Adds VRF tracking fields** (status, request_id, timestamps)
4. **Ensures onchain_competition_id** exists
5. **Standardizes competition_winners.vrf_tx_hash**
6. **Creates indexes** for performance
7. **Creates vrf_competition_status view** for monitoring

## UI Display

### Where VRF TX Hashes Appear

1. **Finished Competition Page** (`/competition/:uid`)
   - Winner details section
   - VRF verification card
   - Link to Base Explorer

2. **User Dashboard - Entries** (`/account/entries`)
   - Winning entries show VRF link
   - "View VRF Draw on Blockchain →"

3. **Recent Winners Widget** (Landing page)
   - Shows winners with VRF verification links

### Code Locations

**WinnerDetails.tsx**:
```typescript
const txHash = compData?.vrf_tx_hash || 
                compData?.rng_tx_hash || 
                compData?.vrf_pregenerated_tx_hash;

// Display link
<a href={`https://basescan.org/tx/${txHash}`}>
  View VRF Transaction →
</a>
```

**EntriesWinnerSection.tsx**:
```typescript
{vrfTxHash && (
  <a href={vrfExplorerLink}>
    View VRF Draw on Blockchain →
  </a>
)}
```

## Monitoring

### VRF Competition Status View

Query the view for easy monitoring:

```sql
SELECT * FROM vrf_competition_status
WHERE status = 'drawn'
  AND vrf_tx_hash IS NULL;
```

**View columns**:
- `id`, `uid`, `title`, `status`
- `onchain_competition_id`
- `vrf_status`, `vrf_request_id`
- `vrf_tx_hash`, `rng_tx_hash`, `vrf_pregenerated_tx_hash`
- `tx_hash_status` - Indicates which field has data
- `effective_tx_hash` - Coalesced TX hash from all sources

### Common Queries

**Find competitions without VRF TX hashes**:
```sql
SELECT id, title, status, vrf_status
FROM competitions
WHERE status IN ('completed', 'drawn')
  AND vrf_tx_hash IS NULL
  AND winner_address IS NOT NULL;
```

**Check webhook processing**:
```sql
SELECT * FROM rng_triggers
WHERE vrf_status = 'pending'
ORDER BY created_at DESC
LIMIT 10;
```

## Troubleshooting

### Competition missing VRF TX hash

**Symptoms**: Completed competition, winner exists, but no vrf_tx_hash

**Causes**:
1. Draw happened before standardization (Feb 2026)
2. Webhook didn't fire or failed
3. Migration not applied

**Solutions**:
1. Apply migration - will copy from rng_tx_hash
2. Check rng_triggers table for request
3. Manually update from webhook logs

### Winner selected but TX hash not recorded

**Cause**: Webhook received random number but TX hash was null

**Solution**: 
1. Check Chainlink VRF dashboard for request
2. Look up transaction on Base Explorer
3. Manually update:
```sql
UPDATE competitions
SET vrf_tx_hash = '0x...'
WHERE id = 'competition-id';
```

### VRF sync not finding winners

**Cause**: Competition not drawn on-chain yet

**Check**:
```javascript
// Query contract
const competition = await vrfContract.getCompetition(onchainId);
console.log('Drawn:', competition.drawn);
```

**Solution**: Wait for VRF callback or trigger draw manually

## Best Practices

1. **Always check vrf_tx_hash first** in UI code
2. **Fallback to legacy fields** for backwards compatibility
3. **Log webhook failures** for debugging
4. **Monitor vrf_competition_status view** regularly
5. **Run verification script** after major deployments
6. **Test VRF flow** in staging before production changes

## Security

- **VRF Request ID**: Unique, prevents replay attacks
- **Subscription Verification**: Only accepts callbacks from registered subscription
- **On-chain Verification**: Anyone can verify randomness using TX hash
- **Immutable**: Once drawn on-chain, results cannot be changed
- **Transparent**: All VRF transactions are publicly viewable

## Support

### Useful Links

- **VRF Contract**: https://basescan.org/address/0x8ce54644e3313934D663c43Aea29641DFD8BcA1A
- **Chainlink VRF Docs**: https://docs.chain.link/vrf/v2-5/overview
- **Base Explorer**: https://basescan.org

### Scripts

- `npm run vrf:verify` - Verify VRF implementation
- `npm run vrf:test` - Test VRF calls
- `npm run vrf:sync` - Sync from blockchain

### Logs

Check edge function logs in Supabase Dashboard:
1. Edge Functions → chainlink-vrf-webhook
2. View invocation history
3. Check for errors or failed callbacks
