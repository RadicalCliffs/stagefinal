# ACTUAL Production Functions (from CSV)

## Production Functions That EXIST and WORK:

### 1. get_user_competition_entries(p_user_identifier text)
**Returns TABLE** with these columns:
- id uuid
- competition_id uuid  
- competition_title text
- competition_description text
- competition_image_url text
- competition_status text
- competition_end_date timestamp with time zone
- competition_prize_value numeric
- competition_is_instant_win boolean
- **ticket_count integer** (from ce.tickets_count)
- **ticket_numbers text** (from ce.ticket_numbers_csv)
- amount_paid numeric (from ce.amount_spent)
- entry_status text (hardcoded 'confirmed')
- is_winner boolean
- created_at timestamp with time zone
- wallet_address text
- **transaction_hash text** (hardcoded NULL)

**Implementation:**
- Queries `competition_entries` table ONLY
- JOINs with `competitions` table
- Filters by canonical_user_id OR wallet_address (lowercase match)
- Does NOT use joincompetition, user_transactions, or any other table
- Does NOT have expires_at - uses c.end_date instead

### 2. get_comprehensive_user_dashboard_entries(p_user_identifier text)
**Returns TABLE** with these columns:
- id uuid (generated with gen_random_uuid())
- competition_id text
- title text
- description text
- image text
- status text
- entry_type text
- is_winner boolean
- ticket_numbers text
- total_tickets integer
- total_amount_spent numeric
- purchase_date timestamp with time zone
- transaction_hash text
- is_instant_win boolean
- prize_value numeric
- competition_status text
- end_date timestamp with time zone

**Implementation:**
- Queries `joincompetition` table ONLY
- Aggregates tickets by competition (string_agg)
- Does NOT use competition_entries table
- Uses c.end_time (not c.end_date)
- Reads from jc.ticketnumbers, jc.numberoftickets, jc.amountspent, jc.transactionhash

## Key Columns in joincompetition table (from production function):
- competitionid (text, holds UUID)
- ticketnumbers (text, comma-separated)
- numberoftickets (integer)
- amountspent (numeric)
- created_at (timestamp)
- transactionhash (text)
- canonical_user_id (text)
- wallet_address (text)

## What My Migration Did WRONG:
1. ❌ Tried to return JSONB instead of TABLE
2. ❌ Tried to aggregate from multiple tables (competition_entries + joincompetition + user_transactions)
3. ❌ Used wrong column names
4. ❌ Created completely different function signatures

## What The ACTUAL Errors Are About:
Looking at the error logs, the functions DO exist and work. The errors are from my CODE trying to query OTHER tables incorrectly:
- Line 2228: Code uses `joinedat` column - **should be `created_at`**
- Line 2566: Code tries to JOIN orders to competitions - **relationship doesn't exist, fetch separately**
- Line 2656: Code uses `balance_ledger.user_id` - **should be `canonical_user_id`**

## The Real Fix:
**DO NOT MODIFY THE RPC FUNCTIONS** - they are correct in production!

**FIX THE CODE** that calls fallback queries:
1. `src/lib/database.ts` line ~2228: Change `jc.joinedat` to `jc.created_at`
2. `src/lib/database.ts` line ~2566: Remove JOIN, fetch competitions separately  
3. `src/lib/database.ts` line ~2656: Change `user_id` to `canonical_user_id`
