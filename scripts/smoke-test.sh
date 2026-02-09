#!/bin/bash
# Comprehensive Smoke Test Suite for theprize.io
# This script runs various smoke tests to validate the application

set -e

echo "🧪 Starting Comprehensive Smoke Test Suite"
echo "=========================================="
echo ""

PASSED=0
FAILED=0
WARNINGS=0

# Function to report test results
report_test() {
    local test_name="$1"
    local status="$2"
    local details="$3"
    
    if [ "$status" = "PASS" ]; then
        echo "✅ PASS: $test_name"
        PASSED=$((PASSED + 1))
    elif [ "$status" = "FAIL" ]; then
        echo "❌ FAIL: $test_name"
        [ -n "$details" ] && echo "   Details: $details"
        FAILED=$((FAILED + 1))
    elif [ "$status" = "WARN" ]; then
        echo "⚠️  WARN: $test_name"
        [ -n "$details" ] && echo "   Details: $details"
        WARNINGS=$((WARNINGS + 1))
    fi
}

echo "1. Testing Package Installation"
echo "--------------------------------"
if [ -d "node_modules" ]; then
    report_test "Node modules installed" "PASS"
else
    report_test "Node modules installed" "FAIL" "Run npm install"
fi

echo ""
echo "2. Testing Configuration Files"
echo "--------------------------------"
if [ -f "package.json" ]; then
    report_test "package.json exists" "PASS"
else
    report_test "package.json exists" "FAIL"
fi

if [ -f "tsconfig.json" ]; then
    report_test "tsconfig.json exists" "PASS"
else
    report_test "tsconfig.json exists" "FAIL"
fi

if [ -f "vite.config.ts" ]; then
    report_test "vite.config.ts exists" "PASS"
else
    report_test "vite.config.ts exists" "FAIL"
fi

if [ -f ".env.example" ]; then
    report_test ".env.example exists" "PASS"
else
    report_test ".env.example exists" "WARN" "No .env.example found"
fi

echo ""
echo "3. Testing Source Code Structure"
echo "--------------------------------"
if [ -d "src" ]; then
    report_test "src directory exists" "PASS"
    
    # Check for key directories
    [ -d "src/components" ] && report_test "src/components exists" "PASS" || report_test "src/components exists" "FAIL"
    [ -d "src/lib" ] && report_test "src/lib exists" "PASS" || report_test "src/lib exists" "FAIL"
    [ -d "src/hooks" ] && report_test "src/hooks exists" "PASS" || report_test "src/hooks exists" "FAIL"
else
    report_test "src directory exists" "FAIL"
fi

echo ""
echo "4. Testing Edge Functions"
echo "--------------------------------"
if [ -d "supabase/functions" ]; then
    report_test "supabase/functions directory exists" "PASS"
    
    # Count edge functions
    FUNC_COUNT=$(find supabase/functions -maxdepth 1 -type d | wc -l)
    report_test "Edge functions found: $((FUNC_COUNT - 1))" "PASS"
    
    # Check critical functions
    [ -d "supabase/functions/purchase-tickets-with-bonus" ] && report_test "purchase-tickets-with-bonus exists" "PASS"
    [ -d "supabase/functions/update-user-avatar" ] && report_test "update-user-avatar exists" "PASS"
    [ -d "supabase/functions/upsert-user" ] && report_test "upsert-user exists" "PASS"
else
    report_test "supabase/functions directory exists" "FAIL"
fi

echo ""
echo "5. Testing Linter"
echo "--------------------------------"
if npm run lint > /tmp/lint_output.txt 2>&1; then
    ERROR_COUNT=$(grep -c "error" /tmp/lint_output.txt || echo "0")
    WARN_COUNT=$(grep -c "warning" /tmp/lint_output.txt || echo "0")
    
    if [ "$ERROR_COUNT" -eq 0 ]; then
        report_test "ESLint check" "PASS" "$WARN_COUNT warnings found"
    else
        report_test "ESLint check" "FAIL" "$ERROR_COUNT errors, $WARN_COUNT warnings"
    fi
