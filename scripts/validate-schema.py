#!/usr/bin/env python3
"""
Validate Local Database Against Production CSV Exports

This script compares the local Supabase database schema with the production
CSV exports to identify differences.
"""

import sys
import subprocess
import json
from pathlib import Path

SUPABASE_DIR = Path(__file__).parent.parent / 'supabase'

def run_sql(query):
    """Execute SQL query using Supabase CLI"""
    try:
        result = subprocess.run(
            ['supabase', 'db', 'execute', query],
            capture_output=True,
            text=True,
            check=True
        )
        return result.stdout
    except subprocess.CalledProcessError as e:
        print(f"Error executing SQL: {e.stderr}", file=sys.stderr)
        return None

def count_csv_lines(filename):
    """Count lines in CSV file (excluding header)"""
    file_path = SUPABASE_DIR / filename
    if not file_path.exists():
        return 0
    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    return len(lines) - 1  # Exclude header

def count_public_functions_csv():
    """Count public schema functions in CSV"""
    file_path = SUPABASE_DIR / 'All Functions by relevant schemas.csv'
    if not file_path.exists():
        return 0
    with open(file_path, 'r', encoding='utf-8') as f:
        return sum(1 for line in f if line.startswith('public,'))

def count_public_indexes_csv():
    """Count public schema indexes in CSV (excluding primary keys)"""
    file_path = SUPABASE_DIR / 'All Indexes.csv'
    if not file_path.exists():
        return 0
    with open(file_path, 'r', encoding='utf-8') as f:
        return sum(1 for line in f if line.startswith('public,') and '_pkey' not in line)

def count_public_triggers_csv():
    """Count public schema triggers in CSV"""
    file_path = SUPABASE_DIR / 'All triggers.csv'
    if not file_path.exists():
        return 0
    with open(file_path, 'r', encoding='utf-8') as f:
        return sum(1 for line in f if line.startswith('public,'))

def get_local_function_count():
    """Count functions in local database"""
    query = """
    SELECT COUNT(*)::int as count
    FROM information_schema.routines 
    WHERE routine_schema = 'public';
    """
    result = run_sql(query)
    if result:
        try:
            return int(result.strip())
        except ValueError:
            return None
    return None

def get_local_index_count():
    """Count indexes in local database (excluding primary keys)"""
    query = """
    SELECT COUNT(*)::int as count
    FROM pg_indexes 
    WHERE schemaname = 'public' 
    AND indexname NOT LIKE '%_pkey';
    """
    result = run_sql(query)
    if result:
        try:
            return int(result.strip())
        except ValueError:
            return None
    return None

def get_local_trigger_count():
    """Count triggers in local database"""
    query = """
    SELECT COUNT(*)::int as count
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public' 
    AND NOT t.tgisinternal;
    """
    result = run_sql(query)
    if result:
        try:
            return int(result.strip())
        except ValueError:
            return None
    return None

def main():
    """Main validation function"""
    print('=' * 80)
    print('DATABASE SCHEMA VALIDATION')
    print('Comparing local database with production CSV exports')
    print('=' * 80)
    print()
    
    # Check if Supabase CLI is available
    try:
        subprocess.run(['supabase', '--version'], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print('❌ Supabase CLI not found. Please install it first.')
        print('   npm install -g supabase')
        return 1
    
    # Check if CSV files exist
    csv_files = [
        'All Functions by relevant schemas.csv',
        'All Functions.csv',
        'All Indexes.csv',
        'All triggers.csv'
    ]
    
    missing_csvs = [f for f in csv_files if not (SUPABASE_DIR / f).exists()]
    if missing_csvs:
        print('❌ Missing CSV files:')
        for f in missing_csvs:
            print(f'   - {f}')
        return 1
    
    print('✅ All CSV files found')
    print()
    
    # Count production objects from CSVs
    print('📊 PRODUCTION STATE (from CSV exports)')
    print('-' * 80)
    prod_functions = count_public_functions_csv()
    prod_indexes = count_public_indexes_csv()
    prod_triggers = count_public_triggers_csv()
    
    print(f'Functions (public schema): {prod_functions}')
    print(f'Indexes (public schema):   {prod_indexes}')
    print(f'Triggers (public schema):  {prod_triggers}')
    print()
    
    # Count local objects
    print('📊 LOCAL STATE (current database)')
    print('-' * 80)
    
    local_functions = get_local_function_count()
    local_indexes = get_local_index_count()
    local_triggers = get_local_trigger_count()
    
    if local_functions is None:
        print('❌ Could not query local database')
        print('   Make sure Supabase is running: supabase start')
        return 1
    
    print(f'Functions (public schema): {local_functions}')
    print(f'Indexes (public schema):   {local_indexes}')
    print(f'Triggers (public schema):  {local_triggers}')
    print()
    
    # Compare
    print('📊 COMPARISON')
    print('-' * 80)
    
    issues = []
    
    # Functions
    func_diff = local_functions - prod_functions
    if func_diff == 0:
        print(f'✅ Functions: Match ({prod_functions} total)')
    elif func_diff > 0:
        print(f'⚠️  Functions: Local has {func_diff} MORE than production')
        issues.append('functions')
    else:
        print(f'❌ Functions: Local has {abs(func_diff)} FEWER than production')
        issues.append('functions')
    
    # Indexes
    idx_diff = local_indexes - prod_indexes
    if idx_diff == 0:
        print(f'✅ Indexes: Match ({prod_indexes} total)')
    elif idx_diff > 0:
        print(f'⚠️  Indexes: Local has {idx_diff} MORE than production')
        issues.append('indexes')
    else:
        print(f'❌ Indexes: Local has {abs(idx_diff)} FEWER than production')
        issues.append('indexes')
    
    # Triggers
    trig_diff = local_triggers - prod_triggers
    if trig_diff == 0:
        print(f'✅ Triggers: Match ({prod_triggers} total)')
    elif trig_diff > 0:
        print(f'⚠️  Triggers: Local has {trig_diff} MORE than production')
        issues.append('triggers')
    else:
        print(f'❌ Triggers: Local has {abs(trig_diff)} FEWER than production')
        issues.append('triggers')
    
    print()
    print('=' * 80)
    
    if not issues:
        print('✅ SUCCESS: Local database matches production CSV exports!')
        return 0
    else:
        print('❌ MISMATCH: Local database differs from production')
        print()
        print('To sync with production:')
        print('  1. supabase db pull')
        print('  2. supabase db reset')
        print()
        print('Or apply production migrations:')
        print('  supabase db execute -f supabase/migrations/20260218113000_production_state_documentation.sql')
        return 1

if __name__ == '__main__':
    try:
        exit_code = main()
        sys.exit(exit_code)
    except Exception as e:
        print(f'❌ Error: {e}', file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
