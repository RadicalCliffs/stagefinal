/**
 * Aggressive Schema Manager
 * 
 * Automatically creates and modifies database schema to fix errors on the fly.
 * Uses service-level credentials to bypass all restrictions.
 * 
 * This service:
 * - Creates missing tables
 * - Adds missing columns
 * - Removes blocking constraints
 * - Fixes indexes and triggers
 * - Auto-migrates schema as needed
 */

import { getAdminClient, hasAdminAccess } from './supabase-admin';
import { databaseLogger } from './debug-console';

interface TableSchema {
  tableName: string;
  columns: ColumnDefinition[];
  primaryKey?: string;
}

interface ColumnDefinition {
  name: string;
  type: string;
  nullable?: boolean;
  defaultValue?: any;
}

/**
 * Execute raw SQL with admin privileges
 */
async function executeSQL(sql: string, params: any[] = []): Promise<any> {
  if (!hasAdminAccess()) {
    databaseLogger.warn('[SchemaManager] No admin access - cannot execute SQL');
    return { data: null, error: { message: 'No admin access' } };
  }

  const admin = getAdminClient();
  
  try {
    databaseLogger.info('[SchemaManager] Executing SQL', { sql: sql.substring(0, 100) });
    const { data, error } = await admin.rpc('exec_sql', { sql_query: sql });
    
    if (error) {
      databaseLogger.error('[SchemaManager] SQL execution failed', { sql, error });
    }
    
    return { data, error };
  } catch (err) {
    databaseLogger.error('[SchemaManager] SQL execution exception', err);
    return { data: null, error: err };
  }
}

/**
 * Check if a table exists
 */
export async function tableExists(tableName: string): Promise<boolean> {
  if (!hasAdminAccess()) return false;

  const admin = getAdminClient();
  
  try {
    const { data, error } = await admin
      .from('information_schema.tables' as any)
      .select('table_name')
      .eq('table_schema', 'public')
      .eq('table_name', tableName)
      .maybeSingle();

    return !error && data !== null;
  } catch (err) {
    databaseLogger.warn('[SchemaManager] Could not check table existence', { tableName, err });
    return false;
  }
}

/**
 * Check if a column exists in a table
 */
export async function columnExists(tableName: string, columnName: string): Promise<boolean> {
  if (!hasAdminAccess()) return false;

  const admin = getAdminClient();
  
  try {
    const { data, error } = await admin
      .from('information_schema.columns' as any)
      .select('column_name')
      .eq('table_schema', 'public')
      .eq('table_name', tableName)
      .eq('column_name', columnName)
      .maybeSingle();

    return !error && data !== null;
  } catch (err) {
    databaseLogger.warn('[SchemaManager] Could not check column existence', { tableName, columnName, err });
    return false;
  }
}

/**
 * Create a table if it doesn't exist
 */
export async function createTable(schema: TableSchema): Promise<boolean> {
  if (!hasAdminAccess()) {
    databaseLogger.warn('[SchemaManager] Cannot create table without admin access');
    return false;
  }

  const exists = await tableExists(schema.tableName);
  if (exists) {
    databaseLogger.info('[SchemaManager] Table already exists', { table: schema.tableName });
    return true;
  }

  const columns = schema.columns.map(col => {
    let def = `"${col.name}" ${col.type}`;
    if (!col.nullable) def += ' NOT NULL';
    if (col.defaultValue !== undefined) {
      def += ` DEFAULT ${col.defaultValue}`;
    }
    return def;
  }).join(', ');

  let sql = `CREATE TABLE IF NOT EXISTS "${schema.tableName}" (${columns}`;
  
  if (schema.primaryKey) {
    sql += `, PRIMARY KEY ("${schema.primaryKey}")`;
  }
  
  sql += ');';

  databaseLogger.info('[SchemaManager] Creating table', { table: schema.tableName, sql });
  
  const { error } = await executeSQL(sql);
  
  if (!error) {
    databaseLogger.info('[SchemaManager] Table created successfully', { table: schema.tableName });
    return true;
  } else {
    databaseLogger.error('[SchemaManager] Failed to create table', { table: schema.tableName, error });
    return false;
  }
}

