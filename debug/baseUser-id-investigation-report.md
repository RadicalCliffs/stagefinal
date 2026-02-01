# Investigation Report: baseUser.id Usage and Migration to Canonical User ID

**Date**: 2026-02-01  
**Issue**: Orders tab and other dashboard features not showing data despite rows existing in database  
**Root Cause**: Use of `baseUser.id` (raw wallet address) instead of `canonical_user_id` (prize:pid:<wallet>) for database/RPC lookups

---

## Executive Summary

The application currently uses `baseUser.id` (a raw wallet address) as an identifier for database queries and RPC calls throughout the dashboard. However, the database tables (e.g., `user_transactions`, `sub_account_balances`) store data keyed by `canonical_user_id` in the format `prize:pid:<wallet_address_lowercase>`. This mismatch causes queries to fail and return no results, even though data exists.

**Impact**:
- Orders tab shows no purchases/entries despite transactions in the database
- Other dashboard components (Notifications, Entries) may also be affected
- Real-time subscriptions may not trigger properly due to ID mismatch

---

## What is baseUser.id?

### Current Implementation
Location: `/src/contexts/AuthContext.tsx` lines 149-156

```typescript
const baseUser: BaseUser | null = useMemo(() => {
  if (!effectiveWalletAddress) return null;
  return {
    id: effectiveWalletAddress, // Use wallet address as the primary ID
    email: userEmail,
    wallet: { address: effectiveWalletAddress },
  };
}, [effectiveWalletAddress, userEmail]);
```

### Format
- **Type**: Ethereum wallet address
- **Pattern**: `0x[a-fA-F0-9]{40}` (42 characters)
- **Example**: `0x1234567890abcdef1234567890abcdef12345678`
- **Case**: Can be mixed case (not normalized)

### Source
The wallet address comes from either:
1. **CDP/Base (primary)**: `evmAddress` from `useEvmAddress()` hook
2. **Wagmi (fallback)**: External wallet connection via `useAccount()` hook

---

## What is canonical_user_id?

### Format
- **Pattern**: `prize:pid:<wallet_address_lowercase>`
- **Example**: `prize:pid:0x1234567890abcdef1234567890abcdef12345678`
- **Case**: Always lowercase for case-insensitive matching

### Purpose
- Single source of truth for user identity across the entire system
- Database-safe identifier that works consistently across all tables
- Prevents issues with case sensitivity (0xABC vs 0xabc)

### Canonicalization Utilities

**File**: `/src/lib/canonicalUserId.ts`
```typescript
export function toCanonicalUserId(input: string | null | undefined): string {
  if (!input) throw new Error('User ID required');
  if (input.startsWith('prize:pid:')) return input;
  
  // Wallet address
  if (input.startsWith('0x')) {
    return `prize:pid:${input.toLowerCase()}`;
  }
  
  return `prize:pid:${input}`;
}
```

**File**: `/src/utils/userId.ts`
```typescript
export function toPrizePid(inputUserId: string | null | undefined): string {
  // ... handles wallet addresses, UUIDs, and other formats
  if (isWalletAddress(trimmedId)) {
    return `prize:pid:${trimmedId.toLowerCase()}`;
  }
  // ...
}
```

---

## When Was baseUser.id Introduced?

Based on git history analysis and code review:

### Migration from Privy to Base/CDP
The application recently migrated from Privy authentication to Base/CDP (Coinbase Developer Platform):

**Evidence**:
1. AuthContext still has backward compatibility comments: "Keep privyUser for backward compatibility (maps to baseUser)"
2. The `BaseUser` interface is described as "User data from Base/CDP auth - replaces Privy user object"
3. Git history shows PR #252 related to login fixes after Base migration

### Timeline
- **Before**: Used Privy DIDs in format `did:privy:<id>`
- **After**: Switched to wallet addresses directly as `baseUser.id`
- **Issue**: The switch didn't properly account for canonical ID requirement

### Likely Introduction Point
The bug was introduced during the Privy-to-Base migration when:
1. `privyUser.id` (which was a DID) was replaced with `baseUser.id` (wallet address)
2. Developers forgot to update DB/RPC calls to use the canonical format
3. Some parts of code (like `TopUpWalletModal`) were updated correctly with `toCanonicalUserId(baseUser.id)`, but many dashboard components were not

**Related PR**: 
- #252 (merged) - Fixed migrations with explicit DROP FUNCTION before CREATE OR REPLACE
- This PR did not address the canonical ID issue in dashboard components

---

## Complete Inventory of baseUser.id Usage