else
    report_test "ESLint check" "FAIL" "Linter failed to run"
fi

echo ""
echo "6. Testing TypeScript Compilation"
echo "--------------------------------"
if npm run build > /tmp/build_output.txt 2>&1; then
    report_test "TypeScript compilation" "PASS"
else
    TS_ERRORS=$(grep -c "error TS" /tmp/build_output.txt || echo "0")
    report_test "TypeScript compilation" "FAIL" "$TS_ERRORS TypeScript errors found"
fi

echo ""
echo "7. Testing Database Migrations"
echo "--------------------------------"
if [ -d "supabase/migrations" ]; then
    report_test "supabase/migrations directory exists" "PASS"
    
    MIGRATION_COUNT=$(find supabase/migrations -name "*.sql" -type f | wc -l)
    report_test "Migration files found: $MIGRATION_COUNT" "PASS"
else
    report_test "supabase/migrations directory exists" "FAIL"
fi

echo ""
echo "8. Testing CORS Configuration"
echo "--------------------------------"
if [ -f "supabase/functions/_shared/cors.ts" ]; then
    report_test "CORS shared module exists" "PASS"
    
    # Check for proper CORS implementation
    if grep -q "Access-Control-Allow-Credentials" supabase/functions/_shared/cors.ts; then
        report_test "CORS credentials configuration" "PASS"
    else
        report_test "CORS credentials configuration" "WARN"
    fi
    
    if grep -q "status: 200" supabase/functions/_shared/cors.ts; then
        report_test "CORS OPTIONS status 200" "PASS"
    else
        report_test "CORS OPTIONS status 200" "FAIL"
    fi
else
    report_test "CORS shared module exists" "FAIL"
fi

echo ""
echo "9. Testing Critical Files"
echo "--------------------------------"
CRITICAL_FILES=(
    "src/lib/database.ts"
    "src/lib/supabase.ts"
    "src/App.tsx"
    "index.html"
)

for file in "${CRITICAL_FILES[@]}"; do
    if [ -f "$file" ]; then
        report_test "Critical file: $file" "PASS"
    else
        report_test "Critical file: $file" "FAIL"
    fi
done

echo ""
echo "10. Testing Security"
echo "--------------------------------"
# Check for exposed secrets
if [ -f ".env" ]; then
    report_test ".env file exists" "WARN" "Ensure it's in .gitignore"
fi

if grep -q ".env" .gitignore 2>/dev/null; then
    report_test ".env in .gitignore" "PASS"
else
    report_test ".env in .gitignore" "WARN"
fi

# Check npm audit
npm audit --json > /tmp/npm_audit.json 2>&1 || true
VULNERABILITIES=$(cat /tmp/npm_audit.json | grep -o '"vulnerabilities"' | wc -l || echo "0")
if [ "$VULNERABILITIES" -gt 0 ]; then
    report_test "npm security audit" "WARN" "Security vulnerabilities found"
else
    report_test "npm security audit" "PASS"
fi

echo ""
echo "=========================================="
echo "📊 Test Summary"
echo "=========================================="
echo "✅ Passed:   $PASSED"
echo "❌ Failed:   $FAILED"
echo "⚠️  Warnings: $WARNINGS"
echo ""

TOTAL=$((PASSED + FAILED + WARNINGS))
SUCCESS_RATE=$((PASSED * 100 / TOTAL))
echo "Success Rate: $SUCCESS_RATE%"
echo ""

if [ $FAILED -gt 0 ]; then
    echo "❌ Smoke tests FAILED - $FAILED tests failed"
    echo ""
    echo "Review the failures above and fix them before deploying."
    exit 1
else
    echo "✅ Smoke tests PASSED - All critical tests passed"
    [ $WARNINGS -gt 0 ] && echo "⚠️  $WARNINGS warnings to review"
    exit 0
fi
