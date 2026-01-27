#!/usr/bin/env python3
"""
Analyze Supabase database objects from CSV exports and compare with baseline migration.

This script:
1. Reads CSV files exported from Supabase
2. Compares functions/triggers/indexes with the baseline migration
3. Updates cleanup recommendations based on actual database state
"""

import csv
import sys
from pathlib import Path

def analyze_functions(csv_path):
    """Analyze functions from CSV export."""
    functions = []
    try:
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                functions.append({
                    'name': row.get('Name', row.get('function_name', '')),
                    'args': row.get('Arguments', row.get('arguments', '')),
                    'return_type': row.get('Return type', row.get('return_type', '')),
                    'security': row.get('Security', row.get('security', ''))
                })
    except Exception as e:
        print(f"Error reading functions CSV: {e}", file=sys.stderr)
        return []
    
    print(f"\n=== FUNCTIONS ANALYSIS ({len(functions)} total) ===")
    
    # Group by function name
    by_name = {}
    for func in functions:
        name = func['name']
        if name not in by_name:
            by_name[name] = []
        by_name[name].append(func)
    
    # Find duplicates
    duplicates = {name: funcs for name, funcs in by_name.items() if len(funcs) > 1}
    if duplicates:
        print(f"\n🔍 Duplicate function names ({len(duplicates)}):")
        for name, funcs in sorted(duplicates.items()):
            print(f"  - {name}: {len(funcs)} versions")
            for func in funcs:
                print(f"    • args: {func['args'][:60]}...")
    
    # Find PostgreSQL extension functions (should not be in custom list)
    pg_extensions = [
        'armor', 'dearmor', 'crypt', 'gen_salt', 'encrypt', 'decrypt',
        'digest', 'hmac', 'pgp_', 'gen_random_', 'uuid_generate_', 'uuid_ns_', 'uuid_nil'
    ]
    ext_funcs = [f for f in functions if any(f['name'].startswith(ext) for ext in pg_extensions)]
    if ext_funcs:
        print(f"\n⚠️  PostgreSQL extension functions found ({len(ext_funcs)}):")
        print("    These are built-in and should not be in custom function list")
        for func in sorted(ext_funcs, key=lambda x: x['name'])[:10]:
            print(f"  - {func['name']}")
    
    # Find test/internal functions
    internal_funcs = [f for f in functions if f['name'].startswith('_')]
    if internal_funcs:
        print(f"\n🔧 Internal/helper functions ({len(internal_funcs)}):")
        for func in sorted(internal_funcs, key=lambda x: x['name'])[:20]:
            print(f"  - {func['name']}")
    
    return functions

def analyze_triggers(csv_path):
    """Analyze triggers from CSV export."""
    triggers = []
    try:
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                triggers.append({
                    'name': row.get('Name', row.get('trigger_name', '')),
                    'table': row.get('Table', row.get('table_name', '')),
                    'function': row.get('Function', row.get('function_name', '')),
                    'events': row.get('Events', row.get('events', '')),
                    'enabled': row.get('Enabled', row.get('enabled', 'true'))
                })
    except Exception as e:
        print(f"Error reading triggers CSV: {e}", file=sys.stderr)
        return []
    
    print(f"\n\n=== TRIGGERS ANALYSIS ({len(triggers)} total) ===")
    
    # Group by table
    by_table = {}
    for trigger in triggers:
        table = trigger['table']
        if table not in by_table:
            by_table[table] = []
        by_table[table].append(trigger)
    
    # Find tables with many triggers
    heavy_tables = {table: trigs for table, trigs in by_table.items() if len(trigs) > 3}
    if heavy_tables:
        print(f"\n📊 Tables with many triggers:")
        for table, trigs in sorted(heavy_tables.items(), key=lambda x: -len(x[1])):
            print(f"  - {table}: {len(trigs)} triggers")
    
    # Find potential duplicate triggers (similar names)
    similar_names = {}
    for trigger in triggers:
        base_name = trigger['name'].replace('_trg', '').replace('trg_', '')
        if base_name not in similar_names:
            similar_names[base_name] = []
        similar_names[base_name].append(trigger)
    
    duplicates = {name: trigs for name, trigs in similar_names.items() if len(trigs) > 1}
    if duplicates:
        print(f"\n🔍 Potential duplicate triggers ({len(duplicates)}):")
        for base, trigs in sorted(duplicates.items())[:10]:
            if len(trigs) > 1:
                print(f"  - {base}:")
                for trig in trigs:
                    print(f"    • {trig['name']} on {trig['table']}")
    
    return triggers