### ⚠️ NOT ALLOWED - Must Be Fixed (Database/RPC/Realtime)

#### 1. UserDashboard/Orders/OrdersList.tsx
**Line 76**: Database query
```typescript
const purchasesData = await database.getUserTransactions(baseUser.id);
```

**Lines 111, 140**: Real-time channel subscriptions
```typescript
.channel(`user-transactions-${baseUser.id}`)
.channel(`user-balance-orders-${baseUser.id}`)
```

**Lines 127, 161**: Record matching in real-time callbacks
```typescript
if (recordMatchesUser(record, baseUser.id)) { ... }
```

**Impact**: Primary bug - Orders tab shows no data

---

#### 2. UserDashboard/Notifications/NotificationsLayout.tsx
**Lines 21, 35, 74**: All notification service calls
```typescript
await notificationService.getUserNotifications(baseUser.id);
await notificationService.backfillNotificationsFromActivity(baseUser.id);
await notificationService.markAllAsRead(baseUser.id);
```

**Impact**: Notifications may not load correctly

---

#### 3. UserDashboard/Entries/EntriesList.tsx
**Line 62**: Database query
```typescript
const data = await database.getUserEntriesFromCompetitionEntries(baseUser.id);
```

**Lines 94-95, 102**: Real-time subscriptions and matching
```typescript
.channel(`user-entries-${baseUser.id}`)
if (recordMatchesUser(record, baseUser.id)) { ... }
```

**Impact**: Entries tab may not show user's competition entries

---

#### 4. UserDashboard/Entries/EntryDetails.tsx
**Line 25**: Database query
```typescript
const allEntries = await database.getUserEntries(baseUser.id);
```

**Impact**: Entry details may not load

---

#### 5. UserDashboard/Entries/CompetitionEntryDetails.tsx
**Line 27**: Database query
```typescript
const allEntries = await database.getUserEntries(baseUser.id);
```

**Impact**: Competition entry details may not load

---

#### 6. WalletManagement/WalletManagement.tsx
**Line 103**: Database query
```typescript
const transactions = await database.getUserTransactions(baseUser.id);
```

**Lines 172, 200, 207, 214, 221**: RPC calls for wallet operations
```typescript
user_identifier: baseUser.id
```

**Impact**: Wallet management features may fail

---

#### 7. PaymentModal.tsx
**Lines 114, 357**: Balance queries
```typescript
const balanceData = await database.getUserBalance(baseUser.id);
```

**Impact**: Balance display and payment flows may fail

---

#### 8. IndividualCompetition/TicketSelectorWithTabs.tsx
**Lines 105-107**: Multiple RPC and direct queries
```typescript
const userTickets = await database.getUserTicketsForCompetition(baseUser.id, competitionId);
.eq('wallet_address', baseUser.id)
const available = await database.getAvailableTicketsForCompetition(baseUser.id, competitionId);
```

**Impact**: Ticket selection may not work properly

---

### ✅ ALLOWED - UI/Analytics/Display (Keep As-Is)

#### 1. NotificationBadge.tsx
**Line 15**: UI state
```typescript
const count = await notificationService.getUnreadCount(baseUser.id);
```
**Justification**: Local UI badge count, not critical if slightly stale

---

#### 2. LoggedInUserBtn.tsx  
**Line 28**: UI state
```typescript
const count = await notificationService.getUnreadCount(baseUser.id);
```
**Justification**: Local UI badge count

---

#### 3. WalletSettingsPanel.tsx
**Line 77**: Display only
```typescript
<span className="sequel-45">{truncateString(baseUser.id, 24)}</span>
```
**Justification**: Displaying wallet address to user

---

#### 4. TopUpWalletModal.tsx
**Lines 103, 232, 329**: Already uses toCanonicalUserId
```typescript
const userId = toCanonicalUserId(baseUser.id);
```
**Justification**: ✅ Already implemented correctly!

---

#### 5. IndividualCompetitionHeroSection.tsx, LuckyDip/TicketPicker.tsx
Analytics/logging purposes only
**Justification**: Not used for database queries

---

## Database Schema Expectations

### Tables Using canonical_user_id

1. **user_transactions**
   - Primary key for user: `canonical_user_id` (prize:pid:<wallet>)
   - Also stores: `wallet_address`, `user_id`, `privy_user_id`

2. **sub_account_balances**
   - Primary key for user: `canonical_user_id`
   - Also stores: `user_id`, `privy_user_id`

3. **joincompetition**
   - Primary key for user: `canonical_user_id`
   - Also stores: `wallet_address`

