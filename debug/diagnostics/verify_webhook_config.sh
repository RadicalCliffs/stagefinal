#!/bin/bash
# =====================================================
# Webhook Configuration Verification Script
# =====================================================
# This script verifies that Coinbase Commerce webhooks
# are properly configured and can reach Supabase
# Last Updated: January 18, 2026
# =====================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================="
echo "Webhook Configuration Verification"
echo "========================================="
echo ""

# Get Supabase URL from environment or prompt
if [ -z "$SUPABASE_URL" ]; then
    echo "SUPABASE_URL not set in environment"
    read -p "Enter your Supabase URL (e.g., https://xxx.supabase.co): " SUPABASE_URL
fi

# Construct webhook URL
WEBHOOK_URL="${SUPABASE_URL}/functions/v1/commerce-webhook"

echo "Testing webhook endpoint: $WEBHOOK_URL"
echo ""

# =====================================================
# Test 1: Check if endpoint is accessible
# =====================================================
echo "Test 1: Checking if webhook endpoint is accessible..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"test": true}' 2>&1)

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "400" ] || [ "$HTTP_CODE" = "401" ]; then
    echo -e "${GREEN}✓ Endpoint is accessible (HTTP $HTTP_CODE)${NC}"
    echo "  Note: 400/401 is expected without valid signature"
else
    echo -e "${RED}✗ Endpoint is NOT accessible (HTTP $HTTP_CODE)${NC}"
    echo "  Expected: 200, 400, or 401"
    echo "  Got: $HTTP_CODE"
    exit 1
fi
echo ""

# =====================================================
# Test 2: Test OPTIONS (CORS preflight)
# =====================================================
echo "Test 2: Testing CORS preflight (OPTIONS request)..."
CORS_RESPONSE=$(curl -s -X OPTIONS "$WEBHOOK_URL" \
  -H "Origin: https://theprize.io" \
  -H "Access-Control-Request-Method: POST" \
  -w "\nHTTP_CODE:%{http_code}" 2>&1)

HTTP_CODE=$(echo "$CORS_RESPONSE" | grep "HTTP_CODE:" | cut -d':' -f2)

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "204" ]; then
    echo -e "${GREEN}✓ CORS preflight successful (HTTP $HTTP_CODE)${NC}"
else
    echo -e "${YELLOW}⚠ CORS preflight returned HTTP $HTTP_CODE${NC}"
    echo "  This may cause issues with browser-based webhooks"
fi
echo ""

# =====================================================
# Test 3: Check DNS resolution
# =====================================================
echo "Test 3: Checking DNS resolution..."
DOMAIN=$(echo "$SUPABASE_URL" | sed -e 's|^[^/]*//||' -e 's|/.*$||')
if host "$DOMAIN" > /dev/null 2>&1; then
    IP=$(host "$DOMAIN" | grep "has address" | head -1 | awk '{print $4}')
    echo -e "${GREEN}✓ DNS resolves correctly${NC}"
    echo "  Domain: $DOMAIN"
    echo "  IP: $IP"
else
    echo -e "${RED}✗ DNS resolution failed for $DOMAIN${NC}"
    exit 1
fi
echo ""

# =====================================================
# Test 4: Test with mock webhook signature
# =====================================================
echo "Test 4: Testing with mock webhook payload..."

# Create a test payload similar to Coinbase Commerce
TEST_PAYLOAD='{
  "event": {
    "type": "charge:pending",
    "data": {
      "id": "TEST_CHARGE_ID",
      "code": "TEST_CODE",
      "metadata": {
        "user_id": "test_user",
        "type": "test"
      }
    }
  }
}'

# Send test webhook
TEST_RESPONSE=$(curl -s -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "X-CC-Webhook-Signature: test_signature" \
  -d "$TEST_PAYLOAD" \
  -w "\nHTTP_CODE:%{http_code}" 2>&1)

HTTP_CODE=$(echo "$TEST_RESPONSE" | grep "HTTP_CODE:" | cut -d':' -f2)
RESPONSE_BODY=$(echo "$TEST_RESPONSE" | sed '/HTTP_CODE:/d')

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ Webhook accepts POST requests (HTTP 200)${NC}"
    echo "  Response: $(echo $RESPONSE_BODY | jq -r '.message' 2>/dev/null || echo $RESPONSE_BODY)"
elif [ "$HTTP_CODE" = "401" ]; then
    echo -e "${YELLOW}⚠ Webhook signature verification is enabled (HTTP 401)${NC}"
    echo "  This is GOOD - means webhook security is configured"
    echo "  Response: $(echo $RESPONSE_BODY | jq -r '.error' 2>/dev/null || echo $RESPONSE_BODY)"
else
    echo -e "${RED}✗ Unexpected response (HTTP $HTTP_CODE)${NC}"
    echo "  Response: $RESPONSE_BODY"
fi
echo ""

# =====================================================
# Summary and Next Steps
# =====================================================
echo "========================================="
echo "Verification Summary"
echo "========================================="
echo ""
echo "Webhook URL: $WEBHOOK_URL"
echo ""
echo -e "${GREEN}Next Steps:${NC}"
echo "1. Log into Coinbase Commerce Dashboard"
echo "   https://commerce.coinbase.com/dashboard/settings"
echo ""
echo "2. Navigate to: Settings → Webhooks"
echo ""
echo "3. Add or verify webhook endpoint:"
echo "   URL: $WEBHOOK_URL"
echo "   Events: Select all (especially charge:confirmed)"
echo ""
echo "4. Copy the webhook secret and add to Supabase:"
echo "   Dashboard → Edge Functions → Secrets"
echo "   Key: COINBASE_COMMERCE_WEBHOOK_SECRET"
echo "   Value: <paste your webhook secret>"
echo ""
echo "5. Test with a small payment (e.g., \$3 top-up)"
echo ""
echo "6. Monitor webhook events in Supabase:"
echo "   SELECT * FROM payment_webhook_events"
echo "   WHERE provider = 'coinbase_commerce'"
echo "   ORDER BY created_at DESC LIMIT 10;"
echo ""
echo "========================================="
echo ""

# Check if jq is installed for pretty printing
if ! command -v jq &> /dev/null; then
    echo -e "${YELLOW}Tip: Install 'jq' for better JSON output formatting${NC}"
    echo "  macOS: brew install jq"
    echo "  Linux: apt-get install jq"
    echo ""
fi

echo "For troubleshooting, see: PAYMENT_ARCHITECTURE_DIAGNOSTIC.md"
echo ""
