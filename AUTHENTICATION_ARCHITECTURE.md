# Authentication Architecture & Security Analysis

## Executive Summary

This document explains the authentication system used by theprize.io and why the proposed JWT validation approach won't work.

### Key Finding

**The application uses CDP/Base by Coinbase for authentication, NOT Supabase Auth.**

This means:
- ❌ No Supabase Auth sessions exist
- ❌ No Supabase JWTs are issued
- ❌ JWT validation in edge functions won't work
- ✅ Must use alternative security approaches

---

## Authentication Flow

### 1. User Sign-In

**CDP/Base Authentication:**
```typescript
// User authenticates with Base/CDP
import { useCurrentUser, useIsSignedIn, useEvmAddress } from '@coinbase/cdp-hooks';

const { currentUser } = useCurrentUser();  // Gets CDP user
const { isSignedIn } = useIsSignedIn();     // Checks CDP status
const { evmAddress } = useEvmAddress();     // Gets wallet address
```

**What Happens:**
1. User connects wallet via Base/CDP
2. CDP SDK creates a session (CDP session, not Supabase)
3. User ID is the wallet address
4. No Supabase Auth session is created

### 2. Making API Calls

**Frontend Code:**
```typescript
const { data, error } = await supabase.functions.invoke('lucky-dip-reserve', {
  body: {
    userId: baseUser.id,  // Wallet address from CDP
    competitionId,
    count
  }
});
```

**What Gets Sent:**
- Request body: `{ userId, competitionId, count }`
- Authorization header: `Bearer <SUPABASE_ANON_KEY>` (NOT a user JWT)

**Why anon key?**
- Supabase client checks for active session
- No Supabase Auth session exists
- Falls back to anon key from client config

### 3. Edge Function Receives Request

**Current Code:**
```typescript
// Edge function receives:
// - headers.authorization = "Bearer <anon-key>"
// - body.userId = wallet address

const { userId, competitionId, count } = await req.json();
const canonicalUserId = toPrizePid(userId);
// Uses userId from body without verification
```

---

## Why JWT Validation Won't Work

### The Proposed Approach

```typescript
// ❌ This won't work
const authHeader = req.headers.get('authorization') || '';
const accessToken = authHeader.slice(7);  // Gets anon key, not user JWT

const userClient = createClient(supabaseUrl, anonKey);
await userClient.auth.setAuth(accessToken);  // Sets anon key as token
const { data: { user } } = await userClient.auth.getUser();  // FAILS - no user session
```

### What Actually Happens

1. `accessToken` contains the **anon key**, not a user JWT
2. `setAuth(accessToken)` tries to use anon key as user token
3. `getUser()` fails because anon key isn't a valid user session
4. **Result**: 401 "Invalid or expired token" for ALL requests

### Why No Supabase JWT Exists

**Supabase JWT Creation:**
```typescript
// These create Supabase JWTs (NOT used in this app):
await supabase.auth.signInWithPassword({ email, password });
await supabase.auth.signInWithOAuth({ provider: 'google' });
await supabase.auth.signUp({ email, password });
```

**What This App Does:**
```typescript
// CDP/Base handles auth (NO Supabase JWTs created):
import { useCurrentUser } from '@coinbase/cdp-hooks';
const { currentUser } = useCurrentUser();
```

---

## Security Implications

### Current Security Model

**Protection Layers:**

1. **Frontend Auth** (CDP/Base)
   - Prevents UI access without authentication
   - User must connect wallet to see features

2. **Database RLS** (Supabase)
   - Row Level Security policies enforce data access
   - Users can only query their own data

3. **Edge Function Validation** (Basic)
   - Validates input format
   - Checks user ID exists
   - **Does NOT verify user identity cryptographically**

### Security Gaps

**User Impersonation Risk:**
```typescript
// Attacker could send:
await supabase.functions.invoke('lucky-dip-reserve', {
  body: {
    userId: "prize:pid:victim-wallet-address",  // Spoofed
    competitionId,
    count
  }
});
// Edge function trusts this userId without verification
```

**Risk Assessment:**
- 🔴 **HIGH** if attacker knows victim's canonical user ID
- 🟡 **MEDIUM** because attacker needs to know the format
- 🟢 **LOW** impact on database (RLS protects data reads)
- 🔴 **HIGH** impact on reservations (could create unauthorized reservations)

---

## Alternative Security Solutions

### Option 1: Wallet Signature Verification ⭐ Recommended

**How It Works:**
```typescript
// Frontend: User signs message
const message = `Reserve ${count} tickets for ${competitionId}`;
const signature = await wallet.signMessage(message);

await supabase.functions.invoke('lucky-dip-reserve', {
  body: {
    userId,
    competitionId,
    count,
    signature,  // Cryptographic proof
    message
  }
});
```

```typescript
// Edge function: Verify signature
import { verifyMessage } from 'ethers';

const recoveredAddress = verifyMessage(message, signature);
if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
  return errorResponse("Invalid signature", 403, corsHeaders);
}
```

