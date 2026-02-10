#!/bin/bash

# Quick Deploy Script - CORS Fix for purchase-tickets-with-bonus
# This script deploys ONLY the critical function with CORS fix

set -e

echo "=================================================="
echo "  Quick Deploy: purchase-tickets-with-bonus"
echo "  CORS Fix Deployment"
echo "=================================================="
echo ""

# Check Supabase CLI
if ! command -v supabase &> /dev/null; then
    echo "❌ ERROR: Supabase CLI not found"
    echo ""
    echo "Install it with:"
    echo "  npm install -g supabase"
    echo ""
    echo "Or use Supabase Dashboard:"
    echo "  https://app.supabase.com/project/mthwfldcjvpxjtmrqkqm"
    exit 1
fi

echo "✓ Supabase CLI found"

# Check login
if ! supabase projects list &> /dev/null; then
    echo "❌ ERROR: Not logged in"
    echo ""
    echo "Login with:"
    echo "  supabase login"
    exit 1
fi

echo "✓ Logged in to Supabase"
echo ""

# Deploy
echo "Deploying purchase-tickets-with-bonus..."
echo ""

if supabase functions deploy purchase-tickets-with-bonus; then
    echo ""
    echo "=================================================="
    echo "✅ SUCCESS!"
    echo "=================================================="
    echo ""
    echo "Edge function deployed successfully!"
    echo ""
    echo "Next steps:"
    echo "1. Run verification: ./verify-cors-fix.sh"
    echo "2. Test in browser at: https://stage.theprize.io"
    echo "3. Check for any remaining errors"
    echo ""
    echo "If you see database errors:"
    echo "  Run: cat supabase/HOTFIX_add_updated_at_to_sub_account_balances.sql"
    echo "  Copy the SQL and run it in Supabase SQL Editor"
    echo ""
else
    echo ""
    echo "=================================================="
    echo "❌ DEPLOYMENT FAILED"
    echo "=================================================="
    echo ""
    echo "Possible causes:"
    echo "1. Not linked to project"
    echo "   Fix: supabase link --project-ref mthwfldcjvpxjtmrqkqm"
    echo ""
    echo "2. No permissions"
    echo "   Fix: Login with admin account"
    echo ""
    echo "3. Function has errors"
    echo "   Fix: Check function logs in Supabase Dashboard"
    echo ""
    exit 1
fi
