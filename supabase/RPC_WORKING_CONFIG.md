# ✅ WORKING RPC CONFIGURATION - DO NOT MODIFY

## Status: CORRECT AND WORKING

The `get_user_competition_entries` RPC function in `HOTFIX_RPC_IS_PENDING.sql` is **CORRECT AND WORKING**.

## Key Configuration:

### Individual Purchases Grouping
**GROUP BY `t.purchased_at`** - This is the CORRECT approach.

- Each ticket can have a different `transaction_hash` (NFT mints)
- Tickets purchased together share the SAME `purchased_at` timestamp
- Grouping by timestamp correctly shows bulk purchases as single purchase sessions

### Why This Works:
- User buys 38 tickets → All have same `purchased_at` timestamp
- Shows as: **1 purchase, 38 tickets, $38.00**
- Matches the activity table on the home page

### DO NOT:
- ❌ Group by `transaction_hash` (creates individual entries per ticket)
- ❌ Group by `purchase_key` (often NULL)
- ✅ Group by `purchased_at` (CORRECT - groups bulk purchases)

## Applied: March 4, 2026
## Last Verified: Working correctly on dashboard
