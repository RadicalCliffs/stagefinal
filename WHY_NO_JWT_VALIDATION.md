# Why JWT Validation Won't Work in This App

## Authentication Architecture Discovery

### The Problem with the Proposed JWT Validation

The JWT validation approach that was proposed (and initially implemented) **will not work** for this application because:

**This app does NOT use Supabase Auth.**

### Actual Authentication System

**Current Auth Stack:**
1. **Primary**: CDP/Base by Coinbase (`@coinbase/cdp-hooks`)
   - `useCurrentUser()` - Gets current CDP user
   - `useIsSignedIn()` - Checks CDP sign-in status
   - `useEvmAddress()` - Gets wallet address

2. **Secondary**: Wagmi (for external wallet connections)
   - `useAccount()` - Gets connected wallet
   - `useDisconnect()` - Disconnects wallet

3. **NOT using Supabase Auth**
   - No `signInWithEmail()`, `signInWithPassword()`, or `signInWithOAuth()`
   - No Supabase session creation
   - No Supabase JWT tokens

### How Authentication Actually Works

```typescript
// AuthContext.tsx - Uses CDP/Base, NOT Supabase
const { currentUser } = useCurrentUser();  // CDP hook, not Supabase
const { isSignedIn } = useIsSignedIn();     // CDP hook, not Supabase
const { evmAddress } = useEvmAddress();     // CDP hook, not Supabase
```

### What Gets Sent in Authorization Header?

When the frontend calls `supabase.functions.invoke()`:

```typescript
const { data, error } = await supabase.functions.invoke('lucky-dip-reserve', {
  body: { userId, competitionId, count }
});
```

The Supabase JS SDK automatically adds an Authorization header, but it contains:
- **NOT a user JWT** (because no Supabase session exists)
- **The Supabase anon key** (from the client configuration)

### Why the JWT Validation Failed

The implementation tried to:
```typescript
// Extract JWT from Authorization header
const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

// Validate with Supabase Auth
const { data: { user }, error } = await userClient.auth.getUser();
```

**Problem:** There is no user JWT to extract! The Authorization header contains the anon key, not a user token.

**Result:** All requests would fail with "401 Missing bearer token" or "401 Invalid or expired token"

### Current Security Model

Without JWT validation, the security relies on:

1. **Row Level Security (RLS)** in Supabase database
   - Database policies enforce data access control
   - Users can only access their own data

2. **Database-level validation**
   - Edge functions use service role key for elevated operations
   - Trust model: Backend validates user ownership through database queries

3. **Frontend authentication**
   - CDP/Base handles user authentication
   - Frontend prevents UI access to unauthorized actions

### Security Implications

**User Impersonation Risk:**
- ❌ An attacker COULD potentially send a request with another user's `userId`
- ❌ Without JWT validation, the edge function trusts the `userId` in the request body
- ❌ This is a real security vulnerability

**But JWT validation won't fix it because:**
- There's no Supabase JWT to validate
- CDP/Base auth doesn't provide JWTs that Supabase can verify

### Alternative Security Solutions

To properly secure this function, you would need to:

#### Option 1: Custom JWT System (Complex)
1. Create a custom auth service that issues JWTs when users authenticate with CDP/Base
2. Modify the Supabase client to attach these custom JWTs to requests
3. Implement custom JWT verification in edge functions
4. **Effort:** High (requires new auth service, JWT signing/verification)

#### Option 2: Wallet Signature Verification (Recommended)
1. User signs a message with their wallet
2. Edge function verifies the signature matches the wallet address
3. Uses cryptographic proof instead of JWTs
4. **Effort:** Medium (requires signature generation and verification)

#### Option 3: Database-Only Validation (Current)
1. Rely solely on RLS policies in the database
2. Accept the trust model where edge functions validate user ownership
3. Add rate limiting to prevent abuse
4. **Effort:** Low (already implemented)

#### Option 4: API Keys/Sessions (Middle Ground)
1. Generate API keys when users authenticate with CDP/Base
2. Store keys in Supabase
3. Validate keys in edge functions
4. **Effort:** Medium (requires key management system)

### Recommendation

**For now: Keep the simpler model without JWT validation**

**Reasons:**
1. JWT validation won't work without significant infrastructure changes
2. Database RLS provides data-level security
3. The attack surface is limited (attacker needs to know victim's user ID)
4. Adding proper security requires choosing a solution (wallet signatures, custom JWTs, etc.)

**Future improvement: Implement wallet signature verification**
- More secure than JWTs for wallet-based auth
- Doesn't require custom auth service
- Standard practice in Web3 apps

### What Was Reverted

Removed the JWT validation code from `lucky-dip-reserve/index.ts`:
- ❌ JWT extraction from Authorization header
- ❌ Supabase auth client creation with anon key
- ❌ User verification with `auth.getUser()`
- ❌ User ID mismatch checks
- ✅ Kept input normalization (count, ticketPrice)

### Files Modified

- **Reverted**: `supabase/functions/lucky-dip-reserve/index.ts`
  - Removed JWT validation (lines 142-187 → simplified to lines 142-179)
  - Kept numeric input normalization
  - Restored simpler Supabase client setup

- **Removed**: JWT validation documentation
  - `JWT_VALIDATION_SUMMARY.md` (deleted)
  - `JWT_VALIDATION_QUICK_REF.md` (deleted)

- **Created**: This explanation document

### Summary

**The app uses CDP/Base for auth, not Supabase Auth.**
**Therefore, there are no Supabase JWTs to validate.**
**JWT validation was reverted to prevent breaking all Lucky Dip reservations.**

To add proper security, implement wallet signature verification or a custom JWT system that integrates with CDP/Base auth.
