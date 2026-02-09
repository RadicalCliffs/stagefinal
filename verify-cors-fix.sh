#!/bin/bash

# Verification Script for CORS Fix Deployment
# Tests the purchase-tickets-with-bonus edge function to ensure CORS is working

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "============================================"
echo "  CORS Fix Verification Script"
echo "============================================"
echo ""

# Configuration
FUNCTION_URL="https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/purchase-tickets-with-bonus"
ORIGIN="https://substage.theprize.io"

# Test 1: OPTIONS Preflight Request
echo "Test 1: OPTIONS Preflight Request"
echo "-----------------------------------"
echo "Testing: $FUNCTION_URL"
echo "Origin: $ORIGIN"
echo ""

RESPONSE=$(curl -s -i -X OPTIONS \
  "$FUNCTION_URL" \
  -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type")

# Check HTTP status
HTTP_STATUS=$(echo "$RESPONSE" | grep -i "^HTTP" | awk '{print $2}')
echo "HTTP Status: $HTTP_STATUS"

if [ "$HTTP_STATUS" = "200" ]; then
  echo -e "${GREEN}✅ PASS: Returns HTTP 200${NC}"
elif [ "$HTTP_STATUS" = "204" ]; then
  echo -e "${RED}❌ FAIL: Returns HTTP 204 (old code)${NC}"
  echo -e "${YELLOW}ACTION REQUIRED: Deploy the updated edge function${NC}"
  exit 1
else
  echo -e "${RED}❌ FAIL: Returns HTTP $HTTP_STATUS${NC}"
  exit 1
fi

# Check CORS headers
echo ""
echo "Checking CORS Headers:"
echo "----------------------"

# Access-Control-Allow-Origin
if echo "$RESPONSE" | grep -qi "access-control-allow-origin: $ORIGIN"; then
  echo -e "${GREEN}✅ PASS: Access-Control-Allow-Origin = $ORIGIN${NC}"
else
  echo -e "${RED}❌ FAIL: Missing or incorrect Access-Control-Allow-Origin${NC}"
  exit 1
fi

# Access-Control-Allow-Credentials
if echo "$RESPONSE" | grep -qi "access-control-allow-credentials: true"; then
  echo -e "${GREEN}✅ PASS: Access-Control-Allow-Credentials = true${NC}"
else
  echo -e "${RED}❌ FAIL: Missing Access-Control-Allow-Credentials${NC}"
  exit 1
fi

# Access-Control-Allow-Methods
if echo "$RESPONSE" | grep -qi "access-control-allow-methods"; then
  echo -e "${GREEN}✅ PASS: Access-Control-Allow-Methods present${NC}"
else
  echo -e "${RED}❌ FAIL: Missing Access-Control-Allow-Methods${NC}"
  exit 1
fi

# Access-Control-Allow-Headers
if echo "$RESPONSE" | grep -qi "access-control-allow-headers"; then
  echo -e "${GREEN}✅ PASS: Access-Control-Allow-Headers present${NC}"
else
  echo -e "${RED}❌ FAIL: Missing Access-Control-Allow-Headers${NC}"
  exit 1
fi

# Vary: Origin
if echo "$RESPONSE" | grep -qi "vary: origin"; then
  echo -e "${GREEN}✅ PASS: Vary: Origin present${NC}"
else
  echo -e "${YELLOW}⚠️  WARNING: Vary: Origin missing (may cause cache issues)${NC}"
fi

echo ""
echo "============================================"

# Test 2: POST Request with CORS
echo ""
echo "Test 2: POST Request (Error Response)"
echo "--------------------------------------"
echo "Testing CORS headers on error response..."
echo ""

RESPONSE=$(curl -s -i -X POST \
  "$FUNCTION_URL" \
  -H "Origin: $ORIGIN" \
  -H "Content-Type: application/json" \
  -d '{}')

# Check HTTP status (should be 400 for empty body)
HTTP_STATUS=$(echo "$RESPONSE" | grep -i "^HTTP" | awk '{print $2}')
echo "HTTP Status: $HTTP_STATUS"

if [ "$HTTP_STATUS" = "400" ]; then
  echo -e "${GREEN}✅ PASS: Returns HTTP 400 (expected for empty body)${NC}"
elif [ "$HTTP_STATUS" = "500" ]; then
  echo -e "${YELLOW}⚠️  WARNING: Returns HTTP 500 (may indicate database issue)${NC}"
  echo -e "${YELLOW}Check if updated_at column exists in sub_account_balances${NC}"
else
  echo -e "${YELLOW}⚠️  INFO: Returns HTTP $HTTP_STATUS${NC}"
fi

# Check CORS headers on error response
echo ""
echo "Checking CORS Headers on Error Response:"
if echo "$RESPONSE" | grep -qi "access-control-allow-origin: $ORIGIN"; then
  echo -e "${GREEN}✅ PASS: CORS headers present on error response${NC}"
else
  echo -e "${RED}❌ FAIL: Missing CORS headers on error response${NC}"
  exit 1
fi

echo ""
echo "============================================"
echo ""

# Summary
echo -e "${GREEN}✅ ALL TESTS PASSED!${NC}"
echo ""
echo "CORS fix is deployed and working correctly!"
echo ""
echo "Next steps:"
echo "1. Test in browser at: https://substage.theprize.io"
echo "2. Open browser console and check for CORS errors"
echo "3. Try purchasing tickets with balance"
echo "4. Verify no 'Failed to fetch' or 'HTTP 0' errors"
echo ""
echo "If you still see errors in the browser:"
echo "- Clear browser cache (Ctrl+Shift+R)"
echo "- Check database schema (updated_at column)"
echo "- Review Supabase function logs"
echo ""
echo "============================================"
