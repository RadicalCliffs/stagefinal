# VERIFICATION: Production INSERT vs Migration

## Actual Production Data (From User)

```sql
INSERT INTO "public"."joincompetition" 
("id", "userid", "wallet_address", "competitionid", "ticketnumbers", 
 "purchasedate", "status", "created_at", "uid", "chain", "transactionhash", 
 "numberoftickets", "amountspent", "canonical_user_id", "privy_user_id", "updated_at") 
VALUES 
('00439dcc-2e48-4969-83b9-dbcd7c8c0616',           -- id: UUID
 'prize:pid:0x7d6aa7f823f45695baf940ad960e0885e1f8bffc',  -- userid: TEXT
 '0x7d6aa7f823f45695baf940ad960e0885e1f8bffc',          -- wallet_address: TEXT
 '0721ef19-89a1-4d22-817a-0cbb0c9ad134',           -- competitionid: UUID
 '183',                                             -- ticketnumbers: TEXT (single number as string)
 '2026-01-26 15:19:14.259+00',                     -- purchasedate: TIMESTAMPTZ
 'active',                                          -- status: TEXT
 '2026-01-26 15:19:14.386405+00',                  -- created_at: TIMESTAMPTZ
 'a8972c38-21fb-40df-8efd-4f7fdeba5cfa',           -- uid: UUID
 'base_account',                                    -- chain: TEXT
 '0x1c2bd6c89b2b2c6492478504644cb5bbffa238182d6761836cada5fa12abefb9',  -- transactionhash: TEXT
 '1',                                               -- numberoftickets: INTEGER
 '0.25',                                            -- amountspent: NUMERIC
 'prize:pid:0x7d6aa7f823f45695baf940ad960e0885e1f8bffc',  -- canonical_user_id: TEXT
 'prize:pid:0x7d6aa7f823f45695baf940ad960e0885e1f8bffc',  -- privy_user_id: TEXT
 '2026-02-01 11:20:05.221781+00');                 -- updated_at: TIMESTAMPTZ
```

## Column-by-Column Verification

| # | Column Name       | Production Type | Initial Schema (WRONG) | Migration Fix |
|---|-------------------|-----------------|------------------------|---------------|
| 1 | id                | UUID            | TEXT ❌                | TEXT→UUID ✓   |
| 2 | userid            | TEXT            | TEXT ✓                 | No change     |
| 3 | wallet_address    | TEXT            | MISSING ❌             | ADD TEXT ✓    |
| 4 | competitionid     | UUID            | TEXT ❌                | TEXT→UUID ✓   |
| 5 | ticketnumbers     | TEXT            | INTEGER[] ❌           | ARRAY→TEXT ✓  |
| 6 | purchasedate      | TIMESTAMPTZ     | MISSING ❌ (has joinedat) | ADD ✓      |
| 7 | status            | TEXT            | MISSING ❌             | ADD TEXT ✓    |
| 8 | created_at        | TIMESTAMPTZ     | TIMESTAMPTZ ✓          | No change     |
| 9 | uid               | UUID            | MISSING ❌             | ADD UUID ✓    |
| 10| chain             | TEXT            | MISSING ❌             | ADD TEXT ✓    |
| 11| transactionhash   | TEXT            | MISSING ❌             | ADD TEXT ✓    |
| 12| numberoftickets   | INTEGER         | MISSING ❌             | ADD INTEGER ✓ |
| 13| amountspent       | NUMERIC         | MISSING ❌             | ADD NUMERIC ✓ |
| 14| canonical_user_id | TEXT            | MISSING ❌             | ADD TEXT ✓    |
| 15| privy_user_id     | TEXT            | MISSING ❌             | ADD TEXT ✓    |
| 16| updated_at        | TIMESTAMPTZ     | MISSING ❌             | ADD TIMESTAMPTZ ✓ |

## Summary

**Initial Schema Errors:**
- 10 columns MISSING (only had 6 of 16)
- 3 columns with WRONG types
- 1 column with wrong name (joinedat instead of purchasedate)

**Migration 20260202150000 Fixes:**
- ✅ Adds all 11 missing columns
- ✅ Converts id: TEXT → UUID
- ✅ Converts competitionid: TEXT → UUID
- ✅ Converts ticketnumbers: INTEGER[] → TEXT
- ✅ uid is UUID (CORRECTED)
- ✅ Adds all required indexes
- ✅ Adds foreign key constraints

**Result:** Schema will match production EXACTLY after migration.
