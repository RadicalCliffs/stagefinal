# Smoke Test Debug Report
## Date: 2026-02-09
## Repository: theprize.io

### Executive Summary
Comprehensive smoke tests were executed on the theprize.io repository. Overall health: **88% pass rate**

### Test Results Summary
- ✅ **Passed**: 24 tests
- ❌ **Failed**: 2 tests  
- ⚠️ **Warnings**: 1 test
- **Success Rate**: 88%

---

## Detailed Findings

### ✅ Passing Tests (24/27)

#### Infrastructure (5/5)
- ✅ Node modules installed
- ✅ package.json exists
- ✅ tsconfig.json exists
- ✅ vite.config.ts exists
- ✅ .env.example exists

#### Source Code Structure (4/4)
- ✅ src directory exists
- ✅ src/components exists
- ✅ src/lib exists
- ✅ src/hooks exists

#### Edge Functions (5/5)
- ✅ supabase/functions directory exists
- ✅ 89 edge functions found
- ✅ purchase-tickets-with-bonus exists
- ✅ update-user-avatar exists
- ✅ upsert-user exists

#### Database (2/2)
- ✅ supabase/migrations directory exists
- ✅ 59 migration files found

#### CORS Configuration (3/3)
- ✅ CORS shared module exists
- ✅ CORS credentials configuration present
- ✅ CORS OPTIONS status 200 implemented

#### Critical Files (4/4)
- ✅ src/lib/database.ts
- ✅ src/lib/supabase.ts
- ✅ src/App.tsx
- ✅ index.html

#### Security (1/1)
- ✅ .env in .gitignore

---

### ❌ Failing Tests (2/27)

#### 1. ESLint Check - FAILED
**Status**: Critical for code quality

**Issue**: Linter execution failed

**Details**:
- 16 ESLint errors
- 193 ESLint warnings
- Most common issues:
  - Unused variables (e.g., `useEffect`, `Calendar`, `status`)
  - React Hooks dependency array warnings
  - `prefer-const` violations
  
**Example Errors**:
```
src/components/FinishedCompetition/WinnerResultsTable.tsx:55:13
  error: 'usernameMap' is never reassigned. Use 'const' instead
```

**Impact**: Medium
- Code runs but with quality issues
- Potential bugs from unused variables
- Best practices not followed

**Recommended Fix**:
1. Fix the one `prefer-const` error:
   ```typescript
   // Line 55 in WinnerResultsTable.tsx
   let usernameMap = {}; // Change to:
   const usernameMap = {};
   ```
2. Run `npm run lint -- --fix` to auto-fix fixable issues
3. Review and address unused variable warnings

---

#### 2. TypeScript Compilation - FAILED  
**Status**: Critical for production deployment

**Issue**: 510 TypeScript errors preventing build

**Root Causes**:

##### A. Supabase Type Definition Issues (Primary)
The majority of errors stem from Supabase generated types being `never`:

```typescript
// Example from BaseWalletAuthModal.tsx
error TS2339: Property 'id' does not exist on type 'never'
error TS2345: Argument of type '{...}' is not assignable to parameter of type 'never'
```

**Affected Files**:
- `src/components/BaseWalletAuthModal.tsx` (~20 errors)
- `src/components/FinishedCompetition/EntriesWithFilterTabs.tsx`
- `src/components/FinishedCompetition/WinnerDetails.tsx`
- `src/lib/database.ts` (multiple errors)

**Root Cause**: Supabase type generation may be out of sync with database schema

##### B. Missing Type Definitions
```
error TS2688: Cannot find type definition file for 'node'
error TS2688: Cannot find type definition file for 'vite/client'
```

**Impact**: CRITICAL
- Build fails completely
- Cannot create production bundle
- Deployment blocked

**Recommended Fixes**:

1. **Regenerate Supabase Types** (Primary Fix):
   ```bash
   npx supabase gen types typescript --project-id <project-id> > src/types/supabase.ts
   ```

2. **Install Missing Type Definitions**:
   ```bash
   npm install --save-dev @types/node
   ```
   
3. **Type Assertion Workaround** (Temporary):
   For critical paths, add type assertions:
   ```typescript
   const data = await supabase
     .from('canonical_users')
     .select('*')
     .single() as { data: CanonicalUser, error: any }
   ```

4. **Update tsconfig.json**:
   Ensure types are properly included:
   ```json
   {
     "compilerOptions": {
       "types": ["vite/client", "node"]
     }
   }
   ```

---

### ⚠️ Warnings (1/27)

#### npm Security Audit
**Status**: Non-blocking but should be addressed

**Details**:
- 5 vulnerabilities found
- 1 moderate
- 4 high

**Recommended Action**:
```bash
npm audit
npm audit fix
# If needed:
npm audit fix --force
```

**Impact**: Low to Medium
- May have security implications
- Should be addressed before production
- Not blocking development

---

## Additional Findings

### Test Infrastructure
- ✅ One unit test file found: `src/components/IndividualCompetition/__tests__/ticketAvailabilityLogic.test.ts`
- ⚠️ Unit test cannot run due to SVG import issues
- ❌ No Playwright e2e tests configured yet (package.json references them)
- ⚠️ No test runner configured (no jest, vitest, etc.)

### Code Quality Metrics
- **Lint Warnings**: 193
- **Lint Errors**: 16
- **TypeScript Errors**: 510
- **Edge Functions**: 89 (good coverage)
- **Database Migrations**: 59 (active development)

---

## Critical Path Analysis

### Blockers for Production
1. ❌ TypeScript compilation errors (510 errors)
2. ❌ ESLint errors (16 errors)

### Non-Blockers
- ⚠️ ESLint warnings (193 - code quality)
- ⚠️ npm security vulnerabilities (5 - security)
- ⚠️ Test infrastructure incomplete

---

## Recommendations

### Immediate Actions (P0)
1. **Fix TypeScript Compilation**
   - Regenerate Supabase types
   - Install missing @types packages
   - Verify build succeeds

2. **Fix ESLint Errors**
   - Fix `prefer-const` error in WinnerResultsTable.tsx
   - Run lint --fix for auto-fixable issues

### Short Term (P1)
1. **Address Security Vulnerabilities**
   - Run npm audit fix
   - Review and update vulnerable packages

2. **Improve Code Quality**
   - Review and fix unused variable warnings
   - Address React Hooks dependency warnings

### Medium Term (P2)
1. **Establish Test Infrastructure**
   - Configure test runner (vitest recommended for Vite)
   - Set up e2e tests with Playwright
   - Create smoke test suite as part of CI/CD

2. **Documentation**
   - Document build process
   - Create debugging guide
   - Establish testing standards

---

## Test Artifacts

### Generated Files
- `/tmp/lint_output.txt` - Full linter output
- `/tmp/build_output.txt` - Full build output  
- `/tmp/npm_audit.json` - Security audit results
- `smoke-test.sh` - Reusable smoke test script

### Rerun Tests
```bash
# Full smoke test
./smoke-test.sh

# Individual tests
npm run lint
npm run build
npm audit
```

---

## Conclusion

The repository is in **active development** with good infrastructure but has **critical TypeScript issues** preventing production builds. The primary blocker is Supabase type generation being out of sync with the database schema.

**Recommendation**: Address TypeScript compilation errors as P0 priority before any deployment.

**Estimated Fix Time**:
- TypeScript issues: 2-4 hours (mostly regenerating types)
- ESLint errors: 15-30 minutes
- Security audit: 30 minutes

**Overall Health**: 🟡 Yellow (Good infrastructure, needs type fixes)
