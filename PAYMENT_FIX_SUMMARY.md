# Payment System Fix Summary

## Issues Fixed

### 1. Balance Payment Ticket Allocation Failures ✅

**Problem**: When balance payments failed at the ticket allocation phase, the entire payment was rolled back, losing the user's payment and causing confusion.

**Solution Implemented**:
- **Forceful Purchase Mode**: Changed the error handling to NOT rollback the balance debit when ticket allocation fails
- **Verbose Logging**: Added extensive `[VERBOSE]` logging throughout the entire flow
- **Partial Success Handling**: When allocation fails:
  - Balance remains debited (payment honored)
  - Creates records with status `"pending_allocation"` for manual processing
  - Creates entry in `joincompetition` table (even without tickets)
  - Creates transaction in `user_transactions` table with detailed error notes
  - Returns clear message to user with transaction reference for support

**Files Modified**:
- `supabase/functions/purchase-tickets-with-bonus/index.ts`

**Verbose Logging Added**:
```
[VERBOSE][purchase-tickets-with-bonus] Starting ticket allocation phase
[VERBOSE][purchase-tickets-with-bonus] User ID: prize:pid:0x...
[VERBOSE][purchase-tickets-with-bonus] Competition ID: uuid
[VERBOSE][purchase-tickets-with-bonus] Total tickets to allocate: N
[VERBOSE][purchase-tickets-with-bonus] Has reservation: true/false
[VERBOSE][purchase-tickets-with-bonus] Reservation ID: uuid or N/A
[VERBOSE][purchase-tickets-with-bonus] Reserved ticket numbers: [1, 2, 3] or N/A
```

**Error Handling**:
When allocation fails, logs include:
```
[VERBOSE][purchase-tickets-with-bonus] ❌ Ticket assignment failed!
[VERBOSE][purchase-tickets-with-bonus] Error message: ...
[VERBOSE][purchase-tickets-with-bonus] FORCEFUL MODE: Marking purchase as complete anyway
[VERBOSE][purchase-tickets-with-bonus] Available data for troubleshooting:
  - reservationId: ...
  - reservationRecord.id: ...
  - ticketUserId: ...
  - competitionId: ...
  - numberOfTickets: ...
  - selectedTickets: [...]
  - userSelectedTickets: [...]
  - reservedTicketNumbers: [...]
  - totalCost: ...
  - Balance debited successfully: true
  - New balance: ...
```

### 2. Crypto Payment Treasury Address Configuration ✅

**Problem**: Concern that crypto payments might be going to user's wallet instead of business treasury.

**Verification & Enhancement**:
- ✅ **Confirmed**: All crypto payments already correctly go to treasury address
- ✅ **Added Verbose Logging**: Now logs treasury address usage in all payment flows
- ✅ **Documentation**: Updated `.env.example` with correct business wallet address
- ✅ **Verification Steps**: Added logging to verify address matches expected value

**Business Wallet Address**:
```
0xFf5680F0938B01b07952eF075B23082eB136E8Af
```

**Files Modified**:
1. `src/lib/base-payment.ts` - Added verbose logging for treasury address validation
2. `netlify/functions/instant-topup.mts` - Added verbose logging for top-up verification
3. `.env.example` - Updated with correct treasury address

**Payment Flows Verified**:

#### A. Entry Purchase (base-payment.ts)
```typescript
// User's wallet → Treasury (via USDC transfer)
processPrivyWalletPayment() {
  const treasuryAddress = import.meta.env.VITE_TREASURY_ADDRESS;
  // Builds ERC20 transfer to treasury
  // Logs: Treasury address, USDC contract, sender, recipient
}
```