**Pros:**
- ✅ Standard Web3 security pattern
- ✅ Cryptographic proof of wallet ownership
- ✅ No custom auth service needed
- ✅ Works with CDP/Base auth

**Cons:**
- ⚠️ Requires signature for each request (UX consideration)
- ⚠️ Need to implement signature verification library

### Option 2: Custom JWT System

**How It Works:**
```typescript
// Create JWT service
const jwt = await createJWT({
  userId: canonicalUserId,
  walletAddress,
  exp: Date.now() + 3600000
}, SECRET_KEY);

// Store in Supabase client
supabase.auth.setSession({ access_token: jwt });

// Verify in edge function
const payload = verifyJWT(token, SECRET_KEY);
```

**Pros:**
- ✅ Standard JWT pattern
- ✅ Can include additional claims
- ✅ Timeout/expiry built-in

**Cons:**
- ⚠️ Requires custom JWT service
- ⚠️ Must integrate with CDP/Base auth flow
- ⚠️ Key management complexity

### Option 3: Session Tokens

**How It Works:**
```typescript
// Generate session token on login
const sessionToken = crypto.randomUUID();
await supabase.from('user_sessions').insert({
  user_id: canonicalUserId,
  session_token: sessionToken,
  expires_at: new Date(Date.now() + 3600000)
});

// Send with requests
await supabase.functions.invoke('lucky-dip-reserve', {
  body: { sessionToken, ... }
});

// Verify in edge function
const session = await supabase
  .from('user_sessions')
  .select('user_id')
  .eq('session_token', sessionToken)
  .single();
```

**Pros:**
- ✅ Simple to implement
- ✅ Server-side validation
- ✅ Easy to revoke

**Cons:**
- ⚠️ Database query for each request
- ⚠️ Session management required
- ⚠️ Must handle expiry/cleanup

### Option 4: Rate Limiting + RLS (Minimal)

**Current Approach - No Additional Auth:**

**Pros:**
- ✅ Already implemented
- ✅ Database RLS prevents data theft
- ✅ No code changes needed

**Cons:**
- ❌ No protection against user impersonation
- ❌ Attacker can create reservations for others
- ❌ Relies on security through obscurity

---

## Recommendation

### Immediate: Keep Current Implementation

**Reason:** JWT validation doesn't work without infrastructure changes

### Short-term: Implement Wallet Signature Verification

**Priority:** HIGH

**Effort:** 2-3 days

**Steps:**
1. Add signature generation to frontend (ethers.js)
2. Add signature verification to edge functions
3. Update all sensitive endpoints
4. Test with various wallets

### Long-term: Consider Custom JWT System

**Priority:** MEDIUM

**Effort:** 1-2 weeks

**Steps:**
1. Design JWT service architecture
2. Integrate with CDP/Base auth
3. Update Supabase client configuration
4. Migrate all edge functions
5. Handle JWT refresh/expiry

---

## Implementation Status

### What Was Done

✅ **Analyzed** authentication architecture
✅ **Identified** CDP/Base as auth provider
✅ **Discovered** no Supabase Auth usage
✅ **Reverted** JWT validation code
✅ **Documented** why JWT won't work
✅ **Proposed** alternative solutions

### What Was NOT Done

❌ JWT validation (doesn't work with current auth)
❌ Wallet signature verification (not yet implemented)
❌ Custom JWT system (not yet implemented)
❌ Session token system (not yet implemented)

---

## Technical Details

### Supabase Client Configuration

```typescript
// src/lib/supabase.ts
const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,  // For Supabase Auth (not used)
    autoRefreshToken: true,  // For Supabase Auth (not used)
  }
});
```

**Key Point:** These auth options are for Supabase Auth sessions, which don't exist in this app.

### CDP/Base Integration

```typescript
// src/contexts/AuthContext.tsx
const { currentUser } = useCurrentUser();  // CDP SDK
const { isSignedIn } = useIsSignedIn();    // CDP SDK

// baseUser structure:
interface BaseUser {
  id: string;  // Wallet address
  email?: string;
  wallet?: { address: string };
}
```

### Edge Function Invocation

```typescript
// How it works:
1. Client: supabase.functions.invoke('function-name', { body })
2. SDK checks: supabase.auth.getSession()
3. No session found (because no Supabase Auth)
4. SDK uses: Authorization: Bearer <anon-key>
5. Edge function receives anon key (not user JWT)
```

---

## Conclusion

**The app uses CDP/Base for authentication, not Supabase Auth.**

**JWT validation cannot work without:**
1. Creating Supabase Auth sessions when users authenticate with CDP/Base
2. Modifying the Supabase client to use custom JWTs
3. Implementing JWT generation/verification infrastructure

**Recommended next step:**
Implement wallet signature verification for secure, cryptographic proof of user identity that works with the existing CDP/Base authentication system.

---

**Document Status:** Complete
**Last Updated:** 2026-02-05
**Author:** Copilot Engineering Agent
