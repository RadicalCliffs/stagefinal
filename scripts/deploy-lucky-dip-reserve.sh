#!/bin/bash

# Deploy lucky-dip-reserve Edge Function to fix CORS issues
#
# Prerequisites:
# - Supabase CLI installed (npm install -g supabase)
# - Authenticated to Supabase (supabase login)
# - Project linked (supabase link --project-ref YOUR_PROJECT_REF)
#
# Usage:
#   ./deploy-lucky-dip-reserve.sh

set -e  # Exit on error

echo "========================================="
echo "  Deploy lucky-dip-reserve Function"
echo "========================================="
echo ""

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "❌ ERROR: Supabase CLI not found"
    echo ""
    echo "Please install Supabase CLI first:"
    echo "  npm install -g supabase"
    echo "  or visit: https://supabase.com/docs/guides/cli"
    exit 1
fi

echo "✓ Supabase CLI found"
echo ""

# Check if logged in
if ! supabase projects list &> /dev/null; then
    echo "❌ ERROR: Not logged in to Supabase"
    echo ""
    echo "Please login first:"
    echo "  supabase login"
    exit 1
fi

echo "✓ Logged in to Supabase"
echo ""

# Verify we're in the right directory
if [ ! -d "supabase/functions/lucky-dip-reserve" ]; then
    echo "❌ ERROR: lucky-dip-reserve function directory not found"
    echo "Please run this script from the repository root (theprize.io directory)"
    echo "Example: cd theprize.io && ./scripts/deploy-lucky-dip-reserve.sh"
    exit 1
fi

echo "✓ Found supabase/functions/lucky-dip-reserve directory"
echo ""

# Deploy the function
echo "Deploying lucky-dip-reserve Edge Function..."
echo ""

if supabase functions deploy lucky-dip-reserve; then
    echo ""
    echo "========================================="
    echo "  ✓ FUNCTION DEPLOYED SUCCESSFULLY"
    echo "========================================="
    echo ""
    echo "Next steps:"
    echo "1. Test lucky dip reservation on stage.theprize.io"
    echo "2. Navigate to a competition page"
    echo "3. Try to reserve lucky dip tickets"
    echo "4. Verify no CORS errors in browser console"
    echo ""
    echo "Verification command:"
    echo "  curl -X OPTIONS https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/lucky-dip-reserve \\"
    echo "    -H 'Origin: https://stage.theprize.io' -v"
    echo ""
    echo "Expected: Status 200 OK with Access-Control-Allow-Origin header"
    echo ""
    echo "For detailed testing and troubleshooting, see:"
    echo "  LUCKY_DIP_CORS_FIX.md"
    echo ""
else
    echo ""
    echo "========================================="
    echo "  ❌ DEPLOYMENT FAILED"
    echo "========================================="
    echo ""
    echo "Troubleshooting steps:"
    echo "1. Check if you're linked to the correct project:"
    echo "   supabase projects list"
    echo ""
    echo "2. Verify the function code has no syntax errors:"
    echo "   cat supabase/functions/lucky-dip-reserve/index.ts"
    echo ""
    echo "3. Check Supabase CLI logs for detailed error messages"
    echo ""
    echo "4. See LUCKY_DIP_CORS_FIX.md for more troubleshooting tips"
    echo ""
    exit 1
fi