**Logs**:
```
[VERBOSE][BasePayment] Processing Privy wallet payment
[VERBOSE][BasePayment] Treasury address (from env): 0xFf...
[VERBOSE][BasePayment] Expected business wallet: 0xFf5680F0938B01b07952eF075B23082eB136E8Af
[VERBOSE][BasePayment] Network: MAINNET/TESTNET
[VERBOSE][BasePayment] USDC contract address: 0x833...
[VERBOSE][BasePayment] Sending transaction through wallet provider...
[VERBOSE][BasePayment]   FROM: <user wallet>
[VERBOSE][BasePayment]   TO (USDC contract): <USDC address>
[VERBOSE][BasePayment]   RECIPIENT (in data): <treasury address>
[VERBOSE][BasePayment] ✅ Transaction sent successfully!
```

#### B. Wallet Top-Up (instant-topup.mts)
```typescript
// User sends USDC → Treasury
// Backend verifies on-chain
// Credits user's sub_account_balance
verifyTransaction() {
  // Verifies:
  // 1. Transaction is to treasury address
  // 2. From user's wallet
  // 3. Correct amount
}
```

**Logs**:
```
[VERBOSE][instant-topup] Validating transaction details
[VERBOSE][instant-topup] User wallet (normalized): 0x...
[VERBOSE][instant-topup] Treasury address (from env): 0xFf...
[VERBOSE][instant-topup] Expected business wallet: 0xFf5680F0938B01b07952eF075B23082eB136E8Af
[VERBOSE][instant-topup] Verifying transaction on-chain...
[VERBOSE][instant-topup]   - Expected recipient: <treasury>
[VERBOSE][instant-topup]   - Expected amount: X USDC
[VERBOSE][instant-topup]   - Expected sender: <user wallet>
[VERBOSE][instant-topup] ✅ Transaction verified successfully!
[VERBOSE][instant-topup] Crediting user balance with bonus check
[VERBOSE][instant-topup] ✅ Balance credit successful!
[VERBOSE][instant-topup] Balance should be visible in sub_account_balances table
```

## Database Schema

### For Failed Allocations

**joincompetition** table entry:
```sql
{
  uid: uuid,
  competitionid: uuid,
  userid: canonical_user_id,
  numberoftickets: requested_count,
  ticketnumbers: "", -- Empty for failed allocation
  amountspent: total_cost,
  wallet_address: user_wallet,
  chain: "balance",
  transactionhash: reference_id,
  status: "pending_allocation", -- Special status
  purchasedate: timestamp
}
```

**user_transactions** table entry:
```sql
{
  id: uuid,
  user_id: canonical_user_id,
  type: 'entry',
  amount: total_cost,
  status: 'completed', -- Payment completed
  payment_status: 'completed',
  payment_provider: 'balance',
  ticket_count: requested_count,
  notes: "Ticket allocation failed: <error>. Requires manual allocation by support.",
  metadata: {
    allocation_failed: true,
    error_message: "...",
    requested_tickets: N,
    reservation_id: uuid or null
  }
}
```

### For Top-Ups

**user_transactions** table:
```sql
{
  type: 'topup', -- Distinguishes from 'entry'
  competition_id: null, -- No competition for top-ups
  payment_provider: 'instant_wallet_topup',
  wallet_credited: true
}
```

**balance_ledger** table:
```sql
-- Created by credit_balance_with_first_deposit_bonus RPC
{
  canonical_user_id: prize:pid:0x...,
  transaction_type: 'credit', -- or 'debit' for purchases
  amount: X.XX, -- Positive for credit
  currency: 'USD',
  balance_before: Y.YY,
  balance_after: Z.ZZ,
  reference_id: transaction_hash or entry_reference,
  description: "Wallet topup" or "Purchase N tickets for competition",
  top_up_tx_id: transaction_hash (for top-ups)
}
```

**sub_account_balances** table:
```sql
{
  canonical_user_id: prize:pid:0x...,
  currency: 'USD',
  available_balance: Z.ZZ,
  pending_balance: 0.00
}
```

## Environment Configuration

**Required Environment Variable**:
```bash
VITE_TREASURY_ADDRESS=0xFf5680F0938B01b07952eF075B23082eB136E8Af
```

This must be set in:
- Netlify Environment Variables (for production)
- `.env` file (for local development)

## Testing Checklist

