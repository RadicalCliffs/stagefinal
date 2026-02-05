# Complete JWT Usage Audit

## Overview

This document catalogs ALL JWT usage in the codebase after discovering that the application doesn't use Supabase Auth (uses CDP/Base instead).

## Two Types of JWT Usage

### 1. ✅ Coinbase CDP JWTs (WORKING)

These are **legitimate JWTs** generated for Coinbase API authentication. These work correctly.

#### Edge Functions Creating CDP JWTs (7 functions)

| Function | File | Purpose | Status |
|----------|------|---------|--------|
| `onramp-init` | `supabase/functions/onramp-init/index.ts` | Generate JWT for Coinbase Onramp API | ✅ Working |
| `onramp-quote` | `supabase/functions/onramp-quote/index.ts` | Generate JWT for quote API | ✅ Working |
| `onramp-status` | `supabase/functions/onramp-status/index.ts` | Generate JWT for status API | ✅ Working |
| `offramp-init` | `supabase/functions/offramp-init/index.ts` | Generate JWT for Offramp API | ✅ Working |
| `offramp-quote` | `supabase/functions/offramp-quote/index.ts` | Generate JWT for sell quote API | ✅ Working |
| `offramp-status` | `supabase/functions/offramp-status/index.ts` | Generate JWT for offramp status | ✅ Working |

**JWT Generation Pattern:**
```typescript
// Create JWT header per Coinbase specification
const header = {
  alg: "ES256",
  typ: "JWT",
  kid: keyName,
};

// Create JWT payload
const payload = {
  sub: keyName,
  iss: "coinbase-cloud",
  nbf: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 120,
  aud: ["cdp_service"],
};

// Sign and use
const jwt = await generateCdpJwt(API_URL);
headers['Authorization'] = `Bearer ${jwt}`;
```

---

### 2. ❌ Supabase Auth JWTs (BROKEN - Never Created)

These are **expected but never created** because the app uses CDP/Base, not Supabase Auth.

#### Frontend Files Calling `supabase.auth.getSession()` 

All these calls return **null/undefined** because no Supabase Auth session exists.

##### Core Libraries (9 files)

| File | Line(s) | Context | Fallback |
|------|---------|---------|----------|
| `src/lib/reserve-tickets-redundant.ts` | 50 | Get token for Authorization header | None - just skips header |
| `src/lib/base-payment.ts` | 90 | Get access token | Privy localStorage |
| `src/lib/base-account-payment.ts` | 50 | Get access token | Privy localStorage |
| `src/lib/competition-state.ts` | 30 | Get auth token | Privy localStorage |
| `src/lib/notification-service.ts` | 35 | Get auth token | Privy localStorage |
| `src/lib/vrf-debug.ts` | 56 | Get access token | Privy localStorage |
| `src/lib/secure-api.ts` | 85 | Get access token | Privy localStorage |
| `src/lib/coinbase-commerce.ts` | 65 | Get token for headers | None |
| `src/lib/onchainkit-checkout.ts` | 62 | Get token for checkout | None |

**Code Pattern:**
```typescript
// This ALWAYS returns null session
const { data: sessionData } = await supabase.auth.getSession();
const session = sessionData?.session; // null

// Token is undefined
const token = session?.access_token; // undefined

// Authorization header is empty or uses anon key
if (token) {
  headers['Authorization'] = `Bearer ${token}`; // Never executed
}
```

##### Hooks (1 file)

| File | Line(s) | Context | Fallback |
|------|---------|---------|----------|
| `src/hooks/useInstantWinTickets.ts` | 30 | Get access token for instant win checks | Privy localStorage |

##### Components (1 file)

| File | Line(s) | Context | Fallback |
|------|---------|---------|----------|
| `src/components/TopUpWalletModal.tsx` | 211, 369, 486 | Get session token (3 locations) | None or walletToken |

**TopUpWalletModal Pattern:**
```typescript
// Location 1 (line 211)
const { data: sessionData } = await supabase.auth.getSession();
if (sessionData.session?.access_token) {
  headers['Authorization'] = `Bearer ${sessionData.session.access_token}`;
}

// Location 2 (line 369)
const { data: sessionData } = await supabase.auth.getSession();
const authToken = sessionData.session?.access_token || walletToken;

// Location 3 (line 486)
const { data: sessionData } = await supabase.auth.getSession();
const token = sessionData.session?.access_token;
```

---

### 3. 🔐 Service Role Key Usage (WORKING)

