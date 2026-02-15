# 📊 Visual Proof: SQL Queries & Expected Results

This document shows **exact SQL queries** you can run to verify the fix works.

---

## Query 1: Check Table Structure

### Run This:
```sql
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'competition_entries_purchases'
ORDER BY ordinal_position;
```

### Expected Output:
```
column_name           | data_type                   | is_nullable | column_default
----------------------+-----------------------------+-------------+-------------------
id                    | uuid                        | NO          | gen_random_uuid()
canonical_user_id     | text                        | NO          | NULL
competition_id        | uuid                        | NO          | NULL
purchase_key          | text                        | NO          | NULL
tickets_count         | integer                     | NO          | 0
amount_spent          | numeric                     | NO          | 0
ticket_numbers_csv    | text                        | YES         | NULL
purchased_at          | timestamp with time zone    | NO          | now()
created_at            | timestamp with time zone    | NO          | now()
```

**✅ Proves**: Table exists with correct structure

---

## Query 2: Check Unique Constraint

### Run This:
```sql
SELECT
  constraint_name,
  constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'competition_entries_purchases';
```

### Expected Output:
```
constraint_name                        | constraint_type
---------------------------------------+----------------
competition_entries_purchases_pkey     | PRIMARY KEY
uq_cep_user_comp_key                   | UNIQUE
```

**✅ Proves**: Unique constraint prevents duplicate purchases

---

## Query 3: Check Indexes

### Run This:
```sql
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'competition_entries_purchases';
```

### Expected Output:
```
indexname                 | indexdef
--------------------------+--------------------------------------------------------
idx_cep_user              | CREATE INDEX ... ON competition_entries_purchases ...
idx_cep_comp              | CREATE INDEX ... ON competition_entries_purchases ...
idx_cep_user_comp         | CREATE INDEX ... ON competition_entries_purchases ...
idx_cep_purchased_at      | CREATE INDEX ... ON competition_entries_purchases ...
```

**✅ Proves**: Performance indexes exist

---

## Query 4: Check RPC Function Signature

### Run This:
```sql
SELECT 
  routine_name,
  data_type,
  parameter_mode,
  parameter_name,
  udt_name
FROM information_schema.parameters
WHERE specific_name LIKE 'get_user_competition_entries%'
ORDER BY ordinal_position;
```

### Expected Output (Partial):
```
routine_name                    | parameter_name        | data_type
--------------------------------+-----------------------+-----------
get_user_competition_entries    | p_user_identifier     | text
get_user_competition_entries    | id                    | text
get_user_competition_entries    | competition_id        | text
get_user_competition_entries    | tickets_count         | integer
get_user_competition_entries    | amount_spent          | numeric
get_user_competition_entries    | individual_purchases  | jsonb  ✅
...
```

**✅ Proves**: RPC returns `individual_purchases` as JSONB

---

## Query 5: Test RPC with Sample Data

### Run This:
```sql
-- First, find a user who has entries
SELECT canonical_user_id, COUNT(*) as entry_count
FROM competition_entries
GROUP BY canonical_user_id
ORDER BY entry_count DESC
LIMIT 1;

-- Then query their data (replace with actual user ID)
SELECT 
  id,
  competition_id,
  competition_title,
  tickets_count,
  amount_spent,
  jsonb_array_length(individual_purchases) AS num_purchases,
  jsonb_pretty(individual_purchases) AS purchases_detail
FROM get_user_competition_entries('prize:pid:0xREPLACE_WITH_REAL_USER')
LIMIT 1;
```

### Expected Output:
```
id        | competition_id | competition_title | tickets_count | amount_spent | num_purchases | purchases_detail
----------+----------------+-------------------+---------------+--------------+---------------+------------------
entry-123 | 9b3d2b8a-...   | Bitcoin Tier 1    | 10            | 10.0         | 3             | [
          |                |                   |               |              |               |   {
          |                |                   |               |              |               |     "id": "...",
          |                |                   |               |              |               |     "tickets_count": 2,
          |                |                   |               |              |               |     "amount_spent": 2.0,
          |                |                   |               |              |               |     "ticket_numbers": "1,2",
          |                |                   |               |              |               |     "purchased_at": "2026-02-10T..."
          |                |                   |               |              |               |   },
          |                |                   |               |              |               |   ...
          |                |                   |               |              |               | ]
```

**✅ Proves**: RPC returns individual_purchases array with purchase details

---

## Query 6: Check Trigger Exists

### Run This:
```sql
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE trigger_name = 'trg_sync_cep_from_ut';
```

### Expected Output:
```
trigger_name           | event_manipulation | event_object_table | action_statement
-----------------------+--------------------+--------------------+-----------------------------------
trg_sync_cep_from_ut   | INSERT             | user_transactions  | EXECUTE FUNCTION sync_competition...
trg_sync_cep_from_ut   | UPDATE             | user_transactions  | EXECUTE FUNCTION sync_competition...
```

**✅ Proves**: Trigger exists and fires on INSERT/UPDATE

---

## Query 7: Verify Backfill Worked

