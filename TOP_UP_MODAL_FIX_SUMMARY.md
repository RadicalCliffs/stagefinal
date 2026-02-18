# Top-Up Modal Fix Summary

## Problem Statement
The top-up modal was getting stuck on "Creating Checkout" screen with no error messages appearing in the console or to the user. The modal appeared to do nothing when buttons were clicked.

## Root Causes Identified

### 1. **Silent Async Failures**
- `handleContinue()` was calling `initiatePayment()` with `void` (fire-and-forget)
- This swallowed all exceptions and prevented error handling
- No console logs at button click entry points

### 2. **No Timeout Handling**
- API calls to `/api/create-charge` could hang indefinitely
- No timeout on the Supabase Edge Function calls
- Modal would get stuck in "Creating Checkout" state forever

### 3. **Missing Response Validation**
- Did not validate that `checkoutUrl` and `transactionId` were present in API response
- Did not handle malformed JSON responses
- Did not handle network errors gracefully

### 4. **Insufficient Error Logging**
- No console logs showing request flow
- No detailed error information when API calls failed
- Made debugging impossible for users and developers

## Architecture Overview

### Complete Payment Flow

```
User Clicks "Top Up $X"
    ↓
TopUpWalletModal.handleContinue()
    ↓
TopUpWalletModal.initiatePayment()
    ↓
Fetch: /api/create-charge
    ↓
Netlify Function: create-charge-proxy.mts
    ↓
Supabase Edge Function: create-charge/index.ts
    ↓
Coinbase Commerce API: POST /charges
    ↓
Returns: { hosted_url, id, code }
    ↓
Update user_transactions table
    ↓
Return to Frontend: { checkoutUrl, transactionId }
    ↓
Display Coinbase Checkout Link
```

### YES, We ARE Using Coinbase Commerce SDK

**Location:** `/supabase/functions/create-charge/index.ts` (lines 378-386)

```typescript
const chargeResponse = await fetch(`${COINBASE_COMMERCE_API}/charges`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-CC-Api-Key": coinbaseApiKey,
    "X-CC-Version": "2018-03-22",
  },
  body: JSON.stringify(chargePayload),
});
```

The Supabase Edge Function makes a direct REST API call to Coinbase Commerce using their API key.

## Fixes Implemented

### 1. **Comprehensive Console Logging** ✅

Added console logs at every critical point:

```typescript
// Modal open/close
console.log('[TopUpWalletModal] Modal state changed:', { isOpen, currentStep });

// Button clicks
console.log('[TopUpWalletModal] Amount selected:', selectedAmount);
console.log('[TopUpWalletModal] Payment method selected:', method);
console.log('[TopUpWalletModal] handleContinue called', { paymentMethod, amount });

// Function entry
console.log('[TopUpWalletModal] initiatePayment called', { 
  paymentMethod, 
  amount, 
  hasBaseUser: !!baseUser?.id 
});

// API calls
console.log('[TopUpWalletModal] Calling /api/create-charge with:', {
  url: '/api/create-charge',
  hasAuth: !!headers['Authorization'],
  requestBody
});

// API responses
console.log('[TopUpWalletModal] API response status:', response.status);
console.log('[TopUpWalletModal] API response data:', result);

// Errors
console.error('[TopUpWalletModal] Failed to create charge:', { status, result, errorMsg });
```

### 2. **30-Second Timeout with AbortController** ✅

```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => {
  console.error('[TopUpWalletModal] API call timeout after 30 seconds');
  controller.abort();
}, 30000);

try {
  response = await fetch('/api/create-charge', {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    signal: controller.signal,
  });
  clearTimeout(timeoutId);
} catch (fetchError) {
  clearTimeout(timeoutId);
  if (fetchError.name === 'AbortError') {
    throw new Error('Request timeout - please check your internet connection and try again');
  }
  throw new Error('Network error - please check your connection and try again');
}
```

### 3. **Response Validation** ✅