/**
 * Add a column to an existing table
 */
export async function addColumn(
  tableName: string, 
  columnName: string, 
  columnType: string, 
  options: { nullable?: boolean; defaultValue?: any } = {}
): Promise<boolean> {
  if (!hasAdminAccess()) {
    databaseLogger.warn('[SchemaManager] Cannot add column without admin access');
    return false;
  }

  const exists = await columnExists(tableName, columnName);
  if (exists) {
    databaseLogger.info('[SchemaManager] Column already exists', { table: tableName, column: columnName });
    return true;
  }

  let sql = `ALTER TABLE "${tableName}" ADD COLUMN IF NOT EXISTS "${columnName}" ${columnType}`;
  
  if (options.defaultValue !== undefined) {
    sql += ` DEFAULT ${options.defaultValue}`;
  }
  
  if (!options.nullable) {
    sql += ' NOT NULL';
  }
  
  sql += ';';

  databaseLogger.info('[SchemaManager] Adding column', { table: tableName, column: columnName, sql });
  
  const { error } = await executeSQL(sql);
  
  if (!error) {
    databaseLogger.info('[SchemaManager] Column added successfully', { table: tableName, column: columnName });
    return true;
  } else {
    databaseLogger.error('[SchemaManager] Failed to add column', { table: tableName, column: columnName, error });
    return false;
  }
}

/**
 * Drop a constraint from a table
 */
export async function dropConstraint(tableName: string, constraintName: string): Promise<boolean> {
  if (!hasAdminAccess()) {
    databaseLogger.warn('[SchemaManager] Cannot drop constraint without admin access');
    return false;
  }

  const sql = `ALTER TABLE "${tableName}" DROP CONSTRAINT IF EXISTS "${constraintName}";`;

  databaseLogger.info('[SchemaManager] Dropping constraint', { table: tableName, constraint: constraintName });
  
  const { error } = await executeSQL(sql);
  
  if (!error) {
    databaseLogger.info('[SchemaManager] Constraint dropped successfully', { table: tableName, constraint: constraintName });
    return true;
  } else {
    databaseLogger.error('[SchemaManager] Failed to drop constraint', { table: tableName, constraint: constraintName, error });
    return false;
  }
}

/**
 * Drop a trigger from a table
 */
export async function dropTrigger(tableName: string, triggerName: string): Promise<boolean> {
  if (!hasAdminAccess()) {
    databaseLogger.warn('[SchemaManager] Cannot drop trigger without admin access');
    return false;
  }

  const sql = `DROP TRIGGER IF EXISTS "${triggerName}" ON "${tableName}";`;

  databaseLogger.info('[SchemaManager] Dropping trigger', { table: tableName, trigger: triggerName });
  
  const { error } = await executeSQL(sql);
  
  if (!error) {
    databaseLogger.info('[SchemaManager] Trigger dropped successfully', { table: tableName, trigger: triggerName });
    return true;
  } else {
    databaseLogger.error('[SchemaManager] Failed to drop trigger', { table: tableName, trigger: triggerName, error });
    return false;
  }
}

/**
 * Drop an index
 */
export async function dropIndex(indexName: string): Promise<boolean> {
  if (!hasAdminAccess()) {
    databaseLogger.warn('[SchemaManager] Cannot drop index without admin access');
    return false;
  }

  const sql = `DROP INDEX IF EXISTS "${indexName}";`;

  databaseLogger.info('[SchemaManager] Dropping index', { index: indexName });
  
  const { error } = await executeSQL(sql);
  
  if (!error) {
    databaseLogger.info('[SchemaManager] Index dropped successfully', { index: indexName });
    return true;
  } else {
    databaseLogger.error('[SchemaManager] Failed to drop index', { index: indexName, error });
    return false;
  }
}

/**
 * Get all constraints for a table
 */
