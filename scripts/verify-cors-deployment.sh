#!/bin/bash
# CORS Edge Function Deployment Verification Script
# This script tests if the edge functions are returning the correct CORS headers

echo "🧪 CORS Edge Function Deployment Verification"
echo "=============================================="
echo ""

EDGE_FUNCTION_URL="https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/purchase-tickets-with-bonus"
ORIGIN="https://stage.theprize.io"

echo "Testing edge function: purchase-tickets-with-bonus"
echo "Origin: $ORIGIN"
echo ""

echo "1. Testing OPTIONS Preflight Request"
echo "-------------------------------------"

# Make OPTIONS request and capture response
RESPONSE=$(curl -s -i -X OPTIONS "$EDGE_FUNCTION_URL" \
  -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type" \
  2>&1)

echo "$RESPONSE" | head -20
echo ""

# Check status code
STATUS_CODE=$(echo "$RESPONSE" | grep "^HTTP" | awk '{print $2}')
echo "Status Code: $STATUS_CODE"

if [ "$STATUS_CODE" = "200" ]; then
    echo "✅ PASS: OPTIONS returns 200 OK"
elif [ "$STATUS_CODE" = "204" ]; then
    echo "❌ FAIL: OPTIONS returns 204 (edge function not deployed with fix)"
    echo "   Action needed: Deploy edge functions with: supabase functions deploy purchase-tickets-with-bonus"
else
    echo "❌ FAIL: OPTIONS returns $STATUS_CODE"
fi

echo ""

# Check CORS headers
echo "2. Checking CORS Headers"
echo "------------------------"

ALLOW_ORIGIN=$(echo "$RESPONSE" | grep -i "access-control-allow-origin:" | tr -d '\r' | cut -d: -f2- | xargs)
ALLOW_METHODS=$(echo "$RESPONSE" | grep -i "access-control-allow-methods:" | tr -d '\r' | cut -d: -f2- | xargs)
ALLOW_CREDENTIALS=$(echo "$RESPONSE" | grep -i "access-control-allow-credentials:" | tr -d '\r' | cut -d: -f2- | xargs)
ALLOW_HEADERS=$(echo "$RESPONSE" | grep -i "access-control-allow-headers:" | tr -d '\r' | cut -d: -f2- | xargs)

echo "Access-Control-Allow-Origin: $ALLOW_ORIGIN"
echo "Access-Control-Allow-Methods: $ALLOW_METHODS"
echo "Access-Control-Allow-Credentials: $ALLOW_CREDENTIALS"
echo "Access-Control-Allow-Headers: $ALLOW_HEADERS"
echo ""

# Validate headers
ISSUES=0

if [ -z "$ALLOW_ORIGIN" ]; then
    echo "❌ FAIL: Missing Access-Control-Allow-Origin header"
    ISSUES=$((ISSUES + 1))
elif [ "$ALLOW_ORIGIN" = "*" ]; then
    echo "⚠️  WARN: Using wildcard origin with credentials is not allowed"
    ISSUES=$((ISSUES + 1))
elif echo "$ALLOW_ORIGIN" | grep -q "stage.theprize.io\|theprize.io"; then
    echo "✅ PASS: Specific origin returned"
else
    echo "⚠️  WARN: Unexpected origin: $ALLOW_ORIGIN"
fi

if [ -z "$ALLOW_CREDENTIALS" ]; then
    echo "❌ FAIL: Missing Access-Control-Allow-Credentials header"
    ISSUES=$((ISSUES + 1))
elif [ "$ALLOW_CREDENTIALS" = "true" ]; then
    echo "✅ PASS: Credentials allowed"
else
    echo "⚠️  WARN: Credentials set to: $ALLOW_CREDENTIALS"
fi

echo ""
echo "=============================================="
echo "📊 Test Summary"
echo "=============================================="

if [ "$STATUS_CODE" = "200" ] && [ $ISSUES -eq 0 ]; then
    echo "✅ All tests passed - Edge function properly deployed"
    echo ""
    echo "The edge function is correctly configured with:"
    echo "  • Status 200 for OPTIONS"
    echo "  • Proper CORS headers"
    echo "  • Specific origin (not wildcard)"
    echo "  • Credentials enabled"
    exit 0
elif [ "$STATUS_CODE" = "204" ]; then
    echo "❌ Edge function NOT deployed with fixes"
    echo ""
    echo "The code fixes are in the repository but not deployed."
    echo ""
    echo "🚀 TO FIX:"
    echo "1. Ensure you have Supabase CLI installed and logged in"
    echo "2. Run: supabase functions deploy purchase-tickets-with-bonus"
    echo "3. Or run all critical functions: ./deploy-edge-functions.sh"
    echo ""
    echo "After deployment, run this script again to verify."
    exit 1
else
    echo "❌ Edge function has issues ($ISSUES issues found)"
    echo ""
    echo "Status: $STATUS_CODE"
    echo "Issues detected: $ISSUES"
    echo ""
    echo "Review the output above and fix the issues."
    exit 1
fi
