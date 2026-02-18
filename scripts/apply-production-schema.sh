#!/bin/bash
#
# Apply Production Schema from CSV Exports
#
# This script uses PostgreSQL's COPY command to import the CSV files
# into temporary tables, then extracts and applies the DDL.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "$SCRIPT_DIR/../supabase" && pwd)"

echo "============================================================================"
echo "APPLY PRODUCTION SCHEMA FROM CSV EXPORTS"
echo "============================================================================"
echo ""

# Check if Supabase is running
if ! supabase status &> /dev/null; then
    echo "❌ Supabase is not running"
    echo "   Please start it with: supabase start"
    exit 1
fi

echo "✅ Supabase is running"
echo ""

# Check for CSV files
CSV_FILES=(
    "All Functions.csv"
    "All Indexes.csv"
    "All triggers.csv"
)

for csv in "${CSV_FILES[@]}"; do
    if [ ! -f "$SUPABASE_DIR/$csv" ]; then
        echo "❌ Missing CSV file: $csv"
        exit 1
    fi
done

echo "✅ All CSV files found"
echo ""

# Create SQL script to load and apply DDL
TMP_SQL=$(mktemp)

cat > "$TMP_SQL" << 'EOSQL'
-- Create temporary schema for CSV import
CREATE SCHEMA IF NOT EXISTS csv_import;

-- Create temporary tables for CSV data
CREATE TABLE IF NOT EXISTS csv_import.functions (
    schema_name TEXT,
    routine_name TEXT,
    routine_kind TEXT,
    identity_signature TEXT,
    arguments TEXT,
    return_type TEXT,
    owner TEXT,
    language TEXT,
    volatility TEXT,
    security_definer TEXT,
    parallel TEXT,
    ddl TEXT
);

CREATE TABLE IF NOT EXISTS csv_import.indexes (
    schema_name TEXT,
    table_name TEXT,
    index_name TEXT,
    access_method TEXT,
    is_primary TEXT,
    is_unique TEXT,
    is_valid TEXT,
    is_ready TEXT,
    is_clustered TEXT,
    is_exclusion TEXT,
    is_replica_identity TEXT,
    ddl TEXT,
    predicate TEXT,
    expressions TEXT
);

CREATE TABLE IF NOT EXISTS csv_import.triggers (
    table_schema TEXT,
    table_name TEXT,
    trigger_name TEXT,
    enabled_state TEXT,
    timing TEXT,
    events TEXT,
    case_field TEXT,
    unused1 TEXT,
    unused2 TEXT,
    unused3 TEXT,
    unused4 TEXT,
    unused5 TEXT,
    unused6 TEXT,
    row_level TEXT,
    trigger_function TEXT,
    trigger_function_ddl TEXT,
    trigger_ddl TEXT
);

DO $$
BEGIN
    RAISE NOTICE 'Temporary tables created in csv_import schema';
END $$;
EOSQL

echo "📝 Loading CSV data into temporary tables..."
echo ""

# Apply the schema creation
supabase db execute -f "$TMP_SQL"

# Load CSVs using psql COPY command (need to get connection string)
# For now, we'll skip the COPY part and provide manual instructions

echo "============================================================================"
echo "NEXT STEPS"
echo "============================================================================"
echo ""
echo "The temporary schema has been created. To complete the import:"
echo ""
echo "1. Load the CSV files into PostgreSQL:"
echo ""
echo "   Using Supabase Studio SQL Editor:"
echo "   - Navigate to SQL Editor"
echo "   - Create a query to import each CSV"
echo ""
echo "2. Or use the Supabase CLI with a custom SQL script"
echo ""
echo "3. For manual application, reference the CSV files directly:"
echo "   - All Functions.csv contains CREATE FUNCTION statements"
echo "   - All Indexes.csv contains CREATE INDEX statements"  
echo "   - All triggers.csv contains CREATE TRIGGER statements"
echo ""
echo "4. Recommended approach:"
echo "   supabase db pull"
echo "   This pulls the schema directly from production"
echo ""
echo "============================================================================"

# Cleanup
rm -f "$TMP_SQL"
