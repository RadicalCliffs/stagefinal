# Critical RPC Functions for Balance Payments - Apply to Supabase

**Date:** January 20, 2026  
**Issue:** Missing critical RPCs for sub_account_balance credit/debit and entry creation  
**Status:** Ready to apply to Supabase

---

## Summary

The PAYMENT_DATABASE_SCHEMA.md was implemented on Supabase, but several critical RPC functions were missing or incomplete. This document lists all the functions you need to manually implement in Supabase.

## What Was Missing

1. **Top-ups not directly crediting sub_account_balance** - The `credit_sub_account_balance` RPC exists but doesn't create balance_ledger audit entries
2. **Balance payments not surfacing entries on dashboard** - The `debit_sub_account_balance` RPC exists but doesn't create entries or ledger tracking
3. **User entries not showing as competition cards** - Need atomic function to debit balance AND create entry in one transaction

## Functions to Apply

### 1. `credit_sub_account_balance` - For Top-Ups

**Purpose:** Credits user's sub_account_balance and creates balance_ledger audit entry

**Signature:**
```sql
credit_sub_account_balance(
  p_canonical_user_id TEXT,
  p_amount NUMERIC,
  p_currency TEXT DEFAULT 'USD',
  p_reference_id TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, previous_balance NUMERIC, new_balance NUMERIC, error_message TEXT)
```

**What it does:**
- Finds or creates user's sub_account_balances record
- Credits the available_balance
- Creates balance_ledger entry with transaction_type='credit', balance_before, balance_after
- Returns success status and new balance

**Usage example:**
```sql
SELECT * FROM credit_sub_account_balance(
  'prize:pid:0x1234...',
  100.00,
  'USD',
  'txn_123',
  'Coinbase top-up'
);
-- Returns: {success: true, previous_balance: 50, new_balance: 150, error_message: null}
```

---

### 2. `debit_sub_account_balance` - For Purchases

**Purpose:** Debits user's sub_account_balance and creates balance_ledger audit entry

**Signature:**
```sql
debit_sub_account_balance(
  p_canonical_user_id TEXT,
  p_amount NUMERIC,
  p_currency TEXT DEFAULT 'USD',
  p_reference_id TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, previous_balance NUMERIC, new_balance NUMERIC, error_message TEXT)
```

**What it does:**
- Locks user's sub_account_balances record (FOR UPDATE)
- Checks sufficient balance
- Debits the available_balance
- Creates balance_ledger entry with transaction_type='debit', balance_before, balance_after (negative amount)
- Returns success status and new balance

**Usage example:**
```sql
SELECT * FROM debit_sub_account_balance(
  'prize:pid:0x1234...',
  25.00,
  'USD',
  'purchase_456',
  'Ticket purchase'
);
-- Returns: {success: true, previous_balance: 150, new_balance: 125, error_message: null}
-- If insufficient: {success: false, previous_balance: 10, new_balance: 10, error_message: 'Insufficient balance...'}
```

---

### 3. `debit_sub_account_balance_with_entry` - For Competition Ticket Purchases ⭐ NEW

**Purpose:** Atomically debits balance AND creates competition entry (critical missing function)

**Signature:**
```sql
debit_sub_account_balance_with_entry(
  p_canonical_user_id TEXT,
  p_competition_id UUID,
  p_amount NUMERIC,
  p_ticket_count INTEGER,
  p_ticket_numbers TEXT DEFAULT '',
  p_transaction_id TEXT DEFAULT NULL
)
RETURNS JSONB
```

**What it does:**
1. Calls `debit_sub_account_balance` to debit user's balance (with ledger entry)
2. If successful, creates entry in `joincompetition` table with:
   - uid (generated UUID)
   - competitionid
   - userid and canonical_user_id
   - numberoftickets, ticketnumbers
   - amountspent
   - chain='balance' (payment method)
   - transactionhash (transaction_id or entry uid)
3. Returns JSONB with success status, balance details, and entry_uid

**Usage example:**
```sql
SELECT * FROM debit_sub_account_balance_with_entry(
  'prize:pid:0x1234...',
  'uuid-of-competition',
  25.00,
  5,
  '1,5,10,42,99',
  'txn_789'
);

-- Success: 
-- {
--   "success": true,
--   "entry_uid": "generated-uuid",
--   "previous_balance": 125,
--   "new_balance": 100,
--   "amount_debited": 25.00,
--   "ticket_count": 5,
--   "competition_id": "uuid-of-competition"
-- }

-- Failure (insufficient balance):
-- {
--   "success": false,
--   "error": "Insufficient balance. Have: 10, Need: 25",
--   "previous_balance": 10
-- }
```

