# Duplicate User Creation Fix - Implementation Summary

## Problem Statement
Users reported that duplicate user records were being created during signup via Base Wallet with email verification, despite previous fixes.

## Error Logs Analysis
```
[BaseWallet] Calling upsert-user with form data: {username: 'bob', email: 'max@teamstack.xyz', ...}
[BaseWallet] User created successfully with wallet linked: {success: true, user: {...}}
[AuthContext] Auth complete event received: {walletAddress: '0x1096DA959A...', email: 'max@teamstack.xyz'}
[AuthContext] Refresh already in progress, skipping  <-- ISSUE: First call ongoing
[AuthContext] refreshUserData called with: {effectiveEmail: undefined, ...}  <-- ISSUE: No email!
[user-auth] Step 4: Looking up by email: undefined  <-- ISSUE: Email lookup fails
[user-auth] Step 5: Creating new user with canonical ID  <-- ISSUE: Duplicate created
[user-auth] ✅ Created new user: 25469a34-2f29-4441-9841-55f3d544158e
[AuthContext] User profile loaded: {email: null, id: '25469a34-2f29-4441-9841-55f3d544158e', ...}
```

## Root Cause

The race condition occurs between two competing `refreshUserData` calls:

### Timeline of Events

```
T0: User completes Base Wallet signup
T1: upsert-user edge function creates user (email + wallet)
T2: BaseWalletAuthModal dispatches auth-complete event {walletAddress, email}
T3: handleAuthComplete event handler:
    - Sets authCompleteHandledRef.current = Date.now()
    - Resets initialFetchDoneRef = false
    - Resets lastFetchedUserIdRef = null
    - Calls refreshUserData(email) ✅
T4: refreshUserData starts (email provided)
T5: effectiveWalletAddress becomes available in React state
T6: handleAuthStateChange effect triggers (dependency: effectiveWalletAddress)
T7: Check: lastFetchedUserIdRef !== effectiveWalletAddress (it was reset at T3)
T8: Check: timeSinceAuthComplete = Date.now() - authCompleteHandledRef.current
T9: If timeSinceAuthComplete < 2000ms:
    - Skip redundant refresh ✅ (NEW FIX)
    - Mark as fetched to prevent future triggers
    Else if timeSinceAuthComplete >= 2000ms:
    - Call refreshUserData() ❌ (without email)
```

### The Problem

**Before the fix:**
- The `handleAuthStateChange` effect would call `refreshUserData()` without the email parameter
- This happened when the first `refreshUserData(email)` call completed quickly (< 100ms)
- The `refreshInProgressRef` guard prevented concurrent calls, but not sequential ones
- Once the first call completed, the guard was released
- The `handleAuthStateChange` effect would trigger and call `refreshUserData()` without email
- This caused `getOrCreateUser` to look up by `email: undefined`, failing to find the existing user
- Step 5 would then create a duplicate user

## Solution Implemented

### Changes to `src/contexts/AuthContext.tsx`

#### 1. Added timestamp tracking for auth-complete event
```typescript
// Track when auth-complete event was handled to prevent race condition with handleAuthStateChange
const authCompleteHandledRef = useRef<number>(0);
```

#### 2. Modified `handleAuthComplete` to record timestamp
```typescript
const handleAuthComplete = (event: CustomEvent) => {
  console.log('[AuthContext] Auth complete event received:', event.detail);
  // CRITICAL FIX: Mark that auth-complete was handled to prevent race with handleAuthStateChange
  authCompleteHandledRef.current = Date.now();
  // Reset tracking refs to force a fresh fetch
  initialFetchDoneRef.current = false;
  lastFetchedUserIdRef.current = null;
  // Trigger refresh with email from event
  if (event.detail?.walletAddress || effectiveWalletAddress) {
    void refreshUserData(event.detail?.email);
  }
};
```

#### 3. Modified `handleAuthStateChange` to check for recent auth-complete
```typescript
useEffect(() => {
  const handleAuthStateChange = async () => {
    if (ready && authenticated && effectiveWalletAddress) {
      // Check if we already fetched for this user
      if (lastFetchedUserIdRef.current === effectiveWalletAddress && initialFetchDoneRef.current) {
        return;
      }

      // CRITICAL FIX: If auth-complete event was handled in the last 2 seconds, skip this call
      // The auth-complete handler already called refreshUserData with the correct email
      // This prevents a race condition where this effect calls refreshUserData without email
      const timeSinceAuthComplete = Date.now() - authCompleteHandledRef.current;
      if (timeSinceAuthComplete < 2000) {
        console.log('[AuthContext] Auth-complete event was just handled, skipping redundant refresh from handleAuthStateChange');
        // Still mark as fetched so we don't trigger again
        lastFetchedUserIdRef.current = effectiveWalletAddress;
        initialFetchDoneRef.current = true;
        return;
      }

      // Normal flow: refresh user data
      console.log('Auth state: User authenticated via Base, fetching data for:', effectiveWalletAddress);
      lastFetchedUserIdRef.current = effectiveWalletAddress;
      initialFetchDoneRef.current = true;
      setIsLoading(true);
      void refreshUserData();
    }
    // ... logout handling
  };

  void handleAuthStateChange();
}, [ready, authenticated, effectiveWalletAddress, refreshUserData]);
```

#### 4. Reset timestamp on logout
```typescript
} else if (ready && !authenticated) {
  console.log('Auth state: User not authenticated, clearing data');
  // Reset tracking refs when user logs out
  initialFetchDoneRef.current = false;
  lastFetchedUserIdRef.current = null;
  authCompleteHandledRef.current = 0;  // ← Added
  // ... clear state
}
```

