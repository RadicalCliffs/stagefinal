#!/bin/bash

# Aggressive Mode Setup Script
# This script helps deploy the aggressive mode SQL migration to Supabase

set -e

echo ""
echo "🚀 =============================================="
echo "🚀 AGGRESSIVE MODE SETUP"
echo "🚀 =============================================="
echo ""

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI is not installed"
    echo ""
    echo "Install it with:"
    echo "  npm install -g supabase"
    echo "  or"
    echo "  brew install supabase/tap/supabase"
    echo ""
    exit 1
fi

echo "✅ Supabase CLI found"
echo ""

# Check if project is linked
if [ ! -f ".supabase/config.toml" ]; then
    echo "⚠️  Project is not linked to Supabase"
    echo ""
    echo "Link your project with:"
    echo "  supabase link --project-ref YOUR_PROJECT_REF"
    echo ""
    exit 1
fi

echo "✅ Project is linked"
echo ""

# Deploy the migration
echo "📦 Deploying exec_sql migration..."
echo ""

if [ -f "supabase/migrations/99999999999999_aggressive_mode_exec_sql.sql" ]; then
    supabase db push
    echo ""
    echo "✅ Migration deployed successfully!"
else
    echo "❌ Migration file not found: supabase/migrations/99999999999999_aggressive_mode_exec_sql.sql"
    exit 1
fi

echo ""
echo "🎉 =============================================="
echo "🎉 AGGRESSIVE MODE SETUP COMPLETE"
echo "🎉 =============================================="
echo ""
echo "Next steps:"
echo "1. Add VITE_SUPABASE_SERVICE_ROLE_KEY to your .env file"
echo "2. Get the service role key from: Supabase Dashboard → Settings → API"
echo "3. Restart your dev server"
echo "4. Aggressive mode will auto-enable on startup"
echo ""
echo "See AGGRESSIVE_MODE_GUIDE.md for usage instructions"
echo ""
