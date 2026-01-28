# Schema Compliance Audit - Complete Fix Summary

## Overview
This document summarizes all schema mismatches found and fixed to ensure the codebase uses the **exact** table and column nomenclature from the database schema.

## Critical Issues Fixed

### 1. pending_tickets / pending_ticket_items Mismatch

**Problem:**
- Code assumed `pending_tickets.ticket_numbers` (array) column existed
- This column does NOT exist in the schema

**Actual Schema:**
```sql
-- pending_tickets: Reservation metadata
CREATE TABLE pending_tickets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  competition_id TEXT NOT NULL,
  ticket_count INTEGER NOT NULL,
  total_amount NUMERIC(10, 2) NOT NULL,
  status TEXT DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- pending_ticket_items: Individual reserved tickets
CREATE TABLE pending_ticket_items (
  id TEXT PRIMARY KEY,
  pending_ticket_id TEXT NOT NULL,
  competition_id TEXT NOT NULL,
  ticket_number INTEGER NOT NULL,  -- SINGULAR, not array!
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Fix Applied:**
- Updated `omnipotent-data-service.ts` to query `pending_ticket_items` with JOIN to `pending_tickets`
- Created migration `20260128082000_fix_get_unavailable_tickets_schema.sql`
- Fixed RPC function `get_unavailable_tickets()` to query correct tables

**Files Changed:**
- `src/lib/omnipotent-data-service.ts` (lines 506-545)
- `src/lib/database.ts` (line 1415 comment)
- `supabase/migrations/20260128082000_fix_get_unavailable_tickets_schema.sql` (new)

---

### 2. joincompetition Column Name Mismatches

**Problem:**
- Code queried `wallet_address` column - doesn't exist
- Code ordered by `purchasedate` column - doesn't exist
- Code accessed `jc.walletaddress`, `jc.numberoftickets`, `jc.amountspent`, `jc.purchasedate` - none exist

**Actual Schema:**
```sql
CREATE TABLE joincompetition (
  id TEXT PRIMARY KEY,
  userid TEXT NOT NULL,           -- NOT wallet_address!
  competitionid TEXT NOT NULL,
  ticketnumbers INTEGER[],        -- Can calculate count from this
  joinedat TIMESTAMPTZ,           -- NOT purchasedate!
  created_at TIMESTAMPTZ
);
```

**Fix Applied:**
- Query changes:
  - `.ilike('wallet_address', ...)` → `.ilike('userid', ...)`
  - `.order('purchasedate', ...)` → `.order('joinedat', ...)`
- Transformation function changes:
  - `jc.wallet_address` → `jc.userid`
  - `jc.purchasedate` → `jc.joinedat`
  - `jc.numberoftickets` → Calculate from `jc.ticketnumbers.length`
  - `jc.amountspent` → Calculate from `competition.ticket_price * ticketCount`

**Files Changed:**
- `src/lib/database.ts` (lines 2012-2013, 2085, 103-132)

---

### 3. RPC Function Schema Compliance

**Problem:**
- Original RPC function only checked `tickets_sold` table
- Updated RPC tried to query `pending_tickets.ticket_numbers` (doesn't exist)

**Fix Applied:**
Created comprehensive RPC function that:
1. Queries `joincompetition.ticketnumbers` (TEXT/INTEGER[] with proper casting)
2. Queries `tickets.ticket_number` (INTEGER)
3. Queries `pending_ticket_items.ticket_number` with JOIN to `pending_tickets` for validation

**Schema-Compliant RPC:**
```sql
-- Get pending tickets from pending_ticket_items (NOT pending_tickets!)
SELECT COALESCE(array_agg(DISTINCT pti.ticket_number), ARRAY[]::INTEGER[])
INTO v_pending
FROM pending_ticket_items pti
INNER JOIN pending_tickets pt ON pti.pending_ticket_id = pt.id
WHERE pti.competition_id = competition_id
  AND pt.status IN ('pending', 'confirming')
  AND pt.expires_at > NOW()
  AND pti.ticket_number IS NOT NULL;