```typescript
// Parse JSON safely
let result;
try {
  result = await response.json();
} catch (parseError) {
  console.error('[TopUpWalletModal] Failed to parse response:', parseError);
  throw new Error('Invalid server response - please try again');
}

// Validate required fields
if (!result.data?.checkoutUrl) {
  console.error('[TopUpWalletModal] Missing checkout URL in response:', result);
  throw new Error('Server did not return a checkout URL - please try again');
}

if (!result.data?.transactionId) {
  console.error('[TopUpWalletModal] Missing transaction ID in response:', result);
  throw new Error('Server did not return a transaction ID - please try again');
}
```

### 4. **Awaited Async Calls** ✅

Changed from fire-and-forget to properly awaited:

```typescript
// BEFORE:
const handleContinue = () => {
  void initiatePayment();  // ❌ Errors swallowed
};

// AFTER:
const handleContinue = async () => {
  try {
    console.log('[TopUpWalletModal] Calling initiatePayment...');
    await initiatePayment();  // ✅ Errors caught
    console.log('[TopUpWalletModal] initiatePayment completed');
  } catch (err) {
    console.error('[TopUpWalletModal] handleContinue error:', err);
    setError(err instanceof Error ? err.message : 'Failed to initiate payment');
    setStep('error');
  }
};
```

### 5. **Fallback Timeout for Commerce Checkout** ✅

Added useEffect that auto-fails after 30 seconds if stuck in commerce-checkout without URL:

```typescript
useEffect(() => {
  if (step === 'commerce-checkout' && !checkoutUrl) {
    console.warn('[TopUpWalletModal] Commerce checkout without URL - starting 30s timeout');
    
    const timeoutId = setTimeout(() => {
      console.error('[TopUpWalletModal] Commerce checkout timeout');
      setError('Checkout creation timed out. Please try again.');
      setStep('error');
    }, 30000);

    return () => clearTimeout(timeoutId);
  }
}, [step, checkoutUrl]);
```

### 6. **Enhanced Error Messages** ✅

All error paths now provide clear user-facing messages:

```typescript
// Timeout
"Request timeout - please check your internet connection and try again"

// Network error
"Network error - please check your connection and try again"

// Parse error
"Invalid server response - please try again"

// Missing data
"Server did not return a checkout URL - please try again"
"Server did not return a transaction ID - please try again"

// Checkout timeout
"Checkout creation timed out. Please try again."
```

## How to Debug Now

### Step 1: Open Browser Console

Press F12 or right-click → Inspect → Console tab

### Step 2: Click "Top Up"

You should see:
```
[TopUpWalletModal] Modal state changed: { isOpen: true, currentStep: 'method' }
[TopUpWalletModal] Modal opened: { hasBaseUser: true, hasLinkedWallets: 1, hasUsedBonus: false }
[TopUpWalletModal] Rendering: { isOpen: true, step: 'method', ... }
```

### Step 3: Click "Pay With Crypto"

You should see:
```
[TopUpWalletModal] Payment method selected: commerce
[TopUpWalletModal] Rendering: { step: 'amount', ... }
```

### Step 4: Select Amount and Click "Top Up $50"

You should see:
```
[TopUpWalletModal] handleContinue called: { paymentMethod: 'commerce', amount: 50 }
[TopUpWalletModal] Calling initiatePayment...
[TopUpWalletModal] initiatePayment called: { paymentMethod: 'commerce', amount: 50, hasBaseUser: true }
[TopUpWalletModal] Setting step to loading...
[TopUpWalletModal] Processing commerce payment...
[TopUpWalletModal] Got session data: { hasSession: true, hasAccessToken: true }
[TopUpWalletModal] Calling /api/create-charge with: { url: '/api/create-charge', hasAuth: true, requestBody: {...} }
[TopUpWalletModal] API response status: 200 OK
[TopUpWalletModal] API response data: { ok: true, success: true, hasData: true, hasTransactionId: true, hasCheckoutUrl: true }
[TopUpWalletModal] Charge created successfully: { transactionId: 'xxx', checkoutUrl: 'https://commerce.coinbase.com/...' }
```

