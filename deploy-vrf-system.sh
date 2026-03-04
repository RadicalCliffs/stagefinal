#!/bin/bash
# ============================================================================
# DEPLOY VRF AUTOMATIC WINNER SELECTION SYSTEM
# ============================================================================
# This script deploys all components needed for automatic VRF winner selection

echo "=========================================================="
echo "DEPLOYING VRF AUTOMATIC WINNER SELECTION"
echo "=========================================================="
echo ""

# Check if supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found. Install with: npm install -g supabase"
    exit 1
fi

echo "✅ Supabase CLI found"
echo ""

# 1. Link to Supabase project
echo "1. Linking to Supabase project..."
supabase link --project-ref mthwfldcjvpxjtmrqkqm || {
    echo "⚠️  Link failed or already linked"
}
echo ""

# 2. Deploy vrf-draw-winner edge function
echo "2. Deploying vrf-draw-winner edge function..."
supabase functions deploy vrf-draw-winner --no-verify-jwt || {
    echo "❌ Failed to deploy vrf-draw-winner"
    exit 1
}
echo "✅ vrf-draw-winner deployed"
echo ""

# 3. Check Netlify vrf-scheduler deployment
echo "3. Netlify vrf-scheduler status..."
echo "⚠️  Manual step required:"
echo "   1. Go to Netlify dashboard"
echo "   2. Go to Functions > Scheduled functions"
echo "   3. Verify 'vrf-scheduler' is listed and enabled"
echo "   4. Schedule should be: */10 * * * * (every 10 minutes)"
echo ""
read -p "Press ENTER when verified in Netlify dashboard..."
echo ""

# 4. Test the vrf-draw-winner function
echo "4. Testing vrf-draw-winner function..."
echo "   (You can test manually with a competition ID later)"
echo ""

echo "=========================================================="
echo "✅ DEPLOYMENT COMPLETE"
echo "=========================================================="
echo ""
echo "NEXT STEPS:"
echo "1. Wait for next 10-minute scheduler run"
echo "2. Check competition statuses update to 'completed'"
echo "3. Verify winners appear in frontend"
echo "4. Check notifications are sent"
echo ""
echo "MANUAL TEST:"
echo "  Test vrf-draw-winner directly:"
echo "  supabase functions invoke vrf-draw-winner --data '{\"competition_id\":\"YOUR_COMP_ID\"}'"
echo ""
