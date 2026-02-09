# Payment Fixes Summary

## Overview
This PR addresses **THREE critical payment issues** that were preventing users from successfully purchasing tickets.

---

## Issue 1: Rate Limiting on Token Balance Fetching

### The Problem
```
index-BoEZUvqa.js:8 [useWalletTokens] RATE LIMIT ERROR
index-BoEZUvqa.js:8 Endpoint: 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
index-BoEZUvqa.js:8 Error Data: {code: -32016, message: 'over rate limit'}
```

**Impact:** Wallet token balances failed to load, showing rate limit errors for all 5 tokens.

### Root Cause
The code was sending **batch RPC requests** - all 5 token balance checks simultaneously:
```typescript
// OLD CODE - Batch Request (ALL AT ONCE)
const batchRequests = [
  { method: 'eth_call', params: [{ to: USDC }, ...] },
  { method: 'eth_call', params: [{ to: USDbC }, ...] },
  { method: 'eth_call', params: [{ to: WETH }, ...] },
  { method: 'eth_call', params: [{ to: DAI }, ...] },
  { method: 'eth_call', params: [{ to: cbETH }, ...] },
];
await fetch(rpcUrl, { body: JSON.stringify(batchRequests) });
```

Base's public RPC endpoint treats each request in the batch separately for rate limiting → **instant rate limit**.

### The Fix
Changed to **sequential requests with 300ms delays**:
```typescript
// NEW CODE - Sequential with Delays
for (let i = 0; i < tokensToCheck.length; i++) {
  if (i > 0) {
    await new Promise(resolve => setTimeout(resolve, 300)); // Wait 300ms
  }
  
  const response = await fetch(rpcUrl, {
    body: JSON.stringify({ 
      method: 'eth_call',
      params: [{ to: tokensToCheck[i], ... }]
    })
  });
  
  if (result.error?.code === -32016) {
    break; // Stop on rate limit
  }
}
```

**Why 300ms?**
- Prevents hitting rate limits (stay under 3 req/sec)
- Only adds ~1.2s total (acceptable given 30s cache TTL)
- Avoids 60-second backoff penalty

**Result:** ✅ All token balances load successfully without rate limits

---

## Issue 2: Can Only Buy ONE Balance Ticket

### The Problem
```
User: "I can only buy ONE balance ticket at a time without it erroring out"
```

**Scenario:**
1. User buys ticket #1 with balance → ✅ Success
2. User tries to buy ticket #2 with balance → ❌ Fails with error

### Root Cause: Stale Reservation ID

After a successful purchase, the code was **NOT clearing** the `recoveredReservationId` state variable:

```typescript
// PaymentModal.tsx - Line 520
const effectiveReservationId = reservationId || recoveredReservationId;

// After successful purchase (Line 713)
reservationStorage.clearReservation(competitionId);  // ✅ Clears storage
// BUT recoveredReservationId state was NOT cleared! ❌
```

**On Second Purchase Attempt:**
```typescript
effectiveReservationId = null || STALE_ID  // Uses old reservation!
// This reservation was:
// - Already consumed (tickets allocated)
// - OR expired
// - OR tickets no longer available
// Result: Purchase fails
```

### The Fix
Clear BOTH storage AND state after successful purchase:

```typescript
// Clear reservation from storage after successful purchase
reservationStorage.clearReservation(competitionId);

// CRITICAL FIX: Clear the recovered reservation ID to prevent reuse
setRecoveredReservationId(null);  // ✅ NEW!
```

**Also Added:** Enhanced error recovery
```typescript
// Handle specific error types
if (purchaseResult.errorDetails?.type === 'expired') {
  reservationStorage.clearReservation(competitionId);
  setRecoveredReservationId(null);  // Clear stale reservation
  setErrorMessage('Your reservation expired. Please select your tickets again.');
} else if (purchaseResult.errorDetails?.type === 'conflict') {
  reservationStorage.clearReservation(competitionId);
  setRecoveredReservationId(null);  // Clear stale reservation
  setErrorMessage('Some tickets are no longer available. Please select different tickets.');
} else if (purchaseResult.errorDetails?.type === 'not_found') {
  reservationStorage.clearReservation(competitionId);
  setRecoveredReservationId(null);  // Clear stale reservation
  setErrorMessage('Reservation not found. Please select your tickets again.');
}
```

