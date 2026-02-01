#!/bin/bash

# Deploy Edge Functions to Fix "Pay with Balance" Issue
# This script deploys the critical edge functions with the CORS fix
#
# Prerequisites:
# - Supabase CLI installed (https://supabase.com/docs/guides/cli)
# - Authenticated to Supabase project: supabase login
# - Project linked: supabase link --project-ref YOUR_PROJECT_REF
#
# Usage:
#   ./deploy-edge-functions.sh

set -e  # Exit on error

echo "========================================="
echo "  Deploy Edge Functions - CORS Fix"
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
if [ ! -d "supabase/functions" ]; then
    echo "❌ ERROR: Not in project root directory"
    echo "Please run this script from the repository root"
    exit 1
fi

echo "✓ Found supabase/functions directory"
echo ""

# Deploy the three critical functions
echo "Deploying critical edge functions..."
echo ""

echo "1/3: Deploying purchase-tickets-with-bonus..."
if supabase functions deploy purchase-tickets-with-bonus; then
    echo "    ✓ purchase-tickets-with-bonus deployed successfully"
else
    echo "    ❌ Failed to deploy purchase-tickets-with-bonus"
    exit 1
fi
echo ""

echo "2/3: Deploying update-user-avatar..."
if supabase functions deploy update-user-avatar; then
    echo "    ✓ update-user-avatar deployed successfully"
else
    echo "    ❌ Failed to deploy update-user-avatar"
    exit 1
fi
echo ""

echo "3/3: Deploying upsert-user..."
if supabase functions deploy upsert-user; then
    echo "    ✓ upsert-user deployed successfully"
else
    echo "    ❌ Failed to deploy upsert-user"
    exit 1
fi
echo ""

echo "========================================="
echo "  ✓ ALL FUNCTIONS DEPLOYED SUCCESSFULLY"
echo "========================================="
echo ""
echo "Next steps:"
echo "1. Test the fix on substage.theprize.io"
echo "2. Try purchasing tickets with balance"
echo "3. Verify no 'Failed to fetch' errors appear"
echo "4. Check browser console for success messages"
echo ""
echo "For detailed testing instructions, see:"
echo "  DEPLOYMENT_CHECKLIST_CORS_FIX.md"
echo ""
