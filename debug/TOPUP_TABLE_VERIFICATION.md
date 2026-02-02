# Top-up Table Updates - Verification Summary

## 🎯 Question: What Tables Are Updated During Top-ups?

**User's Requirement**: When a top-up completes, the following tables should be updated:
1. `sub_account_balances` - The balance table
2. `balance_ledger` - Audit trail
3. `user_transactions` - Record keeper

## ✅ VERIFIED: All Required Tables Are Updated Correctly

---

## 📊 Detailed Analysis

### Table 1: `sub_account_balances` ✅

**Primary RPC**: `credit_balance_with_first_deposit_bonus`
- Location: `supabase/migrations/20260129000000_fix_credit_balance_return_new_balance.sql`
- Lines 62-67: Updates `available_balance`
- Lines 38-43: Updates `bonus_balance` (first deposit only)

**Fallback RPC**: `credit_sub_account_balance`
- Location: `supabase/migrations/20260201004000_restore_production_balance_functions.sql`
- Lines 74-89: Creates record if doesn't exist
- Lines 95-99: Updates `available_balance`

**What Gets Updated**:
```sql
available_balance = available_balance + p_amount
bonus_balance = bonus_balance + v_bonus_amount (first time only)
updated_at = NOW()
```

**Key Field**: `canonical_user_id` (e.g., `prize:pid:0x...`)

---

### Table 2: `balance_ledger` ✅

**Primary RPC**: `credit_balance_with_first_deposit_bonus`
- Location: Lines 75-87

**Fallback RPC**: `credit_sub_account_balance`
- Location: Lines 103-123

**What Gets Created**:
```sql
INSERT INTO balance_ledger (
  canonical_user_id,        -- User identifier
  transaction_type,         -- 'deposit' or 'credit'
  amount,                   -- Total credited (with bonus)
  currency,                 -- 'USD'
  balance_before,           -- Previous balance
  balance_after,            -- New balance
  reference_id,             -- Transaction hash
  description,              -- e.g., "wallet_topup"
  created_at                -- Timestamp
)
```

**Purpose**: Complete audit trail of all balance changes

---

### Table 3: `user_transactions` ✅

**Updated By**: `instant-topup.mts`
- Location: `netlify/functions/instant-topup.mts` lines 416-424

**What Gets Updated**:
```typescript
await supabase
  .from("user_transactions")
  .update({
    wallet_credited: true,
    notes: bonusApplied 
      ? `Wallet topup completed with 50% bonus (+$${bonusAmount.toFixed(2)})` 
      : "Wallet topup completed",
  })
  .eq("id", transactionId);
```

**Initial Record** (created at line 350-367):
```typescript
{
  user_id: user.canonicalUserId,
  wallet_address: normalizedWallet,
  competition_id: null,              // NULL = top-up
  amount: creditAmount,
  currency: "USDC",
  network: "base",
  payment_provider: "instant_wallet_topup",
  status: "completed",
  payment_status: "confirmed",
  type: "topup",
  tx_id: transactionHash,
  completed_at: timestamp
}
```

**Purpose**: Record keeper of all payment transactions

---

## 🔄 Complete Top-up Flow

### Step-by-Step Process:

```
1. USER ACTION
   └─> User sends USDC from wallet to treasury address
       └─> On-chain transaction created with hash

2. INSTANT-TOPUP.MTS (Frontend calls this)
   └─> Verifies transaction on-chain (lines 318-337)
       └─> Checks: recipient, amount, sender match
   
   └─> Creates/finds user_transactions record (lines 350-374)
       └─> Sets: competition_id = null, type = "topup"
   
   └─> Calls credit_balance_with_first_deposit_bonus RPC (lines 385-393)
       ├─> Updates sub_account_balances.available_balance ✅
       ├─> Updates sub_account_balances.bonus_balance (first time) ✅
       ├─> Creates balance_ledger entry ✅
       └─> Updates canonical_users.has_used_new_user_bonus
   
   └─> Updates user_transactions (lines 416-424)
       ├─> Sets wallet_credited = true ✅
       └─> Adds notes with bonus info ✅

3. RESULT
   ✅ sub_account_balances updated
   ✅ balance_ledger entry created
   ✅ user_transactions marked complete
   ✅ User can see new balance in dashboard
```

---

## 🎯 What Wallet Is Being Topped Up?

**Answer**: The user's `sub_account_balances` record

