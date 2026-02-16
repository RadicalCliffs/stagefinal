# Base Account Payment Fix & Commerce Top-Up Clarification

**Date**: February 16, 2026  
**Issue**: Base Account payments failing + Commerce classification confusion  
**Status**: ✅ **FIXED**

---

## Problem Statement

1. **Base Account payments were failing** with constraint violation error
2. **Commerce providers were incorrectly classified** as external payments for entries

### Errors Fixed

**Base Account Error**:
```
Failed to create transaction: new row for relation "user_transactions" 
violates check constraint "user_tx_posted_balance_chk"
```

**Commerce Classification Issue**:
Commerce providers were added to the "external payment" list for entry purchases, but Commerce is ONLY for top-ups, not direct entry purchases.

---

## Payment Flow Clarification

### Two Distinct Flows

#### 1. Top-Ups (Add Money to Balance)
**Providers**: `coinbase_commerce`, `cdp_commerce`  
**Flow**: 
1. User clicks "Top Up" in wallet modal
2. Frontend calls `/api/create-charge` (creates Coinbase Commerce charge)
3. User completes payment in Commerce checkout
4. Commerce webhook receives confirmation
5. **Webhook calls `credit_balance_with_first_deposit_bonus` RPC** 
6. **Balance is credited** (this is the whole point of topping up!)
7. Transaction record updated with type='topup', payment_provider='coinbase_commerce'

**Key Point**: Commerce top-ups SHOULD and DO credit the user's balance. That's what topping up means!

#### 2. Direct Entry Purchases (Pay On-Chain for Tickets)
**Providers**: `base_account`, `privy_base_wallet`, `onchainkit`  
**Flow**:
1. User selects competition entry
2. User chooses "Pay with Base" 
3. Frontend calls `/api/secure-write/transactions/create`
4. Transaction record created with posted_to_balance=true
5. User pays with on-chain USDC transfer
6. Payment confirmed on-chain
7. User gets tickets

**Key Point**: Direct entry purchases DON'T touch internal balance because payment is external.

---

## What Was Wrong

### In `secure-write.mts` (handleCreateTransaction)

**Before** (INCORRECT):
```typescript
const isExternalPayment = [
  'base_account',
  'cdp_commerce',        // ❌ WRONG - Commerce is for top-ups, not entries
  'coinbase_commerce',   // ❌ WRONG - Commerce is for top-ups, not entries  
  'instant_wallet_topup' // ❌ WRONG - This is also for top-ups
  ...
].includes(finalPaymentProvider);
```

**After** (CORRECT):
```typescript
// NOTE: Commerce is NOT in this list because:
// - Commerce is for TOP-UPS only, not direct entry purchases
// - Top-ups go through create-charge → webhook → credits balance
const isExternalPayment = [
  'base_account',        // ✓ Direct on-chain entry payment
  'privy_base_wallet',   // ✓ Direct on-chain entry payment
  'onchainkit',          // ✓ Direct on-chain entry payment
  // Commerce providers are NOT here!
].includes(finalPaymentProvider);
```

---

## How Commerce Top-Ups Work (The Correct Flow)

### Step-by-Step

1. **User Action**: Clicks "Top Up" button in wallet
2. **Charge Creation**: Frontend calls `/api/create-charge`
   - Creates Coinbase Commerce charge
   - Creates user_transactions record (status='pending')
   - Returns checkout URL

3. **User Payment**: User pays via Commerce checkout
   - Payment processed by Coinbase
   - User pays with crypto or card

4. **Webhook Confirmation**: Commerce webhook receives `charge:confirmed`
   - Webhook calls `credit_balance_with_first_deposit_bonus` RPC
   - RPC function:
     - **Credits sub_account_balances.available_balance** 
     - Applies 50% first-deposit bonus if eligible
     - Creates balance_ledger entry with type='topup'
     - Creates user_transactions record with payment_provider='coinbase_commerce'
   
5. **Trigger Processing**: When transaction inserted/updated
   - Trigger sees payment_provider='coinbase_commerce' in skip list
   - Sets posted_to_balance=true (prevents double-credit)
   - Returns without modifying balance (already credited by RPC)