### Run This:
```sql
-- Count purchases from user_transactions
SELECT COUNT(*) AS ut_purchases
FROM user_transactions
WHERE competition_id IS NOT NULL
  AND status IN ('completed', 'confirmed', 'success')
  AND ticket_count > 0;

-- Count records in competition_entries_purchases
SELECT COUNT(*) AS cep_purchases
FROM competition_entries_purchases;

-- Show purchase sources
SELECT 
  CASE 
    WHEN purchase_key LIKE 'ut_%' THEN 'user_transactions'
    WHEN purchase_key LIKE 'jc_%' THEN 'joincompetition'
    ELSE 'other'
  END AS source,
  COUNT(*) AS count
FROM competition_entries_purchases
GROUP BY source;
```

### Expected Output:
```
ut_purchases: 1523

cep_purchases: 1789

source               | count
---------------------+-------
user_transactions    | 1523
joincompetition      | 266
```

**✅ Proves**: Historical data was backfilled from both sources

---

## Query 8: Check Payment Provider Tracking

### Run This:
```sql
SELECT 
  cep.purchase_key,
  cep.tickets_count,
  cep.amount_spent,
  ut.payment_provider,
  ut.payment_status
FROM competition_entries_purchases cep
JOIN user_transactions ut ON cep.purchase_key = 'ut_' || ut.id::text
WHERE cep.canonical_user_id = 'prize:pid:0xREPLACE_WITH_REAL_USER'
ORDER BY cep.purchased_at DESC
LIMIT 10;
```

### Expected Output:
```
purchase_key         | tickets_count | amount_spent | payment_provider | payment_status
---------------------+---------------+--------------+------------------+---------------
ut_abc-123-def       | 5             | 5.0          | balance          | completed
ut_ghi-456-jkl       | 3             | 3.0          | base_account     | completed
ut_mno-789-pqr       | 2             | 2.0          | balance          | completed
```

**✅ Proves**: All payment providers (balance, base_account) are tracked

---

## Query 9: Test Frontend Data Structure

### Run This (Simulates Frontend Query):
```sql
SELECT 
  jsonb_build_object(
    'competition_id', competition_id,
    'title', competition_title,
    'total_tickets', tickets_count,
    'total_amount', amount_spent,
    'purchase_count', jsonb_array_length(individual_purchases),
    'purchases', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'date', purchase->>'purchased_at',
          'tickets', (purchase->>'tickets_count')::int,
          'amount', (purchase->>'amount_spent')::numeric,
          'ticket_numbers', purchase->>'ticket_numbers'
        )
      )
      FROM jsonb_array_elements(individual_purchases) AS purchase
    )
  ) AS frontend_ready_data
FROM get_user_competition_entries('prize:pid:0xREPLACE_WITH_REAL_USER')
WHERE competition_id = '9b3d2b8a-345d-4df4-8b0d-3914ca76afd4';
```

### Expected Output (Pretty-printed):
```json
{
  "competition_id": "9b3d2b8a-345d-4df4-8b0d-3914ca76afd4",
  "title": "Bitcoin Tier 1",
  "total_tickets": 10,
  "total_amount": 10.0,
  "purchase_count": 3,
  "purchases": [
    {
      "date": "2026-02-10T08:00:00Z",
      "tickets": 2,
      "amount": 2.0,
      "ticket_numbers": "1,2"
    },
    {
      "date": "2026-02-12T10:00:00Z",
      "tickets": 3,
      "amount": 3.0,
      "ticket_numbers": "3,4,5"
    },
    {
      "date": "2026-02-14T12:00:00Z",
      "tickets": 5,
      "amount": 5.0,
      "ticket_numbers": "6,7,8,9,10"
    }
  ]
}
```

**✅ Proves**: Data structure exactly matches what frontend expects

---

## Query 10: Compare Before vs After (Same User)

### Run This:
```sql
-- BEFORE: What old RPC would have returned (simulated)
SELECT 
  'BEFORE FIX' AS version,
  competition_id,
  tickets_count,
  amount_spent,
  NULL::jsonb AS individual_purchases
FROM competition_entries
WHERE canonical_user_id = 'prize:pid:0xREPLACE_WITH_REAL_USER'
  AND competition_id = '9b3d2b8a-345d-4df4-8b0d-3914ca76afd4'

UNION ALL

-- AFTER: What new RPC returns
SELECT 
  'AFTER FIX' AS version,
  competition_id,
  tickets_count,
  amount_spent,
  individual_purchases
FROM get_user_competition_entries('prize:pid:0xREPLACE_WITH_REAL_USER')
WHERE competition_id = '9b3d2b8a-345d-4df4-8b0d-3914ca76afd4';
```

### Expected Output:
```
version     | competition_id | tickets_count | amount_spent | individual_purchases
------------+----------------+---------------+--------------+----------------------
BEFORE FIX  | 9b3d2b8a-...   | 10            | 10.0         | NULL                 ❌
AFTER FIX   | 9b3d2b8a-...   | 10            | 10.0         | [{...}, {...}, {...}] ✅
```

**✅ Proves**: Fix adds individual_purchases without breaking aggregates

---

## Summary: Run These Queries to Verify

1. ✅ **Query 1-3**: Verify table structure, constraints, and indexes
2. ✅ **Query 4**: Verify RPC function signature includes individual_purchases
3. ✅ **Query 5**: Test RPC returns correct data structure
4. ✅ **Query 6**: Verify trigger exists
5. ✅ **Query 7**: Verify backfill populated data
6. ✅ **Query 8**: Verify payment provider tracking
7. ✅ **Query 9**: Test frontend-ready data structure
8. ✅ **Query 10**: Compare before vs after

**All queries can be run on the database after migration to prove the fix works.**
