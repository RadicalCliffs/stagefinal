#!/usr/bin/env python3
"""
Generate Production Schema Sync Migration - Simplified

This extracts DDL statements directly from the CSV files without complex parsing.
"""

import re
from pathlib import Path
from datetime import date

# Paths
SUPABASE_DIR = Path(__file__).parent.parent / 'supabase'
MIGRATION_FILE = SUPABASE_DIR / 'migrations' / '20260218113000_production_schema_sync.sql'

def extract_public_functions():
    """Extract all public schema function DDL from All Functions.csv"""
    file_path = SUPABASE_DIR / 'All Functions.csv'
    content = file_path.read_text(encoding='utf-8')
    
    # Find all CREATE OR REPLACE FUNCTION public.* statements
    # These are in the ddl column (last column)
    functions = []
    
    #Pattern to match: public,function_name,...,"CREATE OR REPLACE FUNCTION public.xxx..."
    pattern = r'public,([^,]+),[^,]+,[^,]+,[^,]+,[^,]+,[^,]+,[^,]+,[^,]+,[^,]+,[^,]+,"(CREATE OR REPLACE FUNCTION public\.[^"]+(?:""|[^"])*)"'
    
    for match in re.finditer(pattern, content, re.MULTILINE | re.DOTALL):
        func_name = match.group(1)
        ddl = match.group(2).replace('""', '"')  # Unescape quotes
        functions.append((func_name, ddl))
    
    return functions

def extract_public_indexes():
    """Extract all public schema index DDL from All Indexes.csv"""
    file_path = SUPABASE_DIR / 'All Indexes.csv'
    lines = file_path.read_text(encoding='utf-8').split('\n')
    
    indexes = []
    for line in lines[1:]:  # Skip header
        if line.strip() and line.startswith('public,'):
            # Extract index DDL (field 11)
            parts = line.split(',')
            if len(parts) >= 12:
                ddl = parts[11].strip().strip('"')
                index_name = parts[2] if len(parts) > 2 else ''
                # Skip primary keys
                if ddl and 'CREATE' in ddl and '_pkey' not in index_name:
                    indexes.append((index_name, ddl))
    
    return indexes

def extract_public_triggers():
    """Extract all public schema trigger DDL from All triggers.csv"""
    file_path = SUPABASE_DIR / 'All triggers.csv'
    content = file_path.read_text(encoding='utf-8')
    
    triggers = []
    trigger_functions = {}
    
    # More flexible pattern - look for public schema triggers
    # Format: public,table_name,trigger_name,...
    lines = content.split('\n')
    
    for i, line in enumerate(lines[1:], 1):  # Skip header
        if not line.strip() or not line.startswith('public,'):
            continue
            
        # Try to extract fields - trigger_ddl is near the end
        # The CSV has many columns, trigger_function_ddl and trigger_ddl are towards the end
        
        # Split carefully since DDL contains commas
        match = re.match(r'public,([^,]+),([^,]+),', line)
        if not match:
            continue
            
        table_name = match.group(1)
        trigger_name = match.group(2)
        
        # Extract the trigger DDL (last field) and trigger function DDL (second to last)
        # Find the CREATE TRIGGER statement
        trigger_ddl_match = re.search(r'"(CREATE TRIGGER[^"]+(?:""|[^"])*)"?\s*$', line)
        trigger_func_match = re.search(r'"(CREATE OR REPLACE FUNCTION public\.[^"]+(?:""|[^"])*?)"\s*,\s*"CREATE TRIGGER', line)
        
        if trigger_func_match:
            func_ddl = trigger_func_match.group(1).replace('""', '"')
            # Extract function name
            func_name_match = re.search(r'CREATE OR REPLACE FUNCTION (public\.[^(]+)', func_ddl)
            if func_name_match:
                func_name = func_name_match.group(1)
                if func_name not in trigger_functions:
                    trigger_functions[func_name] = func_ddl
        
        if trigger_ddl_match:
            ddl = trigger_ddl_match.group(1).replace('""', '"')
            triggers.append((trigger_name, table_name, ddl))
    
    return trigger_functions, triggers

def generate_migration():
    """Generate the complete migration file"""
    
    print('🔍 Extracting DDL from production CSV files...')
    
    functions = extract_public_functions()
    indexes = extract_public_indexes()
    trigger_functions, triggers = extract_public_triggers()
    
    print(f'✅ Extracted {len(functions)} public functions')
    print(f'✅ Extracted {len(indexes)} public indexes')
    print(f'✅ Extracted {len(trigger_functions)} trigger functions')
    print(f'✅ Extracted {len(triggers)} triggers')
    
    # Generate migration file
    print('\n📝 Generating migration file...')
    
    migration = f"""-- ============================================================================
-- Production Schema Sync Migration
-- Generated from production Supabase CSV exports
-- Date: {date.today()}
-- ============================================================================
--
-- This migration ensures the local schema matches the production database
-- by creating all functions, indexes, and triggers from production CSVs.
--
-- Statistics:
-- - {len(functions)} public functions
-- - {len(indexes)} public indexes
-- - {len(trigger_functions)} trigger functions
-- - {len(triggers)} triggers
--
-- ============================================================================

"""
    
    # Add functions
    if functions:
        migration += f"""-- ============================================================================
-- PUBLIC SCHEMA FUNCTIONS ({len(functions)} total)
-- ============================================================================

"""
        for func_name, ddl in sorted(functions):
            migration += f"-- Function: {func_name}\n{ddl}\n\n"
    
    # Add indexes
    if indexes:
        migration += f"""-- ============================================================================
-- PUBLIC SCHEMA INDEXES ({len(indexes)} total)
-- ============================================================================

"""
        for idx_name, ddl in sorted(indexes):
            # Make idempotent
            idempotent_ddl = ddl.replace('CREATE UNIQUE INDEX', 'CREATE UNIQUE INDEX IF NOT EXISTS')
            idempotent_ddl = idempotent_ddl.replace('CREATE INDEX', 'CREATE INDEX IF NOT EXISTS')
            migration += f"-- Index: {idx_name}\n{idempotent_ddl};\n\n"
    
    # Add triggers
    if trigger_functions or triggers:
        migration += f"""-- ============================================================================
-- TRIGGERS AND TRIGGER FUNCTIONS
-- ============================================================================

"""
        # First create all trigger functions
        for func_name, ddl in sorted(trigger_functions.items()):
            migration += f"-- Trigger function: {func_name}\n{ddl}\n\n"
        
        # Then create triggers
        for trigger_name, table_name, ddl in sorted(triggers):
            migration += f"-- Trigger: {trigger_name} on {table_name}\n"
            migration += f"DROP TRIGGER IF EXISTS {trigger_name} ON public.{table_name};\n"
            migration += f"{ddl};\n\n"
    
    migration += """-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
"""
    
    # Write file
    MIGRATION_FILE.write_text(migration, encoding='utf-8')
    
    print(f'\n✅ Migration file generated: {MIGRATION_FILE}')
    print(f'📊 File size: {len(migration) / 1024:.2f} KB')
    print(f'📊 Lines: {migration.count(chr(10))}')

if __name__ == '__main__':
    try:
        generate_migration()
    except Exception as e:
        print(f'❌ Error: {e}')
        import traceback
        traceback.print_exc()
        exit(1)