6. **Result**: User's balance is increased, can now buy entries!

---

## Why The Skip List Is Correct

Commerce providers ARE in the trigger skip list, and that's CORRECT:

```sql
-- In trigger functions
IF NEW.payment_provider IN (
  'coinbase_commerce',  -- ✓ Correct - prevents double-credit
  'cdp_commerce',       -- ✓ Correct - prevents double-credit
  ...
) THEN
  NEW.posted_to_balance := true;
  RETURN NEW;  -- Skip balance processing
END IF;
```

**Why**: 
- Commerce webhook already credits balance via RPC
- Trigger would double-credit if not skipped
- Setting posted_to_balance=true marks it as "already processed"

---

## Summary of Fixes

### 1. Removed Commerce from Entry Payment List ✅

**File**: `netlify/functions/secure-write.mts`

Removed `coinbase_commerce`, `cdp_commerce`, and `instant_wallet_topup` from the external payment list in `handleCreateTransaction` because:
- This function is ONLY for competition entries
- Commerce is ONLY for top-ups
- They should never appear together

### 2. Fixed Comments ✅

Added clear documentation explaining:
- Commerce is for top-ups that credit balance
- Base Account is for direct entry purchases
- The distinction between the two flows

### 3. Commerce Top-Ups Still Work ✅

Verified that Commerce webhook:
- Still calls `credit_balance_with_first_deposit_bonus` RPC
- Still credits balance correctly
- Still applies first-deposit bonus
- Still creates proper balance_ledger entries

---

## Payment Provider Matrix

| Provider | Use Case | Touches Balance? | Where Processed |
|----------|----------|------------------|-----------------|
| `coinbase_commerce` | Top-ups | ✅ Credits | Commerce webhook → RPC |
| `cdp_commerce` | Top-ups | ✅ Credits | Commerce webhook → RPC |
| `base_account` | Entry purchases | ❌ No | On-chain confirmation |
| `privy_base_wallet` | Entry purchases | ❌ No | On-chain confirmation |
| `onchainkit` | Entry purchases | ❌ No | On-chain confirmation |
| `balance` | Entry purchases | ✅ Debits | Balance triggers |

---

## Testing

### Test Commerce Top-Up ✅

1. User clicks "Top Up"
2. Selects amount (e.g., $50)
3. Chooses Commerce payment
4. Completes payment
5. **Expected**: Balance increases by amount + bonus
6. **Verify in DB**:
   ```sql
   SELECT * FROM sub_account_balances 
   WHERE canonical_user_id = 'user_id';
   -- Should show increased available_balance
   
   SELECT * FROM balance_ledger 
   WHERE canonical_user_id = 'user_id' 
   AND type = 'topup'
   ORDER BY created_at DESC LIMIT 1;
   -- Should show entry with payment_provider='coinbase_commerce'
   ```

### Test Base Account Entry Purchase ✅

1. User selects competition
2. Chooses "Pay with Base"
3. Completes on-chain payment
4. **Expected**: Gets tickets, balance unchanged
5. **Verify in DB**:
   ```sql
   SELECT * FROM user_transactions 
   WHERE payment_provider = 'base_account'
   AND posted_to_balance = true
   ORDER BY created_at DESC LIMIT 1;
   -- Should show entry with posted_to_balance=true
   ```

---

## Conclusion

### What Was Fixed

1. ✅ Base Account entry purchases work (posted_to_balance=true)
2. ✅ Commerce top-ups still credit balance correctly (via webhook RPC)
3. ✅ Removed Commerce from entry payment list (they don't belong there)
4. ✅ Clarified documentation and comments

### Key Takeaway

**Commerce is for top-ups, Base Account is for entries**:
- Commerce top-ups → Credit balance (that's the whole point!)
- Base entries → Direct on-chain payment (no balance involved)
- Never mix them up!

---

*Fix Completed: February 16, 2026*  
*Commits: 990c40f, [new commit]*  
*Branch: copilot/fix-topup-button-functionality*
