#!/bin/bash
# Regenerate Supabase TypeScript types
# This script provides a simple way to regenerate types from your Supabase database

set -e  # Exit on error

echo "🔄 Supabase Type Regeneration Script"
echo "====================================="
echo ""

# Function to show usage
show_usage() {
    echo "Usage:"
    echo "  npm run types:generate                    # Auto-detect connection"
    echo "  npm run types:generate -- --local         # Use local database"
    echo "  npm run types:generate -- --project-id ID # Use project ID"
    echo ""
    echo "Environment variables:"
    echo "  VITE_SUPABASE_URL         - Your Supabase project URL"
    echo "  SUPABASE_PROJECT_ID       - Your Supabase project ID"
    echo "  DATABASE_URL              - Direct database connection string"
    echo ""
}

# Parse command line arguments
USE_LOCAL=false
PROJECT_ID=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --local)
            USE_LOCAL=true
            shift
            ;;
        --project-id)
            PROJECT_ID="$2"
            shift 2
            ;;
        --help)
            show_usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Determine connection method
if [ "$USE_LOCAL" = true ]; then
    echo "📍 Using local database"
    echo "   Make sure you've run: npx supabase start"
    echo ""
    
    # Check if local Supabase is running
    if ! curl -s http://localhost:54321/rest/v1/ > /dev/null 2>&1; then
        echo "❌ Error: Local Supabase is not running"
        echo "   Run: npx supabase start"
        exit 1
    fi
    
    echo "✅ Local Supabase is running"
    echo "🔧 Generating types..."
    npx supabase gen types typescript --local > supabase/types.ts
    
elif [ -n "$PROJECT_ID" ]; then
    echo "📍 Using project ID: $PROJECT_ID"
    echo "🔧 Generating types..."
    npx supabase gen types typescript --project-id "$PROJECT_ID" > supabase/types.ts
    
elif [ -n "$SUPABASE_PROJECT_ID" ]; then
    echo "📍 Using project ID from environment: $SUPABASE_PROJECT_ID"
    echo "🔧 Generating types..."
    npx supabase gen types typescript --project-id "$SUPABASE_PROJECT_ID" > supabase/types.ts
    
elif [ -n "$VITE_SUPABASE_URL" ]; then
    # Extract project ID from URL (format: https://PROJECT_ID.supabase.co)
    EXTRACTED_ID=$(echo "$VITE_SUPABASE_URL" | sed -n 's/.*:\/\/\([^.]*\).*/\1/p')
    
    if [ -n "$EXTRACTED_ID" ]; then
        echo "📍 Extracted project ID from VITE_SUPABASE_URL: $EXTRACTED_ID"
        echo "🔧 Generating types..."
        npx supabase gen types typescript --project-id "$EXTRACTED_ID" > supabase/types.ts
    else
        echo "❌ Error: Could not extract project ID from VITE_SUPABASE_URL"
        echo "   URL: $VITE_SUPABASE_URL"
        show_usage
        exit 1
    fi
    
elif [ -n "$DATABASE_URL" ]; then
    echo "📍 Using DATABASE_URL"
    echo "🔧 Generating types..."
    npx supabase gen types typescript --db-url "$DATABASE_URL" > supabase/types.ts
    
else
    echo "❌ Error: No connection method specified"
    echo ""
    echo "Please provide one of:"
    echo "  1. Run with --local flag (requires: npx supabase start)"
    echo "  2. Set VITE_SUPABASE_URL environment variable"
    echo "  3. Set SUPABASE_PROJECT_ID environment variable"
    echo "  4. Set DATABASE_URL environment variable"
    echo "  5. Run with --project-id flag"
    echo ""
    show_usage
    exit 1
fi

# Check if generation was successful
if [ $? -eq 0 ] && [ -f "supabase/types.ts" ]; then
    FILE_SIZE=$(wc -c < supabase/types.ts)
    
    if [ "$FILE_SIZE" -gt 1000 ]; then
        echo ""
        echo "✅ Types regenerated successfully!"
        echo "   File: supabase/types.ts"
        echo "   Size: $FILE_SIZE bytes"
        echo ""
        echo "📋 Next steps:"
        echo "   1. Review the generated types"
        echo "   2. Run: npm run build"
        echo "   3. Fix any new TypeScript errors (these are real bugs!)"
        echo "   4. Refactor code using patterns from TYPESCRIPT_TYPE_ANALYSIS.md"
        echo ""
    else
        echo "⚠️  Warning: Generated types file seems too small ($FILE_SIZE bytes)"
        echo "   This might indicate an error. Check supabase/types.ts"
        exit 1
    fi
else
    echo ""
    echo "❌ Error: Type generation failed"
    echo "   Check the error messages above"
    exit 1
fi
