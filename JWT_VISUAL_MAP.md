# JWT Usage - Visual Map

```
┌─────────────────────────────────────────────────────────────────┐
│                    JWT USAGE IN CODEBASE                        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────┐
│  COINBASE CDP JWTs  │  ✅ WORKING (7 files)
│   (For Coinbase)    │
└─────────────────────┘
         │
         ├─ onramp-init         ✅ Generates JWT for Coinbase API
         ├─ onramp-quote        ✅ Generates JWT for quotes
         ├─ onramp-status       ✅ Generates JWT for status
         ├─ offramp-init        ✅ Generates JWT for offramp
         ├─ offramp-quote       ✅ Generates JWT for sell quotes
         └─ offramp-status      ✅ Generates JWT for status

┌─────────────────────┐
│ SUPABASE AUTH JWTs  │  ❌ BROKEN (11 files)
│  (Never created)    │
└─────────────────────┘
         │
         ├─ LIBRARIES (9 files)
         │   ├─ reserve-tickets-redundant.ts      ❌ Line 50
         │   ├─ base-payment.ts                   ❌ Line 90
         │   ├─ base-account-payment.ts           ❌ Line 50
         │   ├─ competition-state.ts              ❌ Line 30
         │   ├─ notification-service.ts           ❌ Line 35
         │   ├─ vrf-debug.ts                      ❌ Line 56
         │   ├─ secure-api.ts                     ❌ Line 85
         │   ├─ coinbase-commerce.ts              ❌ Line 65
         │   └─ onchainkit-checkout.ts            ❌ Line 62
         │
         ├─ HOOKS (1 file)
         │   └─ useInstantWinTickets.ts           ❌ Line 30
         │
         └─ COMPONENTS (1 file)
             └─ TopUpWalletModal.tsx              ❌ Lines 211, 369, 486

┌─────────────────────┐
│  PRIVY FALLBACKS    │  ⚠️ DEFUNCT (7 files)
│  (No longer used)   │
└─────────────────────┘
         │
         ├─ competition-state.ts                  ⚠️ Line 24-25
         ├─ notification-service.ts               ⚠️ Line 29
         ├─ vrf-debug.ts                          ⚠️ Line 35
         ├─ base-account-payment.ts               ⚠️ Line 43
         ├─ base-payment.ts                       ⚠️ Line 69
         ├─ secure-api.ts                         ⚠️ Line 63
         └─ useInstantWinTickets.ts               ⚠️ Line 25
```

---

## Call Flow Diagram

```
┌──────────────┐
│   FRONTEND   │
└──────┬───────┘
       │
       │ 1. User authenticates with CDP/Base
       │    (NOT Supabase Auth)
       │
       ▼
┌──────────────────────────────────────┐
│  supabase.auth.getSession()          │
│  ❌ Returns: { session: null }       │
└──────┬───────────────────────────────┘
       │
       │ 2. Try to get access_token
       │    Result: undefined
       │
       ▼
┌──────────────────────────────────────┐
│  Check Privy localStorage            │
│  ⚠️ Returns: null (Privy not used)   │
└──────┬───────────────────────────────┘
       │
       │ 3. Fallback to anon key or skip
       │
       ▼
┌──────────────────────────────────────┐
│  Edge Function Call                  │
│  - Authorization: Bearer <anonkey>   │
│  OR                                  │
│  - No Authorization header           │
└──────┬───────────────────────────────┘
       │
       │ 4. Edge function uses service role
       │    (Has elevated permissions)
       │
       ▼
┌──────────────────────────────────────┐
│  Database Operation                  │
│  ✅ Works (service role bypasses RLS)│
└──────────────────────────────────────┘
```

---

## Authentication Flow (Actual)