## Expected Behavior After Fix

### New User Signup Flow

1. User fills form in NewAuthModal → data saved to `localStorage.pendingSignupData`
2. BaseWalletAuthModal reads pendingSignupData and calls `upsert-user` edge function
3. Edge function creates user with email, wallet, and profile data
4. BaseWalletAuthModal dispatches `auth-complete` event with `{walletAddress, email}`
5. `handleAuthComplete` receives event:
   - Records timestamp in `authCompleteHandledRef`
   - Calls `refreshUserData(email)` with the email from the event
6. `getOrCreateUser` is called with the correct email:
   - **Step 1**: Lookup by canonical_user_id (may fail if not set yet)
   - **Step 2**: Lookup by wallet_address (may fail due to replication lag)
   - **Step 3**: Lookup by privy_user_id (legacy, may fail)
   - **Step 4**: Lookup by email ✅ **FINDS EXISTING USER**
   - Returns existing user - **no duplicate created!**
7. Meanwhile, `effectiveWalletAddress` becomes available
8. `handleAuthStateChange` effect triggers
9. Checks `timeSinceAuthComplete` = ~50-200ms (< 2000ms)
10. **Skips redundant refresh** - no duplicate created!

### Returning User Login Flow

For returning users who already have an account:

1. User signs in via CDP/Base
2. `effectiveWalletAddress` becomes available
3. `handleAuthStateChange` effect triggers
4. Checks `timeSinceAuthComplete` = 0 or > 2000ms (no recent auth-complete)
5. Calls `refreshUserData()` (no email needed, will find by wallet)
6. `getOrCreateUser` is called:
   - **Step 1**: Lookup by canonical_user_id ✅ **FINDS EXISTING USER**
   - Returns existing user

## Testing Validation

### Manual Testing Steps

1. **New User Signup**:
   ```
   1. Clear browser localStorage and cookies
   2. Go to the app
   3. Click "Sign Up"
   4. Fill in email and profile details
   5. Complete Base Wallet creation
   6. Check database: SELECT * FROM canonical_users WHERE email = '<your_email>'
   7. Verify: ONLY ONE record with both email and wallet_address populated
   ```

2. **Console Log Verification**:
   ```javascript
   // Should see these logs in order:
   [BaseWallet] Calling upsert-user with form data: {email: ..., walletAddress: ...}
   [BaseWallet] User created successfully with wallet linked
   [AuthContext] Auth complete event received: {email: ..., walletAddress: ...}
   [AuthContext] refreshUserData called with: {effectiveEmail: '...', overrideEmail: '...', source: 'auth-complete event'}
   [user-auth] Step 4: Looking up by email: <actual_email>
   [user-auth] ✅ Found existing user by EMAIL
   [AuthContext] Auth-complete event was just handled, skipping redundant refresh from handleAuthStateChange
   ```

3. **Database Query Verification**:
   ```sql
   -- Should return ONE user with matching email and wallet
   SELECT 
     id, 
     email, 
     wallet_address, 
     canonical_user_id,
     created_at
   FROM canonical_users 
   WHERE email = '<test_email>' 
   OR wallet_address ILIKE '<test_wallet>';
   ```

### Success Indicators

✅ **Fix is working if:**
- Only ONE user record created per signup
- User record has both email and wallet_address populated
- Console shows "Found existing user by EMAIL" in Step 4
- Console shows "Auth-complete event was just handled, skipping redundant refresh"
- No "Creating new user" message in Step 5 after successful upsert-user call

❌ **Fix is NOT working if:**
- Multiple user records with same email or wallet
- User record with wallet but email = null
- Console shows "Creating new user with canonical ID" after successful upsert-user
- Console shows email = null or undefined in getOrCreateUser after auth-complete

## Technical Details

### Why 2 seconds?

The 2-second window is chosen to be:
- **Long enough**: Accounts for database replication lag, network latency, and React state propagation
- **Short enough**: Doesn't interfere with legitimate re-authentication scenarios
- **Safe**: Even if the user logs out and back in within 2 seconds (unlikely), the effect will trigger on the next render cycle

### Why not remove handleAuthStateChange entirely?

The `handleAuthStateChange` effect is still needed for:
1. **Returning users**: Who sign in without the auth-complete event (e.g., session restoration)
2. **External wallet connections**: Via wagmi that don't go through the BaseWalletAuthModal
3. **Edge cases**: Where auth-complete event might not fire (e.g., browser extensions blocking events)

### Existing Safety Mechanisms

This fix complements existing safety mechanisms:

1. **refreshInProgressRef guard**: Prevents concurrent calls to `refreshUserData`
2. **Step 5a in getOrCreateUser**: Final wallet address check before creating user
3. **Database unique constraints**: Prevents duplicate canonical_user_id or email
4. **Error recovery in getOrCreateUser**: Handles 23505 errors and attempts to find existing user

## Related Files

- `src/contexts/AuthContext.tsx` - Main fix location
- `src/lib/user-auth.ts` - User lookup and creation logic (unchanged)
- `src/components/BaseWalletAuthModal.tsx` - Dispatches auth-complete event (unchanged)
- `supabase/functions/upsert-user/index.ts` - Edge function for user creation (unchanged)

## Conclusion

This fix resolves the duplicate user creation issue by ensuring that when a user signs up:
1. The `auth-complete` event handler takes precedence
2. The email from the verified OTP flow is passed to `getOrCreateUser`
3. The `handleAuthStateChange` effect doesn't interfere with the signup flow
4. Existing users are found by email in Step 4 instead of creating duplicates in Step 5

The fix is minimal, surgical, and doesn't affect any other authentication flows.