**Identification**:
- **Key**: `canonical_user_id`
- **Format**: `prize:pid:0x...` or raw wallet address
- **Example**: `prize:pid:0xa1b2c3d4e5f6...`

**How It Works**:
1. User signs in with wallet → `canonical_user_id` created
2. User sends USDC to treasury → transaction verified
3. RPC updates `sub_account_balances` WHERE `canonical_user_id` = user's ID
4. Balance increases for that specific user

**One user, one balance record per currency**:
```sql
SELECT * FROM sub_account_balances 
WHERE canonical_user_id = 'prize:pid:0x...' 
AND currency = 'USD';

Result:
- available_balance: $100.00
- bonus_balance: $20.00  (if first deposit)
- pending_balance: $0.00
```

---

## 📋 Additional Tables Updated

### 4. `canonical_users` (Optional)

**Updated By**: `credit_balance_with_first_deposit_bonus` RPC
- Location: Lines 32-35

**What Gets Updated** (first deposit only):
```sql
has_used_new_user_bonus = true
updated_at = NOW()
```

**Purpose**: Track whether user has received first deposit bonus

---

### 5. `bonus_award_audit` (Optional)

**Updated By**: `credit_balance_with_first_deposit_bonus` RPC
- Location: Lines 46-56

**What Gets Created** (first deposit only):
```sql
INSERT INTO bonus_award_audit (
  canonical_user_id,
  amount,           -- Bonus amount (20% of deposit)
  reason,           -- "wallet_topup"
  note              -- "First deposit bonus: 20%"
)
```

**Purpose**: Audit trail of all bonus awards

---

## 🧪 Testing Verification

### How to Verify Top-up is Working:

**1. Check sub_account_balances**:
```sql
SELECT 
  canonical_user_id,
  available_balance,
  bonus_balance,
  updated_at
FROM sub_account_balances
WHERE canonical_user_id = 'prize:pid:0x...'
ORDER BY updated_at DESC;
```

**2. Check balance_ledger**:
```sql
SELECT 
  transaction_type,
  amount,
  balance_before,
  balance_after,
  reference_id,
  created_at
FROM balance_ledger
WHERE canonical_user_id = 'prize:pid:0x...'
ORDER BY created_at DESC
LIMIT 10;
```

**3. Check user_transactions**:
```sql
SELECT 
  id,
  amount,
  payment_provider,
  status,
  wallet_credited,
  notes,
  completed_at
FROM user_transactions
WHERE user_id = 'prize:pid:0x...'
AND competition_id IS NULL  -- Top-ups have NULL competition_id
ORDER BY completed_at DESC
LIMIT 10;
```

**Expected Results After $100 Top-up**:
- `sub_account_balances.available_balance` increased by $100
- `sub_account_balances.bonus_balance` increased by $20 (first time only)
- `balance_ledger` has new entry with amount = $120 (if bonus applied)
- `user_transactions.wallet_credited` = true

---

## ✅ Conclusion

**All Required Tables Are Updated Correctly** ✅

When a user completes a top-up:
1. ✅ **sub_account_balances**: Balance increased
2. ✅ **balance_ledger**: Audit entry created
3. ✅ **user_transactions**: Transaction marked as processed

**Additional tables** (bonus tracking):
4. ✅ **canonical_users**: Bonus flag updated (first time)
5. ✅ **bonus_award_audit**: Bonus record created (first time)

**The wallet being topped up**: User's `sub_account_balances` record identified by `canonical_user_id`

**No fixes needed** - The system is working correctly!

---

## 📚 Related Files

**Frontend**:
- `netlify/functions/instant-topup.mts` - Handles instant top-ups
- `src/components/TopUpWalletModal.tsx` - UI for top-ups

**Backend RPCs**:
- `supabase/migrations/20260129000000_fix_credit_balance_return_new_balance.sql`
  - `credit_balance_with_first_deposit_bonus` function
- `supabase/migrations/20260201004000_restore_production_balance_functions.sql`
  - `credit_sub_account_balance` function (fallback)

**Edge Functions**:
- `supabase/functions/onramp-complete/index.ts` - Coinbase Onramp top-ups
- `supabase/functions/commerce-webhook/index.ts` - Coinbase Commerce top-ups

---

**Date**: 2026-02-01  
**Status**: VERIFIED ✅  
**Conclusion**: All three required tables are correctly updated during top-ups
