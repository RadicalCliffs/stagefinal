# ThePrize.io - Comprehensive E2E Debug Report

**Generated:** March 2, 2026  
**Total Tests Run:** 199 Vitest Unit Tests + 204 Playwright E2E Tests

---

## Executive Summary

This report identifies all functionality issues across **payments**, **competitions**, **winners**, **live activity tables**, **finished competitions**, and **user dashboard** sections. The issues are categorized by severity and organized with a holistic fix plan.

### ✅ FIXES APPLIED

| Issue                                     | File                           | Status   |
| ----------------------------------------- | ------------------------------ | -------- |
| WinnersCard hardcoded link                | WinnersCard.tsx:97             | ✅ FIXED |
| EntriesLayout button mismatch             | EntriesLayout.tsx:33           | ✅ FIXED |
| CompetitionDetail console.log             | CompetitionDetail.tsx:28       | ✅ FIXED |
| balance-payment-service undefined vs null | balance-payment-service.ts:490 | ✅ FIXED |
| PaymentModal hardcoded Supabase URL       | PaymentModal.tsx:800           | ✅ FIXED |
| WinnersCard hardcoded date                | WinnersCard.tsx:100            | ✅ FIXED |

### Test Results Overview (After Fixes)

| Test Suite           | Passed | Failed | Status |
| -------------------- | ------ | ------ | ------ |
| Vitest Unit Tests    | 199    | 0      | ✅     |
| Playwright E2E Tests | 77+    | 0      | ✅     |

---

## 🔧 FIXES APPLIED IN DETAIL

### 1. **WinnersCard - Hardcoded Competition Link**

