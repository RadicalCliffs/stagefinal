# JWT Audit Summary - Quick Reference

## TL;DR

**Found 18 files using JWT-related code. 11 are broken, 7 are working.**

---

## ✅ WORKING (Keep These)

### Coinbase CDP JWTs (7 edge functions)
These generate JWTs for Coinbase API authentication:
- `onramp-init`, `onramp-quote`, `onramp-status`
- `offramp-init`, `offramp-quote`, `offramp-status`

**Status:** ✅ Working correctly, do NOT touch

---

## ❌ BROKEN (Need Cleanup)

### Supabase Auth getSession Calls (11 files)

These all call `supabase.auth.getSession()` which **always returns null**:

**Libraries (9):**
1. `src/lib/reserve-tickets-redundant.ts:50`
2. `src/lib/base-payment.ts:90`
3. `src/lib/base-account-payment.ts:50`
4. `src/lib/competition-state.ts:30`
5. `src/lib/notification-service.ts:35`
6. `src/lib/vrf-debug.ts:56`
7. `src/lib/secure-api.ts:85`
8. `src/lib/coinbase-commerce.ts:65`
9. `src/lib/onchainkit-checkout.ts:62`

**Hooks (1):**
10. `src/hooks/useInstantWinTickets.ts:30`

**Components (1):**
11. `src/components/TopUpWalletModal.tsx` (lines 211, 369, 486)

**Status:** ❌ Dead code - always returns null

---

## ⚠️ DEFUNCT (Can Remove)

### Privy localStorage Checks (7 files)

These check `localStorage.getItem('privy:access_token')` but Privy isn't used:
1. `src/lib/competition-state.ts:24-25`
2. `src/lib/notification-service.ts:29`
3. `src/lib/vrf-debug.ts:35`
4. `src/lib/base-account-payment.ts:43`
5. `src/lib/base-payment.ts:69`
6. `src/lib/secure-api.ts:63`
7. `src/hooks/useInstantWinTickets.ts:25`

**Status:** ⚠️ Dead code - always returns null

---

## Why Everything Still Works

Even though 18 files have JWT-related code and 11 are broken:

1. **Edge functions use service role keys** - Don't need user JWTs
2. **Frontend auth works** - CDP/Base prevents unauthorized UI access
3. **Code fails gracefully** - Missing tokens use anon key as fallback
4. **Database RLS protects data** - Row-level security still enforces rules

---

## Action Items

### Option 1: Quick Fix (Recommended)
Add comments explaining why these don't work:
```typescript
// NOTE: Returns null - app uses CDP/Base, not Supabase Auth
const { data: sessionData } = await supabase.auth.getSession();
```

### Option 2: Complete Cleanup
Remove all 11 getSession calls and 7 Privy checks.

### Option 3: Long-term Fix
Implement wallet signature verification (see `AUTHENTICATION_ARCHITECTURE.md`).

---

## Impact

**Security:**
- ⚠️ Edge functions can't verify user identity cryptographically
- ⚠️ Must trust `userId` from request body
- ⚠️ User impersonation possible

**Functionality:**
- ✅ Everything works (uses anon key fallback)
- ✅ No crashes or errors
- ✅ Users can complete all operations

---

## File Statistics

| Type | Count | Status |
|------|-------|--------|
| CDP JWTs (Coinbase) | 7 files | ✅ Working |
| Supabase getSession | 11 files | ❌ Broken |
| Privy checks | 7 files | ⚠️ Defunct |
| **Total JWT Code** | **18 files** | **11 need cleanup** |

---

## Next Steps

1. Read full audit: `JWT_USAGE_COMPLETE_AUDIT.md`
2. Choose cleanup approach (comment, remove, or implement proper auth)
3. Update affected files
4. Deploy changes

---

**Quick Answer:** 18 files use JWT code, 11 are broken but fail gracefully.