```
┌─────────────┐
│    USER     │
└─────┬───────┘
      │
      │ Connects wallet
      ▼
┌─────────────────┐
│   CDP/BASE SDK  │ ✅ Handles authentication
└─────┬───────────┘
      │
      │ Sets wallet address as user ID
      ▼
┌─────────────────────────┐
│  FRONTEND (React)       │
│  - Shows UI if authed   │
│  - Hides UI if not      │
└─────┬───────────────────┘
      │
      │ Makes API calls with userId in body
      ▼
┌─────────────────────────┐
│  SUPABASE CLIENT        │
│  - Checks for session   │ ❌ No session exists
│  - Uses anon key        │ ✅ Falls back to this
└─────┬───────────────────┘
      │
      │ Authorization: Bearer <anonkey>
      ▼
┌─────────────────────────┐
│  EDGE FUNCTION          │
│  - Gets userId from body│
│  - Trusts it (no verify)│ ⚠️ Security gap
│  - Uses service role    │ ✅ Has permissions
└─────┬───────────────────┘
      │
      │ Service role key
      ▼
┌─────────────────────────┐
│  DATABASE               │
│  - RLS bypassed         │ ✅ Service role
│  - Operation succeeds   │ ✅ Works
└─────────────────────────┘
```

---

## Code Pattern Examples

### ✅ WORKING: Coinbase CDP JWT
```typescript
// Edge function generates its own JWT
const jwt = await generateCdpJwt(COINBASE_API_URL);

// Uses it for Coinbase API
fetch(COINBASE_API_URL, {
  headers: {
    'Authorization': `Bearer ${jwt}`  // ✅ Valid JWT
  }
});
```

### ❌ BROKEN: Supabase Auth JWT
```typescript
// Frontend tries to get Supabase session
const { data: sessionData } = await supabase.auth.getSession();
// ❌ Returns: { session: null }

const token = sessionData.session?.access_token;
// ❌ token is undefined

if (token) {
  headers['Authorization'] = `Bearer ${token}`;
  // ❌ This never executes
}

// Falls back to anon key or no header
```

### ⚠️ DEFUNCT: Privy Fallback
```typescript
// Check Privy first (before Supabase)
const privyToken = localStorage.getItem('privy:access_token');
// ⚠️ Always null - Privy not used anymore

if (privyToken) {
  return privyToken;
  // ⚠️ Never reaches here
}

// Then try Supabase (also fails)
const { data: { session } } = await supabase.auth.getSession();
return session?.access_token || null;
// Returns null
```

---

## Statistics

```
┌──────────────────────────────────┐
│       FILE BREAKDOWN             │
├──────────────────────────────────┤
│ ✅ Coinbase CDP JWTs:        7   │
│ ❌ Supabase getSession:     11   │
│ ⚠️ Privy localStorage:       7   │
├──────────────────────────────────┤
│ Total JWT-related files:    18   │
│                                  │
│ Total edge functions:       92   │
│ Edge funcs using JWTs:       7   │
│ Edge funcs using service:   10+  │
└──────────────────────────────────┘
```

---

## Priority Map

```
HIGH PRIORITY (Security Risk)
├─ Add JWT verification to edge functions
├─ Or implement wallet signatures
└─ Or create custom JWT system

MEDIUM PRIORITY (Code Cleanup)
├─ Remove 11 getSession calls
├─ Remove 7 Privy checks
└─ Simplify auth token logic

LOW PRIORITY (Documentation)
├─ Add comments explaining failures
└─ Update auth flow diagrams

NO ACTION NEEDED
├─ Coinbase CDP JWTs (working)
└─ Service role keys (working)
```

---

## Quick Reference

**Question:** "Does this file use JWT?"

**Check:**
1. **Coinbase functions?** → ✅ Yes, legitimate CDP JWT
2. **Calls getSession()?** → ❌ Yes, but broken (returns null)
3. **Checks Privy localStorage?** → ⚠️ Yes, but defunct (returns null)
4. **Uses service role key?** → ✅ Yes, working (not JWT)

**Action:**
- Coinbase: Keep
- getSession: Remove or document
- Privy: Remove
- Service role: Keep

---

**See full details in:**
- `JWT_USAGE_COMPLETE_AUDIT.md` - Complete file list
- `JWT_AUDIT_SUMMARY.md` - Quick summary
- `AUTHENTICATION_ARCHITECTURE.md` - Why JWT doesn't work
