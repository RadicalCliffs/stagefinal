# Manual Entry Reservation for Free Entry Protocol

## Overview

This document outlines how to manually reserve entries in the system for the free entry protocol (e.g., claim tickets in Superpass).

## Database Tables

### pending_tickets

The `pending_tickets` table is used to reserve tickets before payment confirmation:

```sql
-- Structure
CREATE TABLE pending_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES competitions(id),
  canonical_user_id TEXT NOT NULL,
  wallet_address TEXT,
  ticket_numbers TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  expires_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

## Manual Reservation Process

### Option 1: Via Supabase Dashboard

1. Go to Supabase Dashboard → Table Editor → `pending_tickets`
2. Click "Insert Row"
3. Fill in the required fields:
   - `competition_id`: UUID of the competition
   - `canonical_user_id`: User's canonical ID (format: `prize:pid:0x...`)
   - `wallet_address`: User's wallet address (0x...)
   - `ticket_numbers`: Comma-separated ticket numbers (e.g., "1,2,3")
   - `status`: Set to `"confirmed"` for immediate activation
   - `confirmed_at`: Set to current timestamp
4. Click "Save"

### Option 2: Via SQL Query

```sql
-- Reserve tickets for free entry
INSERT INTO pending_tickets (
  competition_id,
  canonical_user_id,
  wallet_address,
  ticket_numbers,
  status,
  confirmed_at
) VALUES (
  'competition-uuid-here',
  'prize:pid:0xUSER_ADDRESS',
  '0xUSER_ADDRESS',
  '1,2,3,4,5', -- Comma-separated ticket numbers
  'confirmed',
  NOW()
);

-- Trigger the confirmation process
-- This will create entries in joincompetition and tickets tables
SELECT * FROM confirm_pending_tickets('pending-ticket-uuid-here');
```

### Option 3: Via Netlify Function

Use the `confirm-pending-tickets` API endpoint:

```bash
curl -X POST https://your-site.netlify.app/api/confirm-pending-tickets \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -d '{
    "reservationId": "pending-ticket-uuid",
    "competitionId": "competition-uuid"
  }'
```

## Free Entry Workflow

### For Superpass / Social Media Claims

1. **User claims free entry** via Superpass or social media
2. **Admin verifies claim** (manual or automated)
3. **Admin reserves tickets**:
   ```sql
   INSERT INTO pending_tickets (
     competition_id,
     canonical_user_id,
     wallet_address,
     ticket_numbers,
     status,
     confirmed_at,
     metadata
   ) VALUES (
     'comp-uuid',
     'prize:pid:0xUSER_WALLET',
     '0xUSER_WALLET',
     '101,102,103', -- Tickets from free entry pool
     'confirmed',
     NOW(),
     '{"source": "superpass_claim", "claim_id": "claim-123"}'
   );
   ```
4. **System automatically creates entries** via database trigger
5. **User sees tickets** in their dashboard

## Ticket Number Assignment

### Reserved Ticket Ranges

To prevent conflicts with purchased tickets, reserve specific ticket number ranges for free entries:

```sql
-- Example: Reserve tickets 10000+ for free entries
-- Competition with 1000 total tickets
-- Tickets 1-9000: Available for purchase
-- Tickets 10000-10999: Reserved for free entries

INSERT INTO pending_tickets (
  competition_id,
  canonical_user_id,
  wallet_address,
  ticket_numbers,
  status,
  confirmed_at
)
SELECT
  'comp-uuid'::UUID,
  'prize:pid:0xUSER',
  '0xUSER',
  string_agg(n::text, ','), -- Convert series to comma-separated string
  'confirmed',
  NOW()
FROM generate_series(10000, 10002) AS n;
```

## Verification

After reserving entries, verify they appear correctly:

```sql
-- Check pending_tickets
SELECT * FROM pending_tickets 
WHERE canonical_user_id = 'prize:pid:0xUSER';

-- Check joincompetition
SELECT * FROM joincompetition 
WHERE canonical_user_id = 'prize:pid:0xUSER'
  AND competitionid = 'comp-uuid';

-- Check tickets
SELECT * FROM tickets 
WHERE canonical_user_id = 'prize:pid:0xUSER'
  AND competition_id = 'comp-uuid';
```

## Bulk Free Entry Import

For bulk operations (e.g., importing 100 Superpass claims):

```sql
-- Create a temporary table with claims
CREATE TEMP TABLE superpass_claims (
  user_wallet TEXT,
  claim_id TEXT,
  num_tickets INTEGER
);

-- Import claims (CSV or direct insert)
COPY superpass_claims FROM '/path/to/claims.csv' WITH CSV HEADER;

-- Generate pending_tickets for all claims
INSERT INTO pending_tickets (
  competition_id,
  canonical_user_id,
  wallet_address,
  ticket_numbers,
  status,
  confirmed_at,
  metadata
)
SELECT
  'comp-uuid'::UUID,
  'prize:pid:' || user_wallet,
  user_wallet,
  string_agg((10000 + ROW_NUMBER() OVER ())::text, ','),
  'confirmed',
  NOW(),
  json_build_object('source', 'superpass_claim', 'claim_id', claim_id)
FROM superpass_claims
GROUP BY user_wallet, claim_id;
```

## Important Notes

1. **Ticket Number Conflicts**: Always use a reserved range (e.g., 10000+) to avoid conflicts with purchased tickets
2. **Competition Capacity**: Ensure free entries don't exceed `total_tickets` limit
3. **Canonical User ID**: Must match the format `prize:pid:0xWALLET_ADDRESS`
4. **Status**: Set to `"confirmed"` for immediate activation, `"pending"` to require manual confirmation
5. **Metadata**: Use the metadata field to track the source of free entries for auditing

## Troubleshooting

### Entries Not Appearing

1. Check `pending_tickets` status:
   ```sql
   SELECT * FROM pending_tickets WHERE id = 'uuid';
   ```

2. Verify trigger execution:
   ```sql
   SELECT * FROM pg_stat_user_triggers 
   WHERE schemaname = 'public' 
     AND relname = 'pending_tickets';
   ```

3. Check for errors in logs:
   ```sql
   SELECT * FROM error_logs 
   WHERE context LIKE '%pending_tickets%' 
   ORDER BY created_at DESC;
   ```

### Duplicate Tickets

If tickets are being assigned twice:

1. Check for duplicate `pending_tickets` records
2. Verify ticket numbers aren't in the purchase range
3. Review `tickets` table for duplicates:
   ```sql
   SELECT ticket_number, COUNT(*) 
   FROM tickets 
   WHERE competition_id = 'comp-uuid'
   GROUP BY ticket_number 
   HAVING COUNT(*) > 1;
   ```