4. **canonical_users**
   - Primary key: `wallet_address` (not canonical format)
   - Stores profile data (username, avatar, country)

### RPC Functions Expecting canonical_user_id

From analysis of `/src/lib/database.ts`:
- `get_user_transactions(p_user_identifier)` - expects canonical ID
- `get_user_balance(p_user_identifier)` - expects canonical ID
- Other user-scoped RPCs also expect canonical format

---

## Correct Identifier Flow

### 1. Authentication (CDP/Base)
```
User logs in via Base/CDP → evmAddress obtained → Stored as baseUser.id
```

### 2. Canonical Conversion (Before DB/RPC calls)
```typescript
// AuthContext provides canonicalUserId
const { canonicalUserId } = useAuthUser();

// OR manually convert if needed
const canonicalId = toCanonicalUserId(baseUser.id);
```

### 3. Database Queries
```typescript
// ❌ WRONG - Uses raw wallet address
const data = await database.getUserTransactions(baseUser.id);

// ✅ CORRECT - Uses canonical ID
const data = await database.getUserTransactions(canonicalUserId);
```

### 4. Real-time Subscriptions
```typescript
// ❌ WRONG - Channel name won't match DB triggers
.channel(`user-transactions-${baseUser.id}`)

// ✅ CORRECT - Matches DB canonical_user_id
.channel(`user-transactions-${canonicalUserId}`)
```

---

## Migration Strategy

### Phase 1: AuthContext Enhancement
1. Ensure `canonicalUserId` is exposed in AuthContext (already done at line 278-279)
2. Add validation and error logging for missing canonical ID

### Phase 2: Critical Fixes (Orders Tab - Primary Bug)
1. Update `OrdersList.tsx` to use `canonicalUserId`
2. Update `ExportButton.tsx` to use `canonicalUserId`
3. Test Orders tab shows data

### Phase 3: Dashboard Components
1. Update `NotificationsLayout.tsx`
2. Update `EntriesList.tsx`, `EntryDetails.tsx`, `CompetitionEntryDetails.tsx`
3. Test dashboard tabs

### Phase 4: Wallet & Payment Components
1. Update `WalletManagement.tsx` RPC calls
2. Update `PaymentModal.tsx` balance queries
3. Update `TicketSelectorWithTabs.tsx` queries
4. Test payment and ticket selection flows

### Phase 5: Real-time Subscriptions
1. Update all channel names to use `canonicalUserId`
2. Verify real-time updates work correctly

---

## Testing Checklist

### Manual Testing
- [ ] Orders tab displays purchases for user with existing `user_transactions`
- [ ] Entries tab displays competition entries
- [ ] Notifications tab loads user notifications
- [ ] Real-time updates work when new transactions/entries created
- [ ] Balance displays correctly in payment flows
- [ ] Ticket selection works for competitions

### Automated Testing (if test framework exists)
- [ ] Unit tests for `toCanonicalUserId()` function
- [ ] Unit tests for `toPrizePid()` function
- [ ] Integration tests for dashboard data loading

---

## Prevention Measures

### 1. AuthContext Guidance
Add JSDoc comment to `baseUser.id`:
```typescript
/**
 * Raw wallet address. DO NOT use for database queries!
 * Use canonicalUserId instead for all DB/RPC calls.
 */
id: string;
```

### 2. Linting Rule
Consider adding an ESLint rule to catch `baseUser.id` usage in database-related files:
```javascript
// .eslintrc.js
'no-restricted-syntax': [
  'error',
  {
    selector: 'MemberExpression[object.name="baseUser"][property.name="id"]',
    message: 'Use canonicalUserId instead of baseUser.id for database queries'
  }
]
```

### 3. Code Review Checklist
Add to PR template:
- [ ] All database queries use `canonicalUserId` instead of `baseUser.id`
- [ ] Real-time channel names use `canonicalUserId`
- [ ] RPC calls use `canonicalUserId` for user identification

---

## Conclusion

The issue stems from a migration to Base/CDP authentication where `baseUser.id` (a raw wallet address) replaced the previous identifier, but database queries were not updated to use the canonical `prize:pid:<wallet>` format that the database expects. The fix is straightforward: use `canonicalUserId` from AuthContext (or call `toCanonicalUserId(baseUser.id)`) for all database, RPC, and real-time subscription operations.

**Estimated Effort**: 2-3 hours
**Risk Level**: Low (isolated changes to identifier passing)
**Testing**: Manual testing of dashboard tabs required to verify fix
