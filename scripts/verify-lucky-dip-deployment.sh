#!/bin/bash

# Verify lucky-dip-reserve Edge Function Deployment
#
# This script verifies that the lucky-dip-reserve edge function is:
# 1. Deployed and accessible
# 2. Responding to CORS preflight requests
# 3. Handling requests properly
# 4. Returning expected responses
#
# Usage:
#   ./verify-lucky-dip-deployment.sh [PROJECT_REF] [COMPETITION_ID]
#
# Examples:
#   ./verify-lucky-dip-deployment.sh mthwfldcjvpxjtmrqkqm e94f8f02-1234-5678-9abc-def012345678
#   ./verify-lucky-dip-deployment.sh  # Will prompt for inputs

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Icons
CHECK="✓"
CROSS="✗"
WARN="⚠"
INFO="ℹ"

echo ""
echo "========================================="
echo "  Lucky Dip Reserve - Deployment Verification"
echo "========================================="
echo ""

# Get project ref
PROJECT_REF="${1}"
if [ -z "$PROJECT_REF" ]; then
    echo -e "${BLUE}${INFO} Enter your Supabase project reference ID:${NC}"
    echo "   (Find it in: Supabase Dashboard → Settings → General → Reference ID)"
    read -p "   Project Ref: " PROJECT_REF
fi

if [ -z "$PROJECT_REF" ]; then
    echo -e "${RED}${CROSS} Error: Project reference ID is required${NC}"
    exit 1
fi

# Get competition ID (optional for full testing)
COMPETITION_ID="${2}"
if [ -z "$COMPETITION_ID" ]; then
    echo ""
    echo -e "${YELLOW}${WARN} Competition ID not provided - will skip full function test${NC}"
    echo "   To test the full function, provide a valid competition UUID"
    echo "   Example: ./verify-lucky-dip-deployment.sh $PROJECT_REF e94f8f02-1234-5678-9abc-def012345678"
    echo ""
fi

BASE_URL="https://${PROJECT_REF}.supabase.co/functions/v1/lucky-dip-reserve"

echo -e "${BLUE}Testing edge function at:${NC}"
echo "  $BASE_URL"
echo ""

# Test 1: CORS Preflight
echo "========================================="
echo "Test 1: CORS Preflight Request"
echo "========================================="
echo ""