These edge functions use service role keys (not JWTs) for elevated privileges:

| Function | File | Purpose |
|----------|------|---------|
| `select-competition-winners` | `supabase/functions/select-competition-winners/index.ts` | Admin operation |
| `update-user-avatar` | `supabase/functions/update-user-avatar/index.ts` | File upload auth |
| `payments-auto-heal` | `supabase/functions/payments-auto-heal/index.ts` | Payment reconciliation |
| `reconcile-payments` | `supabase/functions/reconcile-payments/index.ts` | Payment sync |
| `update-competition-status` | `supabase/functions/update-competition-status/index.ts` | Competition management |
| `vrf-status-checker` | `supabase/functions/vrf-status-checker/index.ts` | VRF monitoring |
| `vrf-full-test` | `supabase/functions/vrf-full-test/index.ts` | VRF testing |
| `onramp-webhook` | `supabase/functions/onramp-webhook/index.ts` | Webhook processing |
| `confirm-pending-tickets` | `supabase/functions/confirm-pending-tickets/index.ts` | Ticket confirmation |
| `commerce-webhook` | `supabase/functions/commerce-webhook/index.ts` | Commerce events |

**Pattern:**
```typescript
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
headers['Authorization'] = `Bearer ${serviceRoleKey}`;
```

---

## Defunct Privy Token References

**7 files** check `localStorage.getItem('privy:access_token')` but Privy is no longer used:

1. `src/lib/competition-state.ts:24-25`
2. `src/lib/notification-service.ts:29`
3. `src/lib/vrf-debug.ts:35`
4. `src/lib/base-account-payment.ts:43`
5. `src/lib/base-payment.ts:69`
6. `src/lib/secure-api.ts:63`
7. `src/hooks/useInstantWinTickets.ts:25`

**Pattern:**
```typescript
const privyToken = localStorage.getItem('privy:token') ||
                   localStorage.getItem('privy:access_token');
if (privyToken) {
  return privyToken; // Never happens - Privy not used
}
```

---

## Impact Analysis

### What Happens When getSession Returns Null?

#### Scenario 1: Authorization Header (6 files)
```typescript
// reserve-tickets-redundant.ts, coinbase-commerce.ts, TopUpWalletModal.tsx (3x)
const { data: sessionData } = await supabase.auth.getSession();
if (session?.access_token) {
  headers['Authorization'] = `Bearer ${session.access_token}`;
}
// Result: No Authorization header set, or uses default anon key
```

#### Scenario 2: Token Fallback (7 files)
```typescript
// competition-state.ts, notification-service.ts, etc.
const privyToken = localStorage.getItem('privy:access_token');
if (privyToken) return privyToken;

const { data: { session } } = await supabase.auth.getSession();
if (session?.access_token) return session.access_token;

return null; // Always reaches here
```

#### Scenario 3: Direct Usage (4 files)
```typescript
// onchainkit-checkout.ts, vrf-debug.ts, secure-api.ts, base-payment.ts
const { data: sessionData } = await supabase.auth.getSession();
const token = sessionData.session?.access_token;
// Result: token is undefined
```

### Why Things Still Work

1. **Edge functions use service role key** - Bypass RLS, don't need user JWT
2. **Frontend auth prevents UI access** - CDP/Base controls what users see
3. **Database RLS provides data protection** - Row-level security still works
4. **Code gracefully handles missing tokens** - No crashes, just uses anon key

### Security Implications

**Without JWT verification:**
- Edge functions can't cryptographically verify user identity
- Must trust `userId` from request body
- User impersonation possible if attacker knows canonical user ID
- See `AUTHENTICATION_ARCHITECTURE.md` for details

---

## Detailed File List

### Files to Update (Remove Dead Code)

#### High Priority - Active getSession Calls (11 files)

1. **`src/lib/reserve-tickets-redundant.ts`**
   - Line 50: `await supabase.auth.getSession()`
   - Usage: Authorization header for reserve-tickets edge function
   - Impact: Header is empty, uses anon key
   - Fix: Remove getSession call, document that anon key is used

2. **`src/lib/base-payment.ts`**
   - Line 90: `await supabase.auth.getSession()`
   - Line 69: Checks `localStorage.getItem('privy:access_token')`
   - Usage: Get token for payment operations
   - Impact: Always returns null
   - Fix: Remove both Privy and Supabase session checks

