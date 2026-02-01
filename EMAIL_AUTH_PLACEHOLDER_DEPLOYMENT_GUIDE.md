# Email-First Auth Placeholder Flow - Deployment Guide

## Overview

This implementation solves the constraint violation issue when users sign up via email OTP before connecting their wallet. The solution uses a temporary placeholder canonical_user_id format (`prize:pid:temp<N>`) that gets replaced with the final wallet-based ID (`prize:pid:0x...`) when the wallet connects.

## Problem Statement

**Issue**: When users sign up via NewAuthModal (email OTP), the system attempted to create a canonical_users row with a placeholder canonical_user_id like `prize:pid:maxmillian420_outloo_e497...`. This failed because database trigger functions tried to extract and normalize a wallet address from the canonical_user_id, but the placeholder format is not a valid Ethereum address.

**Root Cause**: The trigger functions `canonical_users_normalize_before_write` and `cu_normalize_and_enforce` attempted to extract the wallet address portion from `canonical_user_id` and pass it to `util.normalize_evm_address()`, which expects a valid `0x...` format.

## Solution Architecture

### 1. Database Changes

#### New Sequence
- **`temp_user_sequence`**: Monotonically increasing sequence for generating unique placeholder IDs
- Ensures no collisions across concurrent signups
- Format: `prize:pid:temp1`, `prize:pid:temp2`, etc.

#### New RPC Function
- **`allocate_temp_canonical_user()`**: 
  - Allocates next temp ID atomically from sequence
  - Generates unique `uid` (UUID)
  - Returns JSON: `{ uid, canonical_user_id, temp_id }`
  - SECURITY DEFINER for anon access
  - Grants: `anon`, `authenticated`

#### Updated Trigger Functions
Modified three trigger functions to skip normalization for placeholder IDs:

1. **`canonical_users_normalize()`**
   - Skips canonical_user_id generation if already exists (including placeholders)
   - Only normalizes wallet addresses if present

2. **`canonical_users_normalize_before_write()`**
   - Checks if canonical_user_id matches `prize:pid:temp%` pattern
   - Only extracts/normalizes wallet if NOT a placeholder
   - Validates extracted value starts with `0x` before normalizing

3. **`cu_normalize_and_enforce()`**
   - Only sets canonical_user_id from wallet if NOT a placeholder
   - Preserves placeholder IDs during INSERT/UPDATE

#### Updated upsert_canonical_user Function
Enhanced placeholder replacement logic:

```sql
-- Priority order:
1. If new canonical_user_id is wallet-based (prize:pid:0x...), use it (replaces placeholder)
2. If existing is placeholder (prize:pid:temp...) and wallet provided, replace with wallet-based ID
3. Otherwise keep existing or use provided
```

Key features:
- Detects placeholder format: `canonical_user_id LIKE 'prize:pid:temp%'`
- Replaces with wallet-based ID: `'prize:pid:' || LOWER(p_wallet_address)`
- Updates by `uid` (stable identifier)
- Returns final canonical_user_id for verification

### 2. Frontend Changes

#### NewAuthModal.tsx
**Before**:
```typescript
// Client-side generation (collision risk)
const emailPrefix = email.replace(/[^a-z0-9]/g, '_').slice(0, 20);
const uniqueId = crypto.randomUUID().slice(0, 16);
const tempUserId = `${emailPrefix}_${uniqueId}`;
const partialCanonicalId = `prize:pid:${tempUserId}`;
```

**After**:
```typescript
// Server-side allocation (atomic, collision-free)
const { data: allocResult } = await supabase
  .rpc('allocate_temp_canonical_user');

const tempUid = allocResult.uid;
const tempCanonicalUserId = allocResult.canonical_user_id; // prize:pid:temp<N>

// Store in sessionStorage for BaseWalletAuthModal
sessionStorage.setItem('pendingSignupData', JSON.stringify({
  uid: tempUid,
  canonical_user_id: tempCanonicalUserId,
  email: profileData.email,
  username: profileData.username,
  // ... other fields
  timestamp: Date.now(),
}));

// Create user with placeholder
await supabase.rpc('upsert_canonical_user', {
  p_uid: tempUid,
  p_canonical_user_id: tempCanonicalUserId,
  // ... profile data
});
```

#### BaseWalletAuthModal.tsx
**Enhanced linkWalletToExistingUser function**:

```typescript
// Check for pending signup data first
const pendingDataStr = localStorage.getItem('pendingSignupData') || 
                       sessionStorage.getItem('pendingSignupData');
let pendingSignupUid: string | null = null;

if (pendingDataStr) {
  pendingSignupUid = JSON.parse(pendingDataStr).uid;
}

// Find user by uid (placeholder user) OR email (fallback)
if (pendingSignupUid) {
  // Exact match by uid - finds the pre-created placeholder user
  existingUser = await supabase
    .from('canonical_users')
    .select('id, uid, canonical_user_id, ...')
    .eq('uid', pendingSignupUid)
    .maybeSingle();
}

// Update with wallet using uid (not id)
await supabase.rpc('upsert_canonical_user', {
  p_uid: existingUser.uid,  // CRITICAL: Use uid for placeholder replacement
  p_canonical_user_id: canonicalUserId, // prize:pid:0x...
  p_wallet_address: walletAddress,
  // ...
});
```

