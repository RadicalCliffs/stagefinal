#!/usr/bin/env node

/**
 * Generate Production Schema Sync Migration
 * 
 * This script reads the production Supabase CSV exports and generates
 * a comprehensive migration file that can sync the local database with production.
 * 
 * Input Files:
 * - supabase/All Functions.csv - Complete function DDL
 * - supabase/All Indexes.csv - Complete index definitions
 * - supabase/All triggers.csv - Complete trigger definitions
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const SUPABASE_DIR = path.join(__dirname, '..', 'supabase');
const MIGRATION_FILE = path.join(SUPABASE_DIR, 'migrations', '20260218000000_production_schema_sync.sql');

const CSV_FILES = {
  functions: path.join(SUPABASE_DIR, 'All Functions.csv'),
  indexes: path.join(SUPABASE_DIR, 'All Indexes.csv'),
  triggers: path.join(SUPABASE_DIR, 'All triggers.csv')
};

/**
 * Parse CSV file and return rows as objects
 */
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  
  if (lines.length === 0) return [];
  
  // First line is header
  const headers = parseCSVLine(lines[0]);
  
  // Parse remaining lines
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length > 0) {
      const row = {};
      headers.forEach((header, idx) => {
        row[header] = values[idx] || null;
      });
      rows.push(row);
    }
  }
  
  return rows;
}

/**
 * Parse a single CSV line, handling quoted fields with commas
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // End of field
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  // Add last field
  result.push(current);
  
  return result;
}

/**
 * Generate migration header
 */
function generateHeader() {
  return `-- ============================================================================
-- Production Schema Sync Migration
-- Generated from production Supabase CSV exports
-- Date: ${new Date().toISOString().split('T')[0]}
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

`;
}

/**
 * Generate functions section from CSV
 */
function generateFunctions(rows) {
  let sql = `-- ============================================================================
-- FUNCTIONS (${rows.length} total)
-- ============================================================================

`;

  // Filter to only public schema functions (exclude auth, pg_catalog, etc.)
  const publicFunctions = rows.filter(row => {
    const schemaName = row.schema_name || '';
    return schemaName === 'public';
  });

  sql += `-- Creating ${publicFunctions.length} public schema functions\n\n`;

  for (const row of publicFunctions) {
    const ddl = row.ddl || '';
    if (ddl && ddl.trim()) {
      sql += `${ddl}\n\n`;
    }
  }

  return sql;
}

/**
 * Generate indexes section from CSV
 */
function generateIndexes(rows) {
  let sql = `-- ============================================================================
-- INDEXES (${rows.length} total)
-- ============================================================================

`;

  // Filter to only public schema indexes
  const publicIndexes = rows.filter(row => {
    const schemaName = row.schema_name || '';
    return schemaName === 'public';
  });

  sql += `-- Creating ${publicIndexes.length} public schema indexes\n\n`;

  for (const row of publicIndexes) {
    const ddl = row.ddl || '';
    const indexName = row.index_name || '';
    
    if (ddl && ddl.trim() && !ddl.includes('_pkey')) {
      // Skip primary key indexes, make idempotent
      const idempotentDDL = ddl.replace('CREATE UNIQUE INDEX', 'CREATE UNIQUE INDEX IF NOT EXISTS')
                               .replace('CREATE INDEX', 'CREATE INDEX IF NOT EXISTS');
      sql += `${idempotentDDL};\n\n`;
    }
  }

  return sql;
}

/**
 * Generate triggers section from CSV
 */
function generateTriggers(rows) {
  let sql = `-- ============================================================================
-- TRIGGERS (${rows.length} total)
-- ============================================================================

`;

  // Filter to only public schema triggers
  const publicTriggers = rows.filter(row => {
    const schemaName = row.table_schema || '';
    return schemaName === 'public';
  });

  sql += `-- Creating ${publicTriggers.length} public schema triggers\n\n`;

  // Group by trigger function first, then create triggers
  const functionsCreated = new Set();
  
  for (const row of publicTriggers) {
    const triggerFunctionDDL = row.trigger_function_ddl || '';
    const triggerDDL = row.trigger_ddl || '';
    const triggerName = row.trigger_name || '';
    const functionName = row.trigger_function || '';
    
    // Create function if not already created
    if (triggerFunctionDDL && triggerFunctionDDL.trim() && !functionsCreated.has(functionName)) {
      sql += `-- Trigger function: ${functionName}\n`;
      sql += `${triggerFunctionDDL}\n\n`;
      functionsCreated.add(functionName);
    }
    
    // Create trigger (drop first for idempotency)
    if (triggerDDL && triggerDDL.trim()) {
      const tableName = row.table_name || '';
      sql += `-- Trigger: ${triggerName} on ${tableName}\n`;
      sql += `DROP TRIGGER IF EXISTS "${triggerName}" ON public.${tableName};\n`;
      sql += `${triggerDDL};\n\n`;
    }
  }

  return sql;
}

/**
 * Main function
 */
function main() {
  console.log('🔍 Parsing production CSV files...');
  
  // Parse CSV files
  const functions = parseCSV(CSV_FILES.functions);
  const indexes = parseCSV(CSV_FILES.indexes);
  const triggers = parseCSV(CSV_FILES.triggers);
  
  console.log(`✅ Parsed ${functions.length} functions`);
  console.log(`✅ Parsed ${indexes.length} indexes`);
  console.log(`✅ Parsed ${triggers.length} triggers`);
  
  // Generate migration
  console.log('\n📝 Generating migration file...');
  
  let migration = generateHeader();
  migration += generateFunctions(functions);
  migration += generateIndexes(indexes);
  migration += generateTriggers(triggers);
  
  // Add footer
  migration += `-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
`;
  
  // Write to file
  fs.writeFileSync(MIGRATION_FILE, migration, 'utf-8');
  
  console.log(`\n✅ Migration file generated: ${MIGRATION_FILE}`);
  console.log(`📊 File size: ${(migration.length / 1024).toFixed(2)} KB`);
}

// Run
try {
  main();
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
