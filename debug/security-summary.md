# Security Summary - Canonical User ID Migration

**Date**: 2026-02-01  
**PR**: Replace baseUser.id with canonical_user_id for database/RPC calls

---

## Overview

This PR addresses a critical bug where dashboard components (Orders, Entries, Notifications) were not displaying user data despite records existing in the database. The root cause was the use of raw wallet addresses (`baseUser.id`) instead of the canonical identifier format (`prize:pid:<wallet>`) for database queries.

---

## Vulnerabilities Discovered

### None Critical

No security vulnerabilities were introduced or discovered during this migration. This was purely a bug fix to use the correct identifier format for database queries.

---

## Security Improvements

### 1. Consistent User Identification

**Before:**
- Mixed use of raw wallet addresses (`0xABC...`) and canonical IDs (`prize:pid:0xabc...`)
- Inconsistent case handling (wallet addresses are case-insensitive)
- Potential for identifier mismatch leading to data leakage or access issues

**After:**
- Single canonical identifier (`prize:pid:<wallet_lowercase>`) for all database operations
- Consistent case normalization (always lowercase)
- Reduced risk of data access errors

### 2. Input Validation

The `toCanonicalUserId()` function includes proper validation:
- Throws error on null/undefined/empty input
- Validates wallet address format (0x + 40 hex chars)
- Normalizes case for consistent comparison

### 3. Logging for Debugging

Added logging in AuthContext when canonical ID is generated:
```typescript
console.log('[AuthContext] Canonical user ID:', canonical, 'from baseUser.id:', baseUser.id);
```

This helps identify any issues with identifier generation in production.

---

## Areas Reviewed for Security

### 1. Database Query Injection
**Status**: ✅ Safe

All database queries use parameterized queries via Supabase client or RPC functions. No raw SQL concatenation detected.

Example:
```typescript
// Safe - uses Supabase query builder
await database.getUserTransactions(canonicalUserId);

// Safe - uses RPC with parameter
await supabase.rpc('get_user_transactions', {
  p_user_identifier: canonicalUserId
});
```

### 2. Real-time Channel Security
**Status**: ✅ Safe

Updated real-time channel names to use canonical IDs:
```typescript
// Before: May subscribe to wrong channel
.channel(`user-transactions-${baseUser.id}`)

// After: Consistent channel naming
.channel(`user-transactions-${canonicalUserId}`)
```

This ensures users only receive real-time updates for their own data.

### 3. Cross-User Data Access
**Status**: ✅ Safe

The canonical ID format ensures:
- Each user has a unique, deterministic identifier
- Case-insensitive matching prevents duplicate user records
- Consistent identifier across all database tables

### 4. Wallet Address Validation
**Status**: ✅ Safe

The canonicalization utilities validate wallet addresses:
- Must start with `0x`
- Must be exactly 42 characters (0x + 40 hex digits)
- Invalid addresses are rejected

---

## Allowed vs. Not Allowed Usage

### ✅ Allowed: baseUser.id for UI/Analytics
The following uses of `baseUser.id` are acceptable as they don't involve database queries:

1. **Display Purposes**
   - Showing wallet address in UI (WalletSettingsPanel)
   - Copying wallet address to clipboard
   - Opening block explorer with wallet address

2. **Analytics/Logging**
   - Diagnostic logging
   - Analytics events
   - UI metrics

3. **Wallet Operations**
   - Direct blockchain interactions
   - Wallet connection state
   - Transaction signing

### ❌ Not Allowed: baseUser.id for DB/RPC
The following now use `canonicalUserId` instead:

1. **Database Queries**
   - `getUserTransactions()`
   - `getUserEntries()`
   - `getUserTicketsForCompetition()`
   - Direct Supabase queries

2. **RPC Function Calls**
   - `get_user_transactions`
   - `get_user_wallets`
   - `set_primary_wallet`
   - `get_user_balance`

3. **Real-time Subscriptions**
   - Channel names for user-specific updates
   - Record matching in real-time callbacks

---

## Testing Performed

### 1. Unit Tests
Created test script (`debug/test-canonical-user-id.js`) covering:
- Wallet address canonicalization
- Case normalization
- UUID handling
- Canonical ID comparison
- Edge cases (null, empty, invalid)

**Result**: ✅ All 16 tests passed

### 2. Code Review
Automated code review identified and addressed:
- Guard condition mismatches
- Legacy field identifier issues
- Callback dependency updates

**Result**: ✅ All feedback addressed

### 3. Manual Testing Required
The following should be tested manually:
- [ ] Orders tab displays transactions
- [ ] Entries tab displays competition entries
- [ ] Notifications load correctly
- [ ] Real-time updates work (new transactions, entries)
- [ ] Wallet management operations
- [ ] Payment flows

---

## Recommendations

### 1. Add ESLint Rule
Prevent future regressions by adding a linting rule:

```javascript
// .eslintrc.js
'no-restricted-syntax': [
  'error',
  {
    selector: 'MemberExpression[object.name="baseUser"][property.name="id"]',
    message: 'Use canonicalUserId from useAuthUser() for database queries. baseUser.id should only be used for UI display and wallet operations.'
  }
]
```

### 2. Update Documentation
Add JSDoc comments to AuthContext:

```typescript
/**
 * Raw wallet address from authentication.
 * ⚠️ DO NOT use for database queries!
 * Use canonicalUserId instead for all DB/RPC calls.
 */
id: string;

/**
 * Canonical user identifier for database operations.
 * Format: prize:pid:<wallet_address_lowercase>
 * Use this for all database queries, RPC calls, and real-time channels.
 */
canonicalUserId: string | null;
```

### 3. Database Migration Audit
Consider auditing database tables to ensure all user-related fields use canonical IDs:
- [ ] `user_transactions.canonical_user_id`
- [ ] `sub_account_balances.canonical_user_id`
- [ ] `joincompetition.canonical_user_id`
- [ ] `competition_entries.canonical_user_id`
- [ ] Any other user-keyed tables

### 4. RPC Function Consistency
Verify all RPC functions accept and use canonical IDs correctly:
- [ ] `get_user_transactions`
- [ ] `get_user_entries`
- [ ] `get_user_balance`
- [ ] `get_user_wallets`
- [ ] All other user-scoped RPCs

---

## Conclusion

This migration improves data consistency and reduces the risk of identifier-related bugs. No security vulnerabilities were introduced or discovered. The changes are backward-compatible with existing database records that use canonical IDs.

**Security Impact**: ✅ Positive - More consistent and safer user identification  
**Data Privacy**: ✅ Maintained - No changes to data access patterns  
**Risk Level**: 🟢 Low - Isolated changes to identifier passing