**Why this is critical:**
- This is the missing link! Without this, balance payments create transactions but NO dashboard entries
- It's atomic - if balance debit fails, entry is NOT created (maintains consistency)
- Creates proper joincompetition entries that show up on user dashboard

---

### 4. `get_user_competition_entries` - For Dashboard Display

**Purpose:** Gets all competition entries for a user (simpler than get_comprehensive_user_dashboard_entries)

**Signature:**
```sql
get_user_competition_entries(p_user_identifier TEXT)
RETURNS TABLE (
  entry_id TEXT,
  competition_id TEXT,
  competition_title TEXT,
  ticket_count INTEGER,
  ticket_numbers TEXT,
  amount_spent NUMERIC,
  purchase_date TIMESTAMPTZ,
  payment_method TEXT,
  transaction_hash TEXT,
  is_winner BOOLEAN
)
```

**What it does:**
- Resolves user from canonical_users table (handles all identifier formats)
- Queries joincompetition table for all user entries
- Joins with competitions table for title and winner status
- Returns entries ordered by purchase_date DESC

**Usage example:**
```sql
SELECT * FROM get_user_competition_entries('prize:pid:0x1234...');

-- Returns all entries:
-- [
--   {
--     entry_id: 'uuid-1',
--     competition_id: 'comp-uuid-1',
--     competition_title: 'Win a Tesla',
--     ticket_count: 5,
--     ticket_numbers: '1,5,10,42,99',
--     amount_spent: 25.00,
--     purchase_date: '2026-01-20T10:30:00Z',
--     payment_method: 'balance',
--     transaction_hash: 'txn_789',
--     is_winner: false
--   },
--   ...
-- ]
```

---

## Database Schema Updates Required

The `balance_ledger` table needs additional columns to match PAYMENT_DATABASE_SCHEMA.md:

```sql
-- Add these columns to balance_ledger table:
ALTER TABLE balance_ledger ADD COLUMN canonical_user_id TEXT;
ALTER TABLE balance_ledger ADD COLUMN transaction_type TEXT;
ALTER TABLE balance_ledger ADD COLUMN balance_before NUMERIC DEFAULT 0;
ALTER TABLE balance_ledger ADD COLUMN balance_after NUMERIC DEFAULT 0;
ALTER TABLE balance_ledger ADD COLUMN currency TEXT DEFAULT 'USD';
ALTER TABLE balance_ledger ADD COLUMN reference_id TEXT;
ALTER TABLE balance_ledger ADD COLUMN description TEXT;

-- Add indexes:
CREATE INDEX idx_balance_ledger_canonical_user_id ON balance_ledger(canonical_user_id);
CREATE INDEX idx_balance_ledger_transaction_type ON balance_ledger(transaction_type);
CREATE INDEX idx_balance_ledger_reference_id ON balance_ledger(reference_id);
```

---

## How to Apply to Supabase

### Option 1: Run the Complete Migration (Recommended)

1. Go to Supabase Dashboard → SQL Editor
2. Open the file: `/supabase/migrations/20260120000000_fix_balance_rpc_functions_comprehensive.sql`
3. Copy the entire contents
4. Paste into SQL Editor
5. Click "Run"

The migration is idempotent - it checks for existing columns/functions before creating them.

### Option 2: Apply Functions Manually

If you prefer to apply functions one by one:

1. First, update the balance_ledger table (see schema updates above)
2. Apply `credit_sub_account_balance` function
3. Apply `debit_sub_account_balance` function
4. Apply `debit_sub_account_balance_with_entry` function
5. Apply `get_user_competition_entries` function

All functions are in the migration file with full implementations.

---

## Next Steps After Applying

Once these RPCs are in Supabase, update the Edge Function:

### Update `process-balance-payments` Edge Function

Replace the manual balance updates with RPC calls:

**For top-ups (around line 220-270):**
```typescript
// OLD: Manual sub_account_balances update
// NEW: Use RPC
const { data: creditResult, error: creditError } = await supabase
  .rpc('credit_sub_account_balance', {
    p_canonical_user_id: canonicalUserId,
    p_amount: totalCredit,
    p_currency: 'USD',
    p_reference_id: transaction.id,
    p_description: `Top-up ${amountUsd} + bonus ${bonusAmount}`
  });

if (creditError || !creditResult[0]?.success) {
  throw new Error(`Failed to credit balance: ${creditError?.message || creditResult[0]?.error_message}`);
}

console.log(`✅ Balance credited: ${creditResult[0].previous_balance} → ${creditResult[0].new_balance}`);
```

**For entry purchases (around line 318-388):**
```typescript
// OLD: Manual joincompetition insert
// NEW: Use atomic RPC
const { data: purchaseResult, error: purchaseError } = await supabase
  .rpc('debit_sub_account_balance_with_entry', {
    p_canonical_user_id: entryCanonicalUserId,
    p_competition_id: transaction.competition_id,
    p_amount: totalCost,
    p_ticket_count: ticketCount,
    p_ticket_numbers: '', // ticket numbers if available
    p_transaction_id: transaction.id
  });

if (purchaseError || !purchaseResult.success) {
  throw new Error(`Failed to process purchase: ${purchaseError?.message || purchaseResult.error}`);
}

console.log(`✅ Entry created: ${purchaseResult.entry_uid}, balance: ${purchaseResult.previous_balance} → ${purchaseResult.new_balance}`);
```

---

## Testing the Complete Flow

After applying these RPCs and updating the edge function:

### 1. Test Top-Up Flow
```sql
-- Credit $100 to user
SELECT * FROM credit_sub_account_balance('prize:pid:0x1234...', 100, 'USD', 'test-topup', 'Test top-up');

-- Verify balance
SELECT * FROM get_user_balance('prize:pid:0x1234...');

-- Verify ledger entry
SELECT * FROM balance_ledger 
WHERE canonical_user_id = 'prize:pid:0x1234...' 
AND transaction_type = 'credit'
ORDER BY created_at DESC LIMIT 1;
```

### 2. Test Purchase Flow
```sql
-- Purchase tickets with balance
SELECT * FROM debit_sub_account_balance_with_entry(
  'prize:pid:0x1234...',
  'competition-uuid',
  25.00,
  5,
  '1,2,3,4,5',
  'test-purchase'
);

-- Verify entry created
SELECT * FROM get_user_competition_entries('prize:pid:0x1234...');

-- Verify balance debited
SELECT * FROM get_user_balance('prize:pid:0x1234...');

-- Verify ledger entry
SELECT * FROM balance_ledger 
WHERE canonical_user_id = 'prize:pid:0x1234...' 
AND transaction_type = 'debit'
ORDER BY created_at DESC LIMIT 1;
```

### 3. Test Dashboard Display
```sql
-- Get all user entries (should include balance-paid entries)
SELECT * FROM get_comprehensive_user_dashboard_entries('prize:pid:0x1234...');

-- Get just competition entries
SELECT * FROM get_user_competition_entries('prize:pid:0x1234...');
```

---

## Summary of Changes

### What Was Fixed

✅ **Top-ups now directly credit sub_account_balance**
- `credit_sub_account_balance` RPC properly updates balance AND creates ledger entry
- Ledger tracks balance_before, balance_after for audit trail

✅ **Balance payments now surface entries on dashboard**
- New `debit_sub_account_balance_with_entry` RPC atomically debits balance AND creates entry
- Entries created with chain='balance' show up in dashboard queries

✅ **User entries show up as competition cards**
- `get_user_competition_entries` RPC resolves user and returns all entries
- `get_comprehensive_user_dashboard_entries` already exists and includes joincompetition entries

### Functions Created

1. `credit_sub_account_balance(canonical_user_id, amount, currency, reference_id, description)`
2. `debit_sub_account_balance(canonical_user_id, amount, currency, reference_id, description)`
3. `debit_sub_account_balance_with_entry(canonical_user_id, competition_id, amount, ticket_count, ticket_numbers, transaction_id)` ⭐ NEW
4. `get_user_competition_entries(user_identifier)` ⭐ NEW

### Edge Function Updates Needed

- Update `process-balance-payments/index.ts` to call these RPCs instead of manual updates
- Replace manual balance updates (lines 220-270) with `credit_sub_account_balance` call
- Replace manual entry creation (lines 318-388) with `debit_sub_account_balance_with_entry` call

---

## Questions?

If you need help applying these or have questions about the implementation, let me know!

The migration file contains all the complete function implementations ready to copy-paste into Supabase.