3. **`src/lib/base-account-payment.ts`**
   - Line 50: `await supabase.auth.getSession()`
   - Line 43: Checks `localStorage.getItem('privy:access_token')`
   - Usage: Get token for Base Account payments
   - Impact: Always returns null
   - Fix: Remove both checks

4. **`src/lib/competition-state.ts`**
   - Line 30: `await supabase.auth.getSession()`
   - Line 24-25: Checks `localStorage.getItem('privy:access_token')`
   - Usage: Get auth token for competition state updates
   - Impact: Always returns null
   - Fix: Remove both checks

5. **`src/lib/notification-service.ts`**
   - Line 35: `await supabase.auth.getSession()`
   - Line 29: Checks `localStorage.getItem('privy:access_token')`
   - Usage: Get token for notification operations
   - Impact: Always returns null
   - Fix: Remove both checks

6. **`src/lib/vrf-debug.ts`**
   - Line 56: `await supabase.auth.getSession()`
   - Line 35: Checks `localStorage.getItem('privy:access_token')`
   - Usage: Debug token for VRF operations
   - Impact: Always returns null
   - Fix: Remove both checks

7. **`src/lib/secure-api.ts`**
   - Line 85: `await supabase.auth.getSession()`
   - Line 63: Checks `localStorage.getItem('privy:access_token')`
   - Usage: Get token for secure API calls
   - Impact: Always returns null
   - Fix: Remove both checks

8. **`src/lib/coinbase-commerce.ts`**
   - Line 65: `await supabase.auth.getSession()`
   - Usage: Get token for Coinbase Commerce header
   - Impact: Token is undefined
   - Fix: Remove getSession call

9. **`src/lib/onchainkit-checkout.ts`**
   - Line 62: `await supabase.auth.getSession()`
   - Usage: Get token for OnchainKit checkout
   - Impact: Token is undefined
   - Fix: Remove getSession call

10. **`src/hooks/useInstantWinTickets.ts`**
    - Line 30: `await supabase.auth.getSession()`
    - Line 25: Checks `localStorage.getItem('privy:access_token')`
    - Usage: Get token for instant win ticket checks
    - Impact: Always returns null
    - Fix: Remove both checks

11. **`src/components/TopUpWalletModal.tsx`**
    - Line 211: `await supabase.auth.getSession()`
    - Line 369: `await supabase.auth.getSession()`
    - Line 486: `await supabase.auth.getSession()`
    - Usage: Get session token for top-up operations (3 locations)
    - Impact: Always undefined
    - Fix: Remove all 3 getSession calls

---

## Recommended Actions

### Phase 1: Documentation (Quick)

Add comments to all getSession calls explaining why they don't work:

```typescript
// NOTE: This returns null because app uses CDP/Base auth, not Supabase Auth.
// Edge functions receive anon key in Authorization header.
const { data: sessionData } = await supabase.auth.getSession();
```

### Phase 2: Cleanup (Medium)

Remove all dead code:
1. Remove 11 `supabase.auth.getSession()` calls
2. Remove 7 `localStorage.getItem('privy:access_token')` checks
3. Simplify logic since tokens are always null

### Phase 3: Security Enhancement (Long-term)

Implement proper authentication:
1. Wallet signature verification
2. Custom JWT system integrated with CDP/Base
3. Or session tokens stored in database

See `AUTHENTICATION_ARCHITECTURE.md` for implementation options.

---

## Summary Statistics

| Category | Count | Status |
|----------|-------|--------|
| **Total Edge Functions** | 92 | Audited |
| **CDP JWT Functions** | 7 | ✅ Working |
| **Service Role Functions** | 10+ | ✅ Working |
| **Broken getSession Calls** | 11 files | ❌ Dead code |
| **Defunct Privy Checks** | 7 files | ⚠️ Dead code |
| **Files Needing Cleanup** | 11 | Action required |

---

## Testing Verification

To verify these findings:

```typescript
// In browser console on any page:
const { data } = await supabase.auth.getSession();
console.log('Session:', data.session);
// Output: null or undefined

// Check localStorage:
console.log('Privy token:', localStorage.getItem('privy:access_token'));
// Output: null

// Check what's actually in storage:
console.log('All auth keys:', Object.keys(localStorage).filter(k => 
  k.includes('auth') || k.includes('privy') || k.includes('cdp')
));
// Output: CDP keys exist, Supabase/Privy auth keys don't
```

---

**Audit Date:** February 5, 2026  
**Status:** Complete  
**Next Action:** Remove dead code or add documentation comments