### Balance Payment Testing
- [ ] Test successful balance payment with reservation
- [ ] Test successful balance payment without reservation (lucky dip)
- [ ] Test balance payment when allocation fails (verify forceful mode)
- [ ] Check console for verbose logging
- [ ] Verify user balance is debited even if allocation fails
- [ ] Verify support records are created (joincompetition, user_transactions)
- [ ] Verify user receives clear error message with transaction reference

### Crypto Payment Testing
- [ ] Test crypto payment for entry purchase
- [ ] Test crypto top-up
- [ ] Verify treasury address in console logs matches business wallet
- [ ] Verify on-chain transaction goes to treasury
- [ ] Verify balance is credited to sub_account_balances for top-ups
- [ ] Verify balance_ledger entries are created
- [ ] Check user_transactions entries are created correctly

## Support Process for Failed Allocations

When a user contacts support with a failed allocation:

1. **Find the transaction**:
   ```sql
   SELECT * FROM user_transactions 
   WHERE tx_id = '<transaction_reference>'
   OR metadata->>'allocation_failed' = 'true';
   ```

2. **Find the joincompetition entry**:
   ```sql
   SELECT * FROM joincompetition
   WHERE transactionhash = '<transaction_reference>'
   AND status = 'pending_allocation';
   ```

3. **Manually allocate tickets**:
   - Check available tickets for the competition
   - Allocate tickets to the user
   - Update the joincompetition entry with ticket numbers
   - Update status to 'sold'

4. **Update records**:
   ```sql
   UPDATE joincompetition
   SET ticketnumbers = '<comma_separated_numbers>',
       status = 'sold'
   WHERE uid = '<entry_uid>';

   UPDATE user_transactions
   SET notes = 'Manual allocation completed by support',
       metadata = jsonb_set(metadata, '{manually_allocated}', 'true')
   WHERE id = '<transaction_id>';
   ```

## Key Code Changes

### purchase-tickets-with-bonus/index.ts

**Before** (lines ~1440-1510):
```typescript
const assigned = await assignTickets({...});
// If this throws, entire payment is rolled back
```

**After** (lines ~1440-1880):
```typescript
try {
  const assigned = await assignTickets({...});
  // Success path continues as before
} catch (assignErr) {
  // FORCEFUL MODE: Don't rollback!
  // Create partial success records
  // Log detailed debug info
  // Return success with warning
  return {
    success: true, // Payment succeeded
    partial: true,  // But allocation failed
    supportRequired: true,
    ...
  };
}
```

### base-payment.ts

**Added** (lines ~339-360):
```typescript
// Verbose logging for treasury address
console.log(`[VERBOSE][BasePayment] Treasury address (from env): ${treasuryAddress}`);
console.log(`[VERBOSE][BasePayment] Expected business wallet: 0xFf5680F0938B01b07952eF075B23082eB136E8Af`);
// ... detailed transaction logging
```

### instant-topup.mts

**Added** (lines ~280-320):
```typescript
// Verbose logging for verification
console.log(`[VERBOSE][instant-topup] Treasury address (from env): ${treasuryAddress}`);
// ... detailed balance credit logging
```

## Monitoring

To monitor for allocation failures:

```sql
-- Find pending manual allocations
SELECT 
  jc.uid,
  jc.competitionid,
  jc.userid,
  jc.numberoftickets,
  jc.amountspent,
  jc.purchasedate,
  ut.notes
FROM joincompetition jc
JOIN user_transactions ut ON jc.transactionhash = ut.tx_id
WHERE jc.status = 'pending_allocation'
ORDER BY jc.purchasedate DESC;
```

## Conclusion

✅ **Balance Payment Issue**: Resolved with forceful purchase mode and extensive logging
✅ **Crypto Payment Issue**: Verified correct, enhanced with verbose logging
✅ **Treasury Address**: Confirmed all payments go to business wallet
✅ **Logging**: Comprehensive verbose logging for debugging
✅ **Documentation**: Updated environment configuration

All payments now have clear audit trails and failed allocations are handled gracefully without losing user funds.