### 3. Types
Added to `supabase/types.ts`:

```typescript
allocate_temp_canonical_user: {
  Args: Record<PropertyKey, never>
  Returns: Json
}
```

## Flow Diagrams

### Email-First Signup Flow

```
1. User enters email + profile in NewAuthModal
   ↓
2. NewAuthModal calls allocate_temp_canonical_user()
   ← Returns: { uid: "uuid", canonical_user_id: "prize:pid:temp123" }
   ↓
3. Store in sessionStorage (pendingSignupData)
   ↓
4. NewAuthModal calls upsert_canonical_user()
   - p_uid: "uuid"
   - p_canonical_user_id: "prize:pid:temp123"
   - p_email, p_username, etc.
   ↓
5. Triggers run: Skip normalization (placeholder detected)
   ↓
6. User record created with placeholder
   canonical_user_id: "prize:pid:temp123"
   uid: "uuid"
   ↓
7. BaseWalletAuthModal opens
   ↓
8. User connects wallet (0xABC...)
   ↓
9. linkWalletToExistingUser reads pendingSignupData
   ↓
10. Finds user by uid: "uuid"
    ↓
11. Calls upsert_canonical_user()
    - p_uid: "uuid" (same user)
    - p_canonical_user_id: "prize:pid:0xabc..."
    - p_wallet_address: "0xabc..."
    ↓
12. upsert_canonical_user detects placeholder replacement:
    - existing: "prize:pid:temp123"
    - new: "prize:pid:0xabc..."
    - Action: REPLACE (update same row)
    ↓
13. Final result:
    - Same uid: "uuid"
    - canonical_user_id: "prize:pid:0xabc..."
    - wallet_address: "0xabc..."
    - No duplicate users ✓
```

## Testing

### SQL Test Script
Located: `supabase/migrations/test_temp_user_placeholder.sql`

Tests:
1. ✓ Allocate temporary placeholder (format validation)
2. ✓ Create user with temporary placeholder (INSERT works)
3. ✓ Replace placeholder with wallet ID (UPDATE works, no duplicate)
4. ✓ Uniqueness of temporary placeholders (sequence increments)
5. ✓ Triggers preserve placeholder format (no unwanted normalization)

**Run test**:
```sql
psql -h <host> -U <user> -d <database> -f supabase/migrations/test_temp_user_placeholder.sql
```

Expected output: All tests show "PASSED"

### Manual Testing Checklist

#### New User Signup Flow
- [ ] Open app in incognito mode
- [ ] Click "Sign Up"
- [ ] Enter email + profile details
- [ ] Verify email OTP
- [ ] Check database: User should have `canonical_user_id = prize:pid:temp<N>`
- [ ] Connect wallet
- [ ] Check database: Same user should now have `canonical_user_id = prize:pid:0x...`
- [ ] Verify no duplicate users created
- [ ] Verify wallet address saved correctly

#### Returning User Flow
- [ ] Open app (logged out)
- [ ] Click "Log In"
- [ ] Enter email (existing user)
- [ ] Connect wallet
- [ ] Verify wallet linked to existing account
- [ ] No placeholder created (direct wallet link)

#### Edge Cases
- [ ] Concurrent signups (multiple tabs/devices)
  - Should allocate unique temp IDs (temp1, temp2, etc.)
- [ ] Signup → close without wallet → return later
  - Placeholder should persist until wallet connects
- [ ] Email with special characters
  - Should be stored correctly in database

## Deployment Steps

### Prerequisites
- Supabase CLI installed: `npm install -g supabase`
- Database connection configured
- Backup database before migration

### Step 1: Apply Database Migration
```bash
cd supabase
supabase db push
```

Or manually:
```bash
psql -h <host> -U <user> -d <database> \
  -f migrations/20260201164500_add_temp_user_placeholder_support.sql
```

### Step 2: Verify Migration
```bash
# Check sequence created
psql -h <host> -U <user> -d <database> -c "SELECT * FROM temp_user_sequence;"

# Check function exists
psql -h <host> -U <user> -d <database> -c "\df allocate_temp_canonical_user"

# Test allocation
psql -h <host> -U <user> -d <database> -c "SELECT allocate_temp_canonical_user();"
```

Expected output:
```json
{"uid": "...", "canonical_user_id": "prize:pid:temp1", "temp_id": "1"}
```

### Step 3: Run Tests
```bash
psql -h <host> -U <user> -d <database> \
  -f migrations/test_temp_user_placeholder.sql
```