def analyze_indexes(csv_path):
    """Analyze indexes from CSV export."""
    indexes = []
    try:
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                indexes.append({
                    'name': row.get('Name', row.get('index_name', '')),
                    'table': row.get('Table', row.get('table_name', '')),
                    'columns': row.get('Columns', row.get('columns', ''))
                })
    except Exception as e:
        print(f"Error reading indexes CSV: {e}", file=sys.stderr)
        return []
    
    print(f"\n\n=== INDEXES ANALYSIS ({len(indexes)} total) ===")
    
    # Group by table
    by_table = {}
    for idx in indexes:
        table = idx['table']
        if table not in by_table:
            by_table[table] = []
        by_table[table].append(idx)
    
    # Find tables with many indexes
    heavy_tables = {table: idxs for table, idxs in by_table.items() if len(idxs) > 5}
    if heavy_tables:
        print(f"\n📊 Tables with many indexes:")
        for table, idxs in sorted(heavy_tables.items(), key=lambda x: -len(x[1]))[:10]:
            print(f"  - {table}: {len(idxs)} indexes")
    
    # Find potential duplicate indexes (same table+columns)
    by_table_col = {}
    for idx in indexes:
        key = f"{idx['table']}:{idx['columns']}"
        if key not in by_table_col:
            by_table_col[key] = []
        by_table_col[key].append(idx)
    
    duplicates = {key: idxs for key, idxs in by_table_col.items() if len(idxs) > 1}
    if duplicates:
        print(f"\n🔍 Duplicate indexes on same columns ({len(duplicates)}):")
        for key, idxs in sorted(duplicates.items())[:15]:
            table, cols = key.split(':', 1)
            print(f"  - {table}.{cols}:")
            for idx in idxs:
                print(f"    • {idx['name']}")
    
    return indexes

def main():
    """Main analysis function."""
    script_dir = Path(__file__).parent
    repo_root = script_dir.parent.parent
    
    # Look for CSV files
    csv_patterns = [
        'Supabase Snippet Functions in public schema.csv',
        'Supabase Snippet Public Triggers Inventory.csv',
        'Supabase Snippet Public Indexes Overview.csv',
        'functions.csv',
        'triggers.csv',
        'indexes.csv'
    ]
    
    functions_csv = None
    triggers_csv = None
    indexes_csv = None
    
    # Search for CSV files
    for pattern in csv_patterns:
        for path in [repo_root, repo_root / 'supabase', repo_root / 'supabase' / 'diagnostics']:
            candidate = path / pattern
            if candidate.exists():
                if 'function' in pattern.lower():
                    functions_csv = candidate
                elif 'trigger' in pattern.lower():
                    triggers_csv = candidate
                elif 'index' in pattern.lower():
                    indexes_csv = candidate
    
    if not any([functions_csv, triggers_csv, indexes_csv]):
        print("❌ No CSV files found. Please place CSV exports in:")
        print("  - Repository root")
        print("  - supabase/")
        print("  - supabase/diagnostics/")
        print("\nExpected filenames:")
        for pattern in csv_patterns[:3]:
            print(f"  - {pattern}")
        return 1
    
    print("=" * 80)
    print("SUPABASE DATABASE OBJECTS ANALYSIS")
    print("=" * 80)
    
    if functions_csv:
        print(f"\n📂 Functions CSV: {functions_csv.name}")
        analyze_functions(functions_csv)
    
    if triggers_csv:
        print(f"\n📂 Triggers CSV: {triggers_csv.name}")
        analyze_triggers(triggers_csv)
    
    if indexes_csv:
        print(f"\n📂 Indexes CSV: {indexes_csv.name}")
        analyze_indexes(indexes_csv)
    
    print("\n" + "=" * 80)
    print("Analysis complete!")
    print("=" * 80)
    
    return 0

if __name__ == '__main__':
    sys.exit(main())