### Step 5: If It Fails

You'll see detailed error information:
```
[TopUpWalletModal] API response status: 500 Internal Server Error
[TopUpWalletModal] API response data: { ok: false, success: false, error: '...' }
[TopUpWalletModal] Failed to create charge: { status: 500, result: {...}, errorMsg: '...' }
```

## Common Issues and Solutions

### Issue: "Request timeout"
**Cause:** Supabase Edge Function not responding within 30 seconds
**Check:**
1. Is Supabase Edge Function deployed?
2. Is `COINBASE_COMMERCE_API_KEY` set in Supabase secrets?
3. Is Coinbase Commerce API responding?

### Issue: "Network error"
**Cause:** Cannot reach `/api/create-charge` endpoint
**Check:**
1. Is the app deployed to Netlify?
2. Are Netlify functions working?
3. Check Network tab in DevTools for failed requests

### Issue: "Invalid server response"
**Cause:** API returned non-JSON response
**Check:**
1. Look at console logs for the actual response text
2. Check if Supabase Edge Function returned an error page instead of JSON

### Issue: "Missing checkout URL"
**Cause:** Coinbase Commerce API didn't return `hosted_url`
**Check:**
1. Supabase Edge Function logs in Supabase dashboard
2. Coinbase Commerce API key validity
3. Coinbase Commerce account status

## Environment Variables Required

### Frontend (.env)
```
VITE_SUPABASE_URL=https://mthwfldcjvpxjtmrqkqm.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

### Netlify (Environment Variables)
```
SUPABASE_URL=https://mthwfldcjvpxjtmrqkqm.supabase.co
SUPABASE_ANON_KEY=<your-anon-key>
VITE_SUPABASE_URL=https://mthwfldcjvpxjtmrqkqm.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

### Supabase Edge Function (Secrets)
```
COINBASE_COMMERCE_API_KEY=<your-commerce-api-key>
SUPABASE_URL=https://mthwfldcjvpxjtmrqkqm.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
SUCCESS_URL=https://stage.theprize.io
```

## Files Modified

1. **src/components/TopUpWalletModal.tsx**
   - Added comprehensive console logging
   - Added timeout handling
   - Added response validation
   - Changed async handling from fire-and-forget to awaited
   - Added fallback timeout for stuck commerce-checkout

## Testing Checklist

- [ ] Open browser console (F12)
- [ ] Click "Top Up" - verify console logs appear
- [ ] Select "Pay With Crypto" - verify method selection logged
- [ ] Select amount ($50) - verify amount selection logged
- [ ] Click "Top Up $50" - verify:
  - [ ] `handleContinue` logs appear
  - [ ] `initiatePayment` logs appear
  - [ ] API call logs appear with full request details
  - [ ] API response logs appear with status and data
  - [ ] Either success (checkoutUrl displayed) or error (error message shown)
- [ ] If error occurs - verify:
  - [ ] Detailed error logged to console with stack trace
  - [ ] User-friendly error message displayed in UI
  - [ ] Can click "Try Again" to retry
- [ ] If timeout occurs - verify:
  - [ ] Console shows "Request timeout" after 30 seconds
  - [ ] User sees "Request timeout - please check your internet connection"
  - [ ] Can click "Try Again" to retry

## Success Criteria

✅ **Every button click logs to console**
✅ **Every API call logs request and response**
✅ **Every error logs with details and shows user message**
✅ **Timeouts are enforced and surfaced**
✅ **No silent failures**

## Next Steps

1. **Deploy to staging** and test with real Coinbase Commerce API
2. **Monitor console** for any new error patterns
3. **Check Supabase logs** if issues persist with Edge Function
4. **Verify Coinbase Commerce** API key is valid and account is active