export async function getTableConstraints(tableName: string): Promise<string[]> {
  if (!hasAdminAccess()) return [];

  const admin = getAdminClient();
  
  try {
    const { data, error } = await admin
      .from('information_schema.table_constraints' as any)
      .select('constraint_name')
      .eq('table_schema', 'public')
      .eq('table_name', tableName);

    if (error || !data) return [];
    
    return data.map((row: any) => row.constraint_name);
  } catch (err) {
    databaseLogger.warn('[SchemaManager] Could not get constraints', { tableName, err });
    return [];
  }
}

/**
 * Get all triggers for a table
 */
export async function getTableTriggers(tableName: string): Promise<string[]> {
  if (!hasAdminAccess()) return [];

  try {
    const sql = `
      SELECT trigger_name 
      FROM information_schema.triggers 
      WHERE event_object_schema = 'public' 
      AND event_object_table = '${tableName}'
    `;
    
    const { data } = await executeSQL(sql);
    
    if (!data) return [];
    
    return Array.isArray(data) ? data.map((row: any) => row.trigger_name) : [];
  } catch (err) {
    databaseLogger.warn('[SchemaManager] Could not get triggers', { tableName, err });
    return [];
  }
}

/**
 * Parse error message to extract missing table/column name
 */
export function parseMissingResource(errorMessage: string): {
  type: 'table' | 'column' | 'constraint' | 'unknown';
  tableName?: string;
  columnName?: string;
  constraintName?: string;
} {
  const msg = errorMessage.toLowerCase();

  // Column does not exist
  if (msg.includes('column') && msg.includes('does not exist')) {
    const match = errorMessage.match(/column\s+"?([^"\s.]+)"?\.?"?([^"\s]+)"?\s+does not exist/i);
    if (match) {
      return {
        type: 'column',
        tableName: match[1],
        columnName: match[2],
      };
    }
  }

  // Table does not exist
  if (msg.includes('table') && msg.includes('does not exist')) {
    const match = errorMessage.match(/table\s+"?([^"\s]+)"?\s+does not exist/i);
    if (match) {
      return {
        type: 'table',
        tableName: match[1],
      };
    }
  }

  // Constraint violation
  if (msg.includes('constraint') || msg.includes('violates')) {
    const match = errorMessage.match(/constraint\s+"?([^"\s]+)"?/i);
    if (match) {
      return {
        type: 'constraint',
        constraintName: match[1],
      };
    }
  }

  return { type: 'unknown' };
}

/**
 * Auto-fix schema based on error message
 */
export async function autoFixSchemaError(errorMessage: string): Promise<boolean> {
  const parsed = parseMissingResource(errorMessage);

  databaseLogger.info('[SchemaManager] Auto-fixing schema error', { error: errorMessage, parsed });

  switch (parsed.type) {
    case 'column':
      if (parsed.tableName && parsed.columnName) {
        // Add missing column with a default type
        return await addColumn(parsed.tableName, parsed.columnName, 'TEXT', { nullable: true });
      }
      break;

    case 'table':
      if (parsed.tableName) {
        // Create a basic table with an id column
        return await createTable({
          tableName: parsed.tableName,
          columns: [
            { name: 'id', type: 'UUID', defaultValue: 'gen_random_uuid()' },
            { name: 'created_at', type: 'TIMESTAMPTZ', defaultValue: 'now()' },
          ],
          primaryKey: 'id',
        });
      }
      break;

    case 'constraint':
      // Note: We need table name to drop constraint, might need more parsing
      databaseLogger.warn('[SchemaManager] Constraint error detected but need more info to fix', { parsed });
      return false;
  }

  return false;
}

export const schemaManager = {
  tableExists,
  columnExists,
  createTable,
  addColumn,
  dropConstraint,
  dropTrigger,
  dropIndex,
  getTableConstraints,
  getTableTriggers,
  parseMissingResource,
  autoFixSchemaError,
  executeSQL,
};

export default schemaManager;