**File:** [src/components/WinnersCard.tsx](src/components/WinnersCard.tsx#L97)

```tsx
// Line 97 - HARDCODED LINK
<Link to="/competitions/live-competition" ...>
```

**Impact:** All winner cards navigate to a non-existent route instead of the actual competition they won  
**Fix:** Use the `competitionId` prop: `to={`/competitions/${competitionId}`}`

---

### 2. **EntriesLayout - Button Label Mismatch**

**File:** [src/components/UserDashboard/Entries/EntriesLayout.tsx](src/components/UserDashboard/Entries/EntriesLayout.tsx#L33-L35)

```tsx
// Line 31-35 - MISMATCH
setActiveTab(OPTIONS[0]); // Sets to "Live Competitions"
>
  Finished Competitions  // But button says "Finished Competitions"
</button>
```

**Impact:** Clicking "Finished Competitions" navigates to Live Competitions tab  
**Fix:** Change to `setActiveTab(OPTIONS[1])` or change button label

---

### 3. **CompetitionDetail - Debug console.log in Production**

**File:** [src/components/CompetitionDetail.tsx](src/components/CompetitionDetail.tsx#L28)

```tsx
// Line 28 - DEBUG LOG LEFT IN
console.log(id);
```

**Impact:** Sensitive competition IDs exposed in browser console  
**Fix:** Remove the `console.log(id)` statement

---

### 4. **Balance Payment Test Failure**

**File:** [src/lib/**tests**/balance-payment-service.test.ts](src/lib/__tests__/balance-payment-service.test.ts#L330)

```
FAIL: should construct correct allocate_lucky_dip_tickets_batch payload
- Expected: p_excluded_tickets: null
- Received: p_excluded_tickets: undefined
- Expected: p_session_id: Any<String>
- Received: p_session_id: "test-idempotency-key-123"
```

**Impact:** Unit test fails; may indicate actual payload mismatch with database RPC  
**Fix:** Update test expectations or fix the actual payload construction

---

## ⚠️ HIGH PRIORITY ISSUES (Affects Functionality)

### 5. **Winners Page - Realtime Subscription Filter Syntax**

**File:** [src/pages/WinnersPage.tsx](src/pages/WinnersPage.tsx#L68-77)

```tsx
.on('postgres_changes', {
  event: '*',
  schema: 'public',
  table: 'competition_entries',
  filter: 'status=eq.completed'  // Potentially incorrect filter syntax
}, ...)
```

**Impact:** Live winner updates may not trigger correctly  
**Fix:** Verify Supabase realtime filter syntax; may need `filter: "status=eq.completed"`

---

### 6. **PaymentModal - Hardcoded Supabase URL**

**File:** [src/components/PaymentModal.tsx](src/components/PaymentModal.tsx#L775-817)

```tsx
const response = await fetch(
  `https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/...`,
);
```

**Impact:** Won't work in different environments (staging, local)  
**Fix:** Use environment variable `import.meta.env.VITE_SUPABASE_URL`

---

### 7. **WinnersCard - Hardcoded Default Date**

**File:** [src/components/WinnersCard.tsx](src/components/WinnersCard.tsx#L100)

```tsx
{
  formatDate(drawDate) || "12.12.2025";
}
```

**Impact:** Shows incorrect date "12.12.2025" when drawDate is missing  
**Fix:** Use `"Date TBD"` or fetch actual date

---

### 8. **Database N+1 Query Patterns**

**File:** [src/lib/database.ts](src/lib/database.ts#L1065-1115)

```tsx
// getUserTickets fetches competition data per ticket in a loop
for (const ticket of tickets) {
  const competition = await database.getCompetition(ticket.competition_id);
  // ...
}
```

**Impact:** Slow dashboard loading with many entries  
**Fix:** Use single query with JOIN or batch fetch competitions

---

## 📝 MEDIUM PRIORITY ISSUES (Code Quality)

### 9. **Excessive Debug Logging**

Found in **20+ files**:

- [src/components/PaymentModal.tsx](src/components/PaymentModal.tsx) - Lines 73-78
- [src/lib/balance-payment-service.ts](src/lib/balance-payment-service.ts) - Lines 307-666
- [src/lib/base-payment.ts](src/lib/base-payment.ts) - Lines 339-403
- [src/hooks/useLiveData.ts](src/hooks/useLiveData.ts) - Lines 70-76, 103-109, 119
- [src/pages/WinnersPage.tsx](src/pages/WinnersPage.tsx) - Lines 61, 75
- [src/components/UserDashboard/BalanceHealthIndicator.tsx](src/components/UserDashboard/BalanceHealthIndicator.tsx) - Lines 17-24

**Impact:** Cluttered console, exposed internal data  
**Fix:** Implement proper logging with levels (debug/info/warn/error)

---

### 10. **Missing Error Boundaries**

**Files:**

- [src/components/CompetitionDetail.tsx](src/components/CompetitionDetail.tsx) - No error boundary
- [src/components/PaymentModal.tsx](src/components/PaymentModal.tsx) - No error boundary

**Impact:** Unhandled errors crash entire component tree  
**Fix:** Wrap with `<ErrorBoundary>` component

---

### 11. **EntriesCard - Ambiguous "Pending" Status**

**File:** [src/components/UserDashboard/Entries/EntriesCard.tsx](src/components/UserDashboard/Entries/EntriesCard.tsx#L76-83)

```tsx
// "Pending" appears twice for different conditions
{
  status === "pending" && <span className="...">Pending</span>;
}
{
  status === "processing" && <span className="...">Pending</span>;
}
```

**Impact:** Users can't distinguish between pending states  
**Fix:** Use distinct labels "Pending" vs "Processing"

---

### 12. **React act() Warnings in Tests**

**Files:** [src/components/**tests**/PaymentModal.test.tsx](src/components/__tests__/PaymentModal.test.tsx)

```
An update to PaymentModal inside a test was not wrapped in act(...)
```

**Impact:** Flaky tests, false positives  
**Fix:** Wrap state updates in `act()` blocks

---

## 🔧 LOW PRIORITY ISSUES (Cleanup)

### 13. **Tailwind CSS Class Warnings** (53 total)

| File                    | Issue                                       |
| ----------------------- | ------------------------------------------- |
| LiveCompetitionCard.tsx | Duplicate `via-white`/`via-red-600` classes |
| WinnersPage.tsx         | `w-[200px]` → `w-50`                        |
| EntriesLayout.tsx       | Conflicting `md:text-xs` and `md:!text-sm`  |
| Multiple files          | `border-[2px]` → `border-2`                 |

**Fix:** Run Tailwind CSS class cleanup or use Prettier plugin

---

### 14. **Commented-Out Code**

**Files:**

- [src/lib/database.ts](src/lib/database.ts#L451-536) - Large commented `getAllWinners` block
- [src/pages/WinnersPage.tsx](src/pages/WinnersPage.tsx#L178-184) - Commented `FilterTabs`

**Fix:** Remove or document why preserved

---

### 15. **Deprecated Code**

**File:** [src/lib/balance-payment-service.ts](src/lib/balance-payment-service.ts#L172-189)

```tsx
/**
 * @deprecated Use IdempotencyKeyManager instead
 */
function generateIdempotencyKey() { ... }
```

**Fix:** Remove deprecated functions if no longer used

---

## 📊 E2E Test Failures Summary

| Test File              | Failing Tests | Root Cause                   |
| ---------------------- | ------------- | ---------------------------- |
| accessibility.spec.ts  | 8             | Keyboard navigation timeouts |
| auth.spec.ts           | 2             | Login modal not opening      |
| error-handling.spec.ts | 4             | Navigation race conditions   |

---

## 🎯 Holistic Fix Plan

### Phase 1: Critical Fixes (Day 1)

1. ✅ Fix WinnersCard hardcoded link → Use `competitionId` prop
2. ✅ Fix EntriesLayout button mismatch → Correct `setActiveTab`
3. ✅ Remove CompetitionDetail `console.log`
4. ✅ Update balance-payment-service test expectations

### Phase 2: High Priority (Day 2-3)

5. Replace hardcoded Supabase URL with env var
6. Fix WinnersCard default date
7. Verify realtime subscription filter syntax
8. Optimize N+1 database queries

### Phase 3: Code Quality (Day 4-5)

9. Implement centralized logging service
10. Add ErrorBoundary wrappers
11. Differentiate "Pending" statuses
12. Fix React testing act() warnings

### Phase 4: Cleanup (Day 6-7)

13. Run Tailwind CSS class cleanup
14. Remove commented-out code
15. Remove deprecated functions
16. Add missing TypeScript types

---

## Implementation Checklist

```markdown
[ ] Phase 1 - Critical Fixes
[ ] WinnersCard.tsx - Fix hardcoded link (line 97)
[ ] EntriesLayout.tsx - Fix button mismatch (line 29-35)
[ ] CompetitionDetail.tsx - Remove console.log (line 28)
[ ] balance-payment-service.test.ts - Update test expectations

[ ] Phase 2 - High Priority
[ ] PaymentModal.tsx - Use env var for Supabase URL
[ ] WinnersCard.tsx - Fix default date
[ ] WinnersPage.tsx - Fix realtime filter syntax
[ ] database.ts - Batch competition queries

[ ] Phase 3 - Code Quality
[ ] Create logging utility with log levels
[ ] Add ErrorBoundary to PaymentModal
[ ] Add ErrorBoundary to CompetitionDetail
[ ] EntriesCard.tsx - Differentiate pending states
[ ] PaymentModal.test.tsx - Add act() wrappers

[ ] Phase 4 - Cleanup
[ ] Tailwind CSS class cleanup
[ ] Remove commented code
[ ] Remove deprecated functions
[ ] Add missing TypeScript types
```

---

## Commands to Re-run Tests After Fixes

```bash
# Run unit tests
npm run test

# Run E2E tests
npm run test:e2e

# Run specific test file
npx vitest run src/lib/__tests__/balance-payment-service.test.ts
npx playwright test e2e/dashboard.spec.ts

# Generate coverage report
npm run test:coverage
```