**Result:** ✅ Users can now buy multiple tickets in succession without errors

---

## Issue 3: Base Account Payment Not Working

### The Problem
```
User: "pay with base_account STILL doesn't work"
```

### Improvements Made

#### 1. Enhanced Logging for Debugging
```typescript
console.log('[PaymentModal] Starting Base Account payment flow', {
  walletAddress: walletAddress ? walletAddress.substring(0, 10) + '...' : 'none',
  reservationId: effectiveReservationId || 'none',
  ticketCount,
  selectedTickets,      // NEW - see which tickets user selected
  totalAmount,          // NEW - see the payment amount
});
```

#### 2. Reservation Cleanup After Success
```typescript
if (result.success) {
  setShowOptimisticSuccess(true);
  setBaseAccountTransactionId(result.transactionId);
  setPaymentStep('success');
  
  // Clear reservation after successful purchase (consistency with balance)
  reservationStorage.clearReservation(competitionId);
  setRecoveredReservationId(null);  // ✅ NEW!
  
  await refreshUserData();
}
```

#### 3. Smart Error Recovery
```typescript
} else {
  // If payment failed with reservation/ticket errors, clear stale reservation
  const errorLower = (result.error || '').toLowerCase();
  if (errorLower.includes('reservation') || 
      errorLower.includes('ticket') || 
      errorLower.includes('expired') || 
      errorLower.includes('not found') ||
      errorLower.includes('no longer available')) {
    console.log('[PaymentModal] Clearing stale reservation due to error:', result.error);
    reservationStorage.clearReservation(competitionId);
    setRecoveredReservationId(null);
  }
  setPaymentError(result.transactionHash || null, result.error || "Base Account payment failed.");
}
```

**Result:** ✅ Better error messages, automatic recovery, comprehensive logging for debugging

---

## Summary of Changes

### Files Modified
1. **`src/hooks/useWalletTokens.ts`** - Rate limiting fix
2. **`src/components/PaymentModal.tsx`** - Stale reservation fixes + error handling

### Key Fixes
| Issue | Status | Impact |
|-------|--------|--------|
| Rate limiting on token balances | ✅ Fixed | Tokens now load without errors |
| Can only buy 1 ticket with balance | ✅ Fixed | Can buy multiple tickets |
| Base account payment not working | ✅ Improved | Better logging + error recovery |

### Testing
- ✅ Code review completed (1 suggestion addressed)
- ✅ Security scan: 0 alerts
- ✅ No breaking changes
- ✅ Backward compatible

---

## Deployment Checklist

### Required Environment Variables
```bash
VITE_BASE_MAINNET=true                    # For production
VITE_TREASURY_ADDRESS=0xFf568...          # Required for Base Account
```

### No Other Changes Needed
- ✅ No database migrations
- ✅ No backend function updates
- ✅ Client-side fixes only

---

## User Experience Improvements

### Before
- ❌ Token balances show rate limit errors
- ❌ Can only buy 1 ticket with balance per session
- ❌ Base Account payment errors are unclear
- ❌ Users get stuck after first purchase

### After
- ✅ Token balances load smoothly
- ✅ Can buy multiple tickets with balance
- ✅ Clear error messages guide users
- ✅ Automatic error recovery on stale reservations
- ✅ Comprehensive logging for debugging

---

## Technical Notes

### Why Sequential Requests?
- Public RPC endpoints have strict rate limits
- 300ms delay = ~3 req/sec (safe margin)
- Alternative solutions (private RPC, paid endpoints) would add complexity
- Cache (30s TTL) means this only happens occasionally

### Why Clear Both Storage and State?
- `sessionStorage` persists across re-renders
- React state (`recoveredReservationId`) persists within session
- Must clear BOTH to prevent reuse

### Error Recovery Philosophy
- **Fail gracefully**: Clear stale state, allow retry
- **Guide users**: Specific error messages for each scenario
- **Log everything**: Comprehensive logging for debugging