```

---

## Type Casting for Frontend

All database types are properly cast to JavaScript/TypeScript types:

| Database Type | JavaScript Type | Casting |
|---------------|-----------------|---------|
| INTEGER | number | Automatic |
| INTEGER[] | number[] | Handled by Supabase |
| TEXT | string | Automatic |
| NUMERIC(20,6) | number | Parsed as float |
| TIMESTAMPTZ | string/Date | ISO string conversion |
| BOOLEAN | boolean | Automatic |
| JSONB | object/array | JSON.parse automatic |

---

## Schema Reference: All Relevant Tables

### tickets
```sql
id TEXT, competition_id TEXT, ticket_number INTEGER, 
user_id TEXT, canonical_user_id TEXT, wallet_address TEXT,
status TEXT, purchase_price NUMERIC, purchased_at TIMESTAMPTZ,
transaction_hash TEXT, is_winner BOOLEAN, prize_tier TEXT, created_at TIMESTAMPTZ
```

### pending_tickets
```sql
id TEXT, user_id TEXT, competition_id TEXT, ticket_count INTEGER,
total_amount NUMERIC, status TEXT, expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ
```

### pending_ticket_items
```sql
id TEXT, pending_ticket_id TEXT, competition_id TEXT,
ticket_number INTEGER, created_at TIMESTAMPTZ
```

### joincompetition
```sql
id TEXT, userid TEXT, competitionid TEXT, ticketnumbers INTEGER[],
joinedat TIMESTAMPTZ, created_at TIMESTAMPTZ
```

### canonical_users
```sql
id TEXT, canonical_user_id TEXT, uid TEXT, privy_user_id TEXT,
email TEXT, wallet_address TEXT, base_wallet_address TEXT, eth_wallet_address TEXT,
username TEXT, avatar_url TEXT, usdc_balance NUMERIC, bonus_balance NUMERIC,
has_used_new_user_bonus BOOLEAN, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
smart_wallet_address TEXT, country TEXT, first_name TEXT, last_name TEXT,
telegram_handle TEXT, is_admin BOOLEAN, auth_provider TEXT, wallet_linked TEXT,
linked_wallets JSONB, primary_wallet_address TEXT
```

### user_transactions
```sql
id TEXT, user_id TEXT, canonical_user_id TEXT, type TEXT,
amount NUMERIC, currency TEXT, status TEXT, competition_id TEXT,
ticket_count INTEGER, ticket_numbers TEXT, transaction_hash TEXT,
payment_method TEXT, metadata JSONB, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
payment_provider TEXT, payment_status TEXT
```

### balance_ledger
```sql
id TEXT, canonical_user_id TEXT, transaction_type TEXT,
amount NUMERIC, currency TEXT, balance_before NUMERIC, balance_after NUMERIC,
reference_id TEXT, description TEXT, created_at TIMESTAMPTZ,
source TEXT, metadata JSONB, transaction_id TEXT
```

---

## Verification Checklist

- [x] pending_tickets: Uses correct columns (no ticket_numbers!)
- [x] pending_ticket_items: Queries ticket_number (singular) with JOIN
- [x] joincompetition: Uses userid and joinedat (not wallet_address, purchasedate)
- [x] tickets: Uses competition_id and ticket_number correctly
- [x] RPC function queries all correct tables with proper JOINs
- [x] Type casting handled correctly for frontend
- [x] TypeScript compilation passes
- [x] CodeQL security scan passes (0 alerts)
- [x] Comments updated to reflect correct schema

---

## Migration Required

The database migration file created must be applied to production:
- **File**: `supabase/migrations/20260128082000_fix_get_unavailable_tickets_schema.sql`
- **Action**: Recreates `get_unavailable_tickets()` RPC with correct schema
- **Impact**: Fixes ticket availability queries to include pending reservations

---

## Summary

All code now uses the **exact** table and column names from the database schema. No assumptions or incorrect column references remain. The omnipotent data service handles all ticket availability queries with proper caching and schema compliance.
