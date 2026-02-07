# WHERE usdc_balance IS BEING CALLED - COMPLETE REFERENCE

## Database Schema

### canonical_users Table
**Location**: `supabase/migrations/00000000000000_initial_schema.sql:43`
```sql
usdc_balance NUMERIC(20, 6) DEFAULT 0 NOT NULL,
```

## Database Functions/Migrations Using usdc_balance

### 1. Initial Schema (00000000000000_initial_schema.sql)
- Line 43: Column definition in canonical_users table
- Line 1043: COALESCE(usdc_balance, 0) in get_user_overview
- Line 1054: ORDER BY usdc_balance DESC
- Line 2632: SELECT canonical_user_id, usdc_balance
- Line 2652: UPDATE canonical_users SET usdc_balance = v_new_balance

### 2. Dashboard Production Schema Fix (20260202090000)
- Line 10: Comment about balance discrepancy
- Line 241: Comment about updating usdc_balance
- Line 295: Comment about updating usdc_balance when currency is USD
- Line 299: SET usdc_balance = COALESCE(usdc_balance, 0) + p_amount
- Line 310: Comment about updating usdc_balance
- Line 396: Comment about updating usdc_balance
- Line 400: SET usdc_balance = COALESCE(usdc_balance, 0) + p_amount
- Line 448-461: Find and fix discrepancies in usdc_balance

### 3. Emergency Fix RPC and Balance (20260202100000)
- Line 126: SET usdc_balance = COALESCE(v_ledger_balance, 0)
- Line 158: SET usdc_balance = v_ledger_balance

### 4. User Transactions Insert Fix (20260201074000)
- Line 235: SET usdc_balance = v_new_balance

### 5. Additional Balance Functions (20260201004100)
- Line 189: SET usdc_balance = v_new_balance

### 6. Remove Separate Bonus Balance (20260206123100)
- Line 75: Comment - ONLY get usdc_balance
- Line 78: COALESCE(usdc_balance, 0)
- Line 88: ORDER BY usdc_balance DESC

### 7. Credit Balance Creates User Transactions (20260206121800)
- Line 253: Comment about updating usdc_balance
- Line 256: SET usdc_balance = COALESCE(usdc_balance, 0) + p_amount

## Edge Functions Using usdc_balance

### 1. get-user-profile/index.ts
- Line 92: .select("...usdc_balance...")
- Line 102: .select("...usdc_balance...")
- Line 119: usdc_balance: 0 (default)
- Line 178: usdc_balance: Number(profile.usdc_balance ?? 0)

### 2. create-new-user/index.ts
- Line 128: usdc_balance: 0
- Line 133: .select("...usdc_balance...")

### 3. onramp-complete/index.ts
- Line 103: .select('id, usdc_balance')
- Line 113: .select('id, usdc_balance')

### 4. create-charge/index.ts
- Line 198: usdc_balance: 0

### 5. secure-write/index.ts
- Line 297: .select("id, usdc_balance")
- Line 340: currentBalance = Number(userData.usdc_balance || 0)
- Line 346: usdc_balance: newBalance

### 6. purchase-tickets-with-bonus/index.ts
- Lines 817-1776: Multiple references to usdc_balance
  - Selecting usdc_balance from canonical_users
  - Updating usdc_balance field
  - Checking if usdc_balance > 0
  - Setting usdc_balance to new balance values

### 7. onramp-webhook/index.ts
- Line 510: .select('id, usdc_balance, has_used_new_user_bonus')

### 8. upsert-user/index.ts
- Line 160: usdc_balance: 0

## Frontend Code Using usdc_balance

### 1. src/lib/ticketPurchaseService.ts
- Line 341: usdc_balance: balanceData.balance
- Line 365: usdc_balance: Number((subAccountData[0] as any).available_balance) || 0
- Line 376: usdc_balance: 0
- Line 383: data: { usdc_balance: 0 }

### 2. src/components/PaymentModal.tsx
- Line 267: setUserBalance(result.data.usdc_balance)
- Line 277: setUserBalance(result.data.usdc_balance)
- Line 524: setUserBalance(result.data.usdc_balance)
- Line 1843: .then(balance => setUserBalance(balance.data.usdc_balance))

### 3. src/components/BaseWalletAuthModal.tsx
- Line 524: usdc_balance: 0

### 4. src/lib/user-auth.ts
- Line 126: usdc_balance?: number | null (type definition)
- Line 136: usdc_balance: byCanonical.usdc_balance
- Line 365: usdc_balance?: number | null (type definition)
- Line 379: usdc_balance: byEmail.usdc_balance
- Line 558: usdc_balance: 0

### 5. src/hooks/useBalanceHealthCheck.ts
- Line 14: Comment about monitoring canonical_users.usdc_balance
- Line 43: .select('usdc_balance')
- Line 45: .maybeSingle<{ usdc_balance: number }>()
- Line 68: const canonicalBalance = Number(canonicalResult.data?.usdc_balance || 0)

### 6. src/hooks/useUserProfile.ts
- Line 23: usdc_balance: number (type definition)
- Line 102: usdc_balance: serverData.data.wallet?.usdc_balance || 0
- Line 203: usdc_balance: profileData?.usdc_balance || 0

### 7. src/lib/database.types.ts
- Line 289: usdc_balance: number
- Line 316: usdc_balance?: number
- Line 343: usdc_balance?: number

## Summary

**Total Files**: 28 files
**Total References**: 100+ occurrences

### Key Points:
1. **Database Column**: `canonical_users.usdc_balance` - NUMERIC(20, 6) NOT NULL DEFAULT 0
2. **Edge Functions**: All user-related functions SELECT and UPDATE this field
3. **Frontend**: All payment/balance-related components read this field
4. **Migrations**: Multiple migrations update and sync this field

### Most Critical Locations:
1. **get-user-profile** edge function - Main source for frontend balance data
2. **ticketPurchaseService.ts** - Returns usdc_balance to components
3. **PaymentModal.tsx** - Displays user balance
4. **purchase-tickets-with-bonus** - Updates balance after purchases

### Potential Issues:
- If column doesn't exist in production → All queries will fail
- If column is NULL → May cause issues despite DEFAULT 0
- If migrations haven't run → Column may not exist
- If data type mismatch → Type errors in edge functions