All tests should show "PASSED"

### Step 4: Deploy Frontend
```bash
# Build frontend
npm run build

# Deploy to your hosting (Netlify, Vercel, etc.)
# Or push to main branch for CI/CD
```

### Step 5: Monitor First Signups
Watch logs for:
- ✓ `[NewAuthModal] Allocated temp user: { uid: ..., canonical_user_id: prize:pid:temp<N> }`
- ✓ `[NewAuthModal] User record created successfully with temp ID`
- ✓ `[BaseWallet] Found user by uid with placeholder canonical_user_id`
- ✓ `[BaseWallet] Calling upsert_canonical_user RPC for wallet link completion`
- ⚠️ Any errors mentioning canonical_users_cuid_ck (should not occur)

## Rollback Plan

If issues occur, rollback in reverse order:

### Step 1: Rollback Frontend (if needed)
```bash
git revert <commit-hash>
npm run build
# Redeploy
```

### Step 2: Rollback Database (if needed)
```sql
BEGIN;

-- Drop new function
DROP FUNCTION IF EXISTS allocate_temp_canonical_user();

-- Drop sequence
DROP SEQUENCE IF EXISTS temp_user_sequence;

-- Restore old trigger functions (from previous migration)
-- (Run previous migration file if available)

COMMIT;
```

## Security Considerations

1. **RLS Policies**: 
   - `allocate_temp_canonical_user` has SECURITY DEFINER
   - Grants to `anon` and `authenticated` are intentional (needed for signup)
   - Function only allocates IDs, doesn't expose user data

2. **PII in Logs**:
   - ✓ No email addresses in placeholder IDs
   - ✓ No personal information in temp IDs
   - Format: `prize:pid:temp<N>` (just a number)

3. **Sequence Exhaustion**:
   - Sequence uses BIGINT (max: 9,223,372,036,854,775,807)
   - Even at 1 million signups/day, takes 25 million years to exhaust
   - No practical limit

4. **Placeholder Cleanup**:
   - Placeholders automatically replaced on wallet connection
   - No cleanup needed (they're just replaced, not orphaned)

## Performance Impact

- **Sequence allocation**: O(1), atomic, very fast
- **Trigger modifications**: No additional overhead (same triggers, just conditional logic)
- **Additional sessionStorage**: Negligible (~200 bytes)
- **Database impact**: Minimal (one sequence, one function, no additional tables)

## Known Limitations

1. **Email-only users**: Users who never connect a wallet will keep placeholder IDs indefinitely
   - This is acceptable per requirements (wallet connection is required for full access)

2. **Sequence reset**: If database is reset/cloned, sequence starts from 1 again
   - Not an issue (placeholders are temporary and unique within same database)

3. **Cross-database conflicts**: Placeholder IDs are only unique within one database
   - Not an issue (each environment has separate database)

## Troubleshooting

### Issue: "Function allocate_temp_canonical_user does not exist"
**Solution**: Migration not applied. Run:
```bash
psql -f migrations/20260201164500_add_temp_user_placeholder_support.sql
```

### Issue: "Sequence temp_user_sequence does not exist"
**Solution**: Check if sequence creation failed:
```sql
CREATE SEQUENCE temp_user_sequence START WITH 1;
```

### Issue: "Placeholder still causing constraint error"
**Symptom**: Error mentions `canonical_users_cuid_ck`
**Solution**: Triggers not updated. Drop and recreate:
```sql
DROP TRIGGER IF EXISTS canonical_users_normalize_before_write ON canonical_users;
-- (Re-run trigger creation from migration)
```

### Issue: "Duplicate users created"
**Symptom**: Two canonical_users rows with different canonical_user_id for same email
**Solution**: Check if uid is being used correctly:
```sql
SELECT uid, canonical_user_id, email FROM canonical_users 
WHERE email = 'user@example.com';
```
Should show only one row after wallet connection.

### Issue: "Wallet not linking to placeholder user"
**Symptom**: New user created instead of updating existing
**Root Cause**: pendingSignupData not found or uid mismatch
**Debug**:
```javascript
// In browser console
console.log(sessionStorage.getItem('pendingSignupData'));
console.log(localStorage.getItem('pendingSignupData'));
```

## Success Metrics

After deployment, monitor:

1. **Signup Success Rate**: Should increase (no more constraint errors)
2. **User Records**: No users with placeholder IDs stuck long-term
3. **Error Logs**: No errors mentioning "canonical_users_cuid_ck"
4. **Support Tickets**: Reduced complaints about signup failures

## Support

For issues or questions:
1. Check logs in Supabase Dashboard (Database → Logs)
2. Review browser console for frontend errors
3. Check this guide's Troubleshooting section
4. Contact: [Your support contact]

---

**Document Version**: 1.0  
**Last Updated**: 2026-02-01  
**Author**: GitHub Copilot  
**Status**: Ready for Production Deployment
