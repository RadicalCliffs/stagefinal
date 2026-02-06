# Bonus Balance Consolidation

## Problem
The `bonus_balance` was being tracked as a **separate field** from the main wallet balance. This caused confusion - there should only be ONE internal wallet balance number.

## Solution
The 50% first deposit bonus now simply **adds to the main balance**. There is no separate "bonus balance" field in use.

## What Changed

### Database (RPC Function)
- `get_user_balance` now only returns ONE balance
- `bonus_balance` field is kept in the response for backward compatibility but always returns 0
- The 50% first deposit bonus is added directly to `available_balance` (this was already correct)

### Frontend (useRealTimeBalance Hook)
- `bonusBalance` state is kept for backward compatibility but always set to 0
- `totalBalance` now equals `balance` (not `balance + bonusBalance`)
- UI no longer displays separate BONUS line

### UI Components
- Removed separate "BONUS: $X.XX" display from UserDashboardOverview
- Shows only one balance number

## Key Points

✅ **One Balance**: `available_balance` / `usdc_balance` is the ONLY balance
✅ **Bonus Included**: The 50% first deposit bonus goes INTO the main balance
✅ **No Separation**: Bonus is not tracked separately - it's just promotional extra balance
✅ **Backward Compatible**: Old `bonus_balance` fields kept but unused (always 0)

## Database Schema Note

The `bonus_balance` columns still exist in:
- `canonical_users.bonus_balance`
- `sub_account_balances.bonus_balance`

These are **not dropped** (would require data migration) but are **not used**. They will always be 0 or ignored.

## Example Flow

User deposits $100 for the first time:
1. `p_amount = 100` is passed to `credit_balance_with_first_deposit_bonus`
2. Function calculates: `v_bonus_amount = 100 * 0.50 = 50`
3. Function calculates: `v_total_credit = 100 + 50 = 150`
4. **$150 is added to `available_balance`** (the main balance)
5. User sees: **Balance: $150** (not "Balance: $100, Bonus: $50")

That's it. One number. One balance. Simple.
