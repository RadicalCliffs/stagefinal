#!/usr/bin/env python3
"""
Generate Production Schema Sync Migration

This script reads the production Supabase CSV exports and generates
a comprehensive migration file that can sync the local database with production.
"""

import re
import sys
from pathlib import Path

# Paths
SUPABASE_DIR = Path(__file__).parent.parent / 'supabase'
MIGRATION_FILE = SUPABASE_DIR / 'migrations' / '20260218000000_production_schema_sync.sql'

CSV_FILES = {
    'functions': SUPABASE_DIR / 'All Functions.csv',
    'indexes': SUPABASE_DIR / 'All Indexes.csv',
    'triggers': SUPABASE_DIR / 'All triggers.csv'
}


def parse_csv_manual(file_path):
    """
    Manual CSV parsing to handle multiline quoted fields
    The CSV has embedded newlines in quoted DDL fields
    """
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Split into lines but keep track of quoted sections
    rows = []
    current_row = []
    current_field = ''
    in_quotes = False
    
    i = 0
    while i < len(content):
        char = content[i]
        
        if char == '"' and (i == 0 or content[i-1] != '\\'):
            in_quotes = not in_quotes
            current_field += char
        elif char == ',' and not in_quotes:
            current_row.append(current_field)
            current_field = ''
        elif char == '\n' and not in_quotes:
            if current_field or current_row:
                current_row.append(current_field)
                if current_row and any(current_row):  # Skip empty rows
                    rows.append(current_row)
                current_row = []
                current_field = ''
        else:
            current_field += char
        
        i += 1
    
    # Handle last row if any
    if current_field or current_row:
        current_row.append(current_field)
        if current_row and any(current_row):
            rows.append(current_row)
    
    if not rows:
        return []
    
    # First row is header
    headers = [h.strip().strip('"') for h in rows[0]]
    
    # Convert remaining rows to dicts
    result = []
    for row in rows[1:]:
        # Ensure row has enough fields
        while len(row) < len(headers):
            row.append('')
        row_dict = {}
        for i, header in enumerate(headers):
            value = row[i].strip().strip('"') if i < len(row) else ''
            row_dict[header] = value
        result.append(row_dict)
    
    return result


def generate_header():
    """Generate migration header"""
    from datetime import date
    return f"""-- ============================================================================
-- Production Schema Sync Migration
-- Generated from production Supabase CSV exports
-- Date: {date.today()}
-- ============================================================================
--
-- This migration ensures the local schema matches the production database
-- by creating all functions, indexes, and triggers from production CSVs.
--
-- Source Files:
-- - All Functions.csv (production function definitions)
-- - All Indexes.csv (production index definitions)
-- - All triggers.csv (production trigger definitions)
--
-- ============================================================================

"""


def generate_functions(rows):
    """Generate functions section from CSV"""
    sql = f"""-- ============================================================================
-- FUNCTIONS ({len(rows)} total)
-- ============================================================================

"""

    # Filter to only public schema functions
    public_functions = [r for r in rows if r.get('schema_name', '') == 'public']
    
    sql += f"-- Creating {len(public_functions)} public schema functions\n\n"

    for row in public_functions:
        ddl = row.get('ddl', '').strip()
        if ddl:
            sql += f"{ddl}\n\n"

    return sql


def generate_indexes(rows):
    """Generate indexes section from CSV"""
    sql = f"""-- ============================================================================
-- INDEXES ({len(rows)} total)
-- ============================================================================

"""

    # Filter to only public schema indexes (skip primary keys)
    public_indexes = [r for r in rows 
                     if r.get('schema_name', '') == 'public'
                     and not r.get('index_name', '').endswith('_pkey')]
    
    sql += f"-- Creating {len(public_indexes)} public schema indexes\n\n"

    for row in public_indexes:
        ddl = row.get('ddl', '').strip()
        if ddl:
            # Make idempotent
            idempotent_ddl = ddl.replace('CREATE UNIQUE INDEX', 'CREATE UNIQUE INDEX IF NOT EXISTS')
            idempotent_ddl = idempotent_ddl.replace('CREATE INDEX', 'CREATE INDEX IF NOT EXISTS')
            sql += f"{idempotent_ddl};\n\n"

    return sql


def generate_triggers(rows):
    """Generate triggers section from CSV"""
    sql = f"""-- ============================================================================
-- TRIGGERS ({len(rows)} total)
-- ============================================================================

"""

    # Filter to only public schema triggers
    public_triggers = [r for r in rows if r.get('table_schema', '') == 'public']
    
    sql += f"-- Creating {len(public_triggers)} public schema triggers\n\n"

    # Track which trigger functions we've already created
    functions_created = set()
    
    for row in public_triggers:
        trigger_function_ddl = row.get('trigger_function_ddl', '').strip()
        trigger_ddl = row.get('trigger_ddl', '').strip()
        trigger_name = row.get('trigger_name', '')
        function_name = row.get('trigger_function', '')
        table_name = row.get('table_name', '')
        
        # Create function if not already created
        if trigger_function_ddl and function_name not in functions_created:
            sql += f"-- Trigger function: {function_name}\n"
            sql += f"{trigger_function_ddl}\n\n"
            functions_created.add(function_name)
        
        # Create trigger (drop first for idempotency)
        if trigger_ddl and trigger_name and table_name:
            sql += f"-- Trigger: {trigger_name} on {table_name}\n"
            sql += f"DROP TRIGGER IF EXISTS {trigger_name} ON public.{table_name};\n"
            sql += f"{trigger_ddl};\n\n"

    return sql


def main():
    """Main function"""
    print('🔍 Parsing production CSV files...')
    
    # Parse CSV files using manual parser
    functions = parse_csv_manual(CSV_FILES['functions'])
    indexes = parse_csv_manual(CSV_FILES['indexes'])
    triggers = parse_csv_manual(CSV_FILES['triggers'])
    
    print(f'✅ Parsed {len(functions)} functions')
    print(f'✅ Parsed {len(indexes)} indexes')
    print(f'✅ Parsed {len(triggers)} triggers')
    
    # Generate migration
    print('\n📝 Generating migration file...')
    
    migration = generate_header()
    migration += generate_functions(functions)
    migration += generate_indexes(indexes)
    migration += generate_triggers(triggers)
    
    # Add footer
    migration += """-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
"""
    
    # Write to file
    MIGRATION_FILE.write_text(migration, encoding='utf-8')
    
    print(f'\n✅ Migration file generated: {MIGRATION_FILE}')
    print(f'📊 File size: {len(migration) / 1024:.2f} KB')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f'❌ Error: {e}', file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