CORS_RESPONSE=$(curl -X OPTIONS "$BASE_URL" \
  -H 'Origin: https://stage.theprize.io' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type,authorization' \
  -s -i)

CORS_STATUS=$(echo "$CORS_RESPONSE" | grep -i "HTTP" | awk '{print $2}')
CORS_ALLOW_ORIGIN=$(echo "$CORS_RESPONSE" | grep -i "access-control-allow-origin" | cut -d' ' -f2 | tr -d '\r')
CORS_ALLOW_CREDS=$(echo "$CORS_RESPONSE" | grep -i "access-control-allow-credentials" | cut -d' ' -f2 | tr -d '\r')

if [ "$CORS_STATUS" = "200" ]; then
    echo -e "${GREEN}${CHECK} Status: $CORS_STATUS OK${NC}"
else
    echo -e "${RED}${CROSS} Status: $CORS_STATUS (Expected: 200)${NC}"
fi

if [ ! -z "$CORS_ALLOW_ORIGIN" ]; then
    echo -e "${GREEN}${CHECK} Access-Control-Allow-Origin: $CORS_ALLOW_ORIGIN${NC}"
else
    echo -e "${RED}${CROSS} Missing Access-Control-Allow-Origin header${NC}"
fi

if [ "$CORS_ALLOW_CREDS" = "true" ]; then
    echo -e "${GREEN}${CHECK} Access-Control-Allow-Credentials: true${NC}"
else
    echo -e "${RED}${CROSS} Access-Control-Allow-Credentials not set to 'true'${NC}"
fi

echo ""

# Test 2: Invalid Request (Missing Parameters)
echo "========================================="
echo "Test 2: Error Handling (Missing Parameters)"
echo "========================================="
echo ""

ERROR_RESPONSE=$(curl -X POST "$BASE_URL" \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://stage.theprize.io' \
  -d '{}' \
  -s)

ERROR_SUCCESS=$(echo "$ERROR_RESPONSE" | jq -r '.success // empty')
ERROR_MSG=$(echo "$ERROR_RESPONSE" | jq -r '.error // empty')
ERROR_CODE=$(echo "$ERROR_RESPONSE" | jq -r '.errorCode // empty')

if [ "$ERROR_SUCCESS" = "false" ]; then
    echo -e "${GREEN}${CHECK} Function correctly returns error for invalid request${NC}"
    echo "   Error message: $ERROR_MSG"
    echo "   Error code: $ERROR_CODE"
else
    echo -e "${RED}${CROSS} Function did not return expected error response${NC}"
    echo "   Response: $ERROR_RESPONSE"
fi

echo ""

# Test 3: Full Function Test (if competition ID provided)
if [ ! -z "$COMPETITION_ID" ]; then
    echo "========================================="
    echo "Test 3: Full Function Test"
    echo "========================================="
    echo ""
    echo "Testing with:"
    echo "  Competition ID: $COMPETITION_ID"
    echo "  User ID: prize:pid:test-user-$(date +%s)"
    echo "  Ticket Count: 3"
    echo ""

    FULL_RESPONSE=$(curl -X POST "$BASE_URL" \
      -H 'Content-Type: application/json' \
      -H 'Origin: https://stage.theprize.io' \
      -d "{
        \"userId\": \"prize:pid:test-user-$(date +%s)\",
        \"competitionId\": \"$COMPETITION_ID\",
        \"count\": 3,
        \"ticketPrice\": 1,
        \"holdMinutes\": 15
      }" \
      -s)

    FULL_SUCCESS=$(echo "$FULL_RESPONSE" | jq -r '.success // empty')
    FULL_RESERVATION_ID=$(echo "$FULL_RESPONSE" | jq -r '.reservationId // empty')
    FULL_TICKET_COUNT=$(echo "$FULL_RESPONSE" | jq -r '.ticketCount // empty')
    FULL_ERROR=$(echo "$FULL_RESPONSE" | jq -r '.error // empty')

    if [ "$FULL_SUCCESS" = "true" ]; then
        echo -e "${GREEN}${CHECK} SUCCESS: Function reserved tickets${NC}"
        echo "   Reservation ID: $FULL_RESERVATION_ID"
        echo "   Ticket Count: $FULL_TICKET_COUNT"
        echo ""
        echo -e "${GREEN}Full response:${NC}"
        echo "$FULL_RESPONSE" | jq '.'
    elif [ "$FULL_SUCCESS" = "false" ]; then
        echo -e "${YELLOW}${WARN} Function returned error (may be expected):${NC}"
        echo "   Error: $FULL_ERROR"
        echo ""
        echo "This may be expected if:"
        echo "  - Competition ID is invalid"
        echo "  - Competition is not active"
        echo "  - Insufficient tickets available"
        echo ""
        echo -e "${YELLOW}Full response:${NC}"
        echo "$FULL_RESPONSE" | jq '.'
    else
        echo -e "${RED}${CROSS} Unexpected response format${NC}"
        echo "$FULL_RESPONSE" | jq '.' || echo "$FULL_RESPONSE"
    fi

    echo ""
fi

# Test 4: Check Function Logs (if Supabase CLI available)
echo "========================================="
echo "Test 4: Function Logs"
echo "========================================="
echo ""

if command -v supabase &> /dev/null; then
    echo -e "${GREEN}${CHECK} Supabase CLI found${NC}"
    echo ""
    echo "Recent logs (last 10 entries):"
    echo "---"
    supabase functions logs lucky-dip-reserve --limit 10 2>&1 || echo -e "${YELLOW}${WARN} Could not fetch logs (may need to link project)${NC}"
    echo ""
else
    echo -e "${YELLOW}${WARN} Supabase CLI not found${NC}"
    echo "   Install: npm install -g supabase"
    echo "   Then run: supabase functions logs lucky-dip-reserve"
    echo ""
fi

# Summary
echo "========================================="
echo "  Verification Summary"
echo "========================================="
echo ""

TESTS_PASSED=0
TESTS_TOTAL=2

# CORS Test
if [ "$CORS_STATUS" = "200" ] && [ ! -z "$CORS_ALLOW_ORIGIN" ]; then
    echo -e "${GREEN}${CHECK} CORS Configuration: PASSED${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    echo -e "${RED}${CROSS} CORS Configuration: FAILED${NC}"
fi

# Error Handling Test
if [ "$ERROR_SUCCESS" = "false" ]; then
    echo -e "${GREEN}${CHECK} Error Handling: PASSED${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    echo -e "${RED}${CROSS} Error Handling: FAILED${NC}"
fi

# Full Function Test (if run)
if [ ! -z "$COMPETITION_ID" ]; then
    TESTS_TOTAL=$((TESTS_TOTAL + 1))
    if [ "$FULL_SUCCESS" = "true" ]; then
        echo -e "${GREEN}${CHECK} Full Function Test: PASSED${NC}"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    elif [ "$FULL_SUCCESS" = "false" ]; then
        echo -e "${YELLOW}${WARN} Full Function Test: RETURNED ERROR (check if expected)${NC}"
    else
        echo -e "${RED}${CROSS} Full Function Test: FAILED${NC}"
    fi
fi

echo ""
echo "Tests Passed: $TESTS_PASSED / $TESTS_TOTAL"
echo ""

if [ $TESTS_PASSED -eq $TESTS_TOTAL ]; then
    echo -e "${GREEN}=========================================${NC}"
    echo -e "${GREEN}  ✓ ALL TESTS PASSED${NC}"
    echo -e "${GREEN}=========================================${NC}"
    echo ""
    echo "The lucky-dip-reserve edge function is deployed and working!"
    echo ""
    echo "Next steps:"
    echo "1. Test on the frontend by reserving lucky dip tickets"
    echo "2. Monitor function logs: supabase functions logs lucky-dip-reserve --tail"
    echo "3. Verify reservations expire after 15 minutes"
    echo ""
else
    echo -e "${RED}=========================================${NC}"
    echo -e "${RED}  ✗ SOME TESTS FAILED${NC}"
    echo -e "${RED}=========================================${NC}"
    echo ""
    echo "Troubleshooting steps:"
    echo "1. Verify function is deployed:"
    echo "   supabase functions list"
    echo ""
    echo "2. Redeploy the function:"
    echo "   supabase functions deploy lucky-dip-reserve"
    echo ""
    echo "3. Check environment variables in Supabase Dashboard:"
    echo "   - SUPABASE_URL"
    echo "   - SUPABASE_SERVICE_ROLE_KEY"
    echo "   - SITE_URL"
    echo ""
    echo "4. Check function logs for errors:"
    echo "   supabase functions logs lucky-dip-reserve --tail"
    echo ""
    echo "5. See EDGE_FUNCTION_DEPLOYMENT_GUIDE.md for detailed troubleshooting"
    echo ""
    exit 1
fi
