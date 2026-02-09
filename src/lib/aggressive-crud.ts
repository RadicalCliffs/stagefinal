/**
 * Aggressive CRUD Service
 * 
 * Wraps Supabase operations with automatic error recovery.
 * When operations fail due to schema issues, it automatically:
 * - Creates missing tables
 * - Adds missing columns
 * - Removes blocking constraints/triggers
 * - Retries the operation
 * 
 * This is the frontend's "get out of jail free" card for database operations.
 */

import { supabase } from './supabase';
import { getAdminClient, hasAdminAccess, getAdminClientOrFallback } from './supabase-admin';
import { schemaManager } from './aggressive-schema-manager';
import { databaseLogger } from './debug-console';

interface CRUDOptions {
  maxRetries?: number;
  autoFix?: boolean;
  useAdmin?: boolean;
}

const DEFAULT_OPTIONS: CRUDOptions = {
  maxRetries: 3,
  autoFix: true,
  useAdmin: true,
};

/**
 * Execute a database operation with aggressive error handling
 */
async function executeWithAutoFix<T>(
  operation: () => Promise<{ data: T | null; error: any }>,
  options: CRUDOptions = {}
): Promise<{ data: T | null; error: any }> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: any = null;

  for (let attempt = 0; attempt < (opts.maxRetries || 1); attempt++) {
    try {
      databaseLogger.debug('[AggressiveCRUD] Executing operation', { attempt: attempt + 1 });
      
      const result = await operation();
      
      if (!result.error) {
        databaseLogger.debug('[AggressiveCRUD] Operation succeeded', { attempt: attempt + 1 });
        return result;
      }

      lastError = result.error;
      const errorMessage = result.error?.message || String(result.error);
      
      databaseLogger.warn('[AggressiveCRUD] Operation failed', { 
        attempt: attempt + 1, 
        error: errorMessage 
      });

      // Check if this is a schema-related error that we can fix
      if (opts.autoFix && hasAdminAccess()) {
        const isSchemaError = 
          errorMessage.includes('does not exist') ||
          errorMessage.includes('constraint') ||
          errorMessage.includes('violates') ||
          errorMessage.includes('duplicate key') ||
          errorMessage.includes('unique constraint');

        if (isSchemaError) {
          databaseLogger.info('[AggressiveCRUD] Attempting auto-fix', { error: errorMessage });
          
          const fixed = await schemaManager.autoFixSchemaError(errorMessage);
          
          if (fixed) {
            databaseLogger.info('[AggressiveCRUD] Auto-fix successful, retrying operation');
            continue; // Retry the operation
          } else {
            databaseLogger.warn('[AggressiveCRUD] Auto-fix failed or not applicable');
          }
        }
      }

      // If we can't auto-fix or it's not a schema error, return the error
      if (attempt === (opts.maxRetries || 1) - 1) {
        databaseLogger.error('[AggressiveCRUD] All retry attempts exhausted', { error: errorMessage });
        return result;
      }
      
    } catch (err: any) {
      lastError = err;
      databaseLogger.error('[AggressiveCRUD] Operation threw exception', { 
        attempt: attempt + 1, 
        error: err 
      });
      
      if (attempt === (opts.maxRetries || 1) - 1) {
        return { data: null, error: err };
      }
    }

    // Wait a bit before retrying
    await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
  }

  return { data: null, error: lastError };
}

/**
 * Aggressive SELECT operation
 */
export async function aggressiveSelect<T = any>(
  table: string,
  columns: string = '*',
  filters?: Record<string, any>,
  options: CRUDOptions = {}
): Promise<{ data: T[] | null; error: any }> {
  const client = options.useAdmin && hasAdminAccess() ? getAdminClient() : supabase;
  
  return executeWithAutoFix(async () => {
    let query = (client as any).from(table).select(columns);
    
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        query = query.eq(key, value);
      });
    }
    
    return await query as any;
  }, options);
}

/**
 * Aggressive INSERT operation
 */
export async function aggressiveInsert<T = any>(
  table: string,
  data: any,
  options: CRUDOptions = {}
): Promise<{ data: T | null; error: any }> {
  const client = options.useAdmin && hasAdminAccess() ? getAdminClient() : supabase;
  
  return executeWithAutoFix(async () => {
    // First, ensure the table exists
    if (options.autoFix && hasAdminAccess()) {
      const exists = await schemaManager.tableExists(table);
      if (!exists) {
        databaseLogger.info('[AggressiveCRUD] Table does not exist, creating', { table });
        
        // Infer schema from data
        const columns = Object.keys(data).map(key => ({
          name: key,
          type: inferColumnType(data[key]),
          nullable: true,
        }));
        
        await schemaManager.createTable({
          tableName: table,
          columns: [
            { name: 'id', type: 'UUID', defaultValue: 'gen_random_uuid()' },
            ...columns,
            { name: 'created_at', type: 'TIMESTAMPTZ', defaultValue: 'now()' },
          ],
          primaryKey: 'id',
        });
      }
    }
    
    return await (client as any).from(table).insert(data).select().single() as any;
  }, options);
}

/**
 * Aggressive UPDATE operation
 */
export async function aggressiveUpdate<T = any>(
  table: string,
  data: any,
  filters: Record<string, any>,
  options: CRUDOptions = {}
): Promise<{ data: T | null; error: any }> {
  const client = options.useAdmin && hasAdminAccess() ? getAdminClient() : supabase;
  
  return executeWithAutoFix(async () => {
    // Use 'as any' to bypass TypeScript's strict client typing
    const baseClient: any = client;
    let query = baseClient.from(table).update(data);
    
    Object.entries(filters).forEach(([key, value]) => {
      query = query.eq(key, value);
    });
    
    return await query.select().single() as any;
  }, options);
}

/**
 * Aggressive UPSERT operation
 */
export async function aggressiveUpsert<T = any>(
  table: string,
  data: any,
  options: CRUDOptions & { onConflict?: string } = {}
): Promise<{ data: T | null; error: any }> {
  const client = options.useAdmin && hasAdminAccess() ? getAdminClient() : supabase;
  
  return executeWithAutoFix(async () => {
    const upsertOptions = options.onConflict ? { onConflict: options.onConflict } : undefined;
    return await (client as any).from(table).upsert(data, upsertOptions).select().single() as any;
  }, options);
}

/**
 * Aggressive DELETE operation
 */
export async function aggressiveDelete(
  table: string,
  filters: Record<string, any>,
  options: CRUDOptions = {}
): Promise<{ data: any | null; error: any }> {
  const client = options.useAdmin && hasAdminAccess() ? getAdminClient() : supabase;
  
  return executeWithAutoFix(async () => {
    let query = (client as any).from(table).delete();
    
    Object.entries(filters).forEach(([key, value]) => {
      query = query.eq(key, value);
    });
    
    return await query as any;
  }, options);
}

/**
 * Aggressive RPC call
 */
export async function aggressiveRPC<T = any>(
  functionName: string,
  params?: any,
  options: CRUDOptions = {}
): Promise<{ data: T | null; error: any }> {
  const client = options.useAdmin && hasAdminAccess() ? getAdminClient() : supabase;
  
  return executeWithAutoFix(async () => {
    return await (client as any).rpc(functionName, params);
  }, options);
}

/**
 * Infer PostgreSQL column type from JavaScript value
 */
function inferColumnType(value: any): string {
  if (value === null || value === undefined) return 'TEXT';
  
  const type = typeof value;
  
  switch (type) {
    case 'string':
      // Check if it's a UUID
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
        return 'UUID';
      }
      // Check if it's a timestamp
      if (!isNaN(Date.parse(value))) {
        return 'TIMESTAMPTZ';
      }
      return 'TEXT';
    
    case 'number':
      return Number.isInteger(value) ? 'INTEGER' : 'NUMERIC';
    
    case 'boolean':
      return 'BOOLEAN';
    
    case 'object':
      if (Array.isArray(value)) {
        return 'JSONB';
      }
      return 'JSONB';
    
    default:
      return 'TEXT';
  }
}

/**
 * Ensure a column exists in a table
 */
export async function ensureColumn(
  table: string,
  column: string,
  type: string = 'TEXT',
  options: { nullable?: boolean; defaultValue?: any } = {}
): Promise<boolean> {
  if (!hasAdminAccess()) {
    databaseLogger.warn('[AggressiveCRUD] Cannot ensure column without admin access');
    return false;
  }

  const exists = await schemaManager.columnExists(table, column);
  if (exists) return true;

  databaseLogger.info('[AggressiveCRUD] Ensuring column exists', { table, column, type });
  return await schemaManager.addColumn(table, column, type, options);
}

/**
 * Ensure a table exists
 */
export async function ensureTable(
  table: string,
  columns?: Array<{ name: string; type: string; nullable?: boolean; defaultValue?: any }>
): Promise<boolean> {
  if (!hasAdminAccess()) {
    databaseLogger.warn('[AggressiveCRUD] Cannot ensure table without admin access');
    return false;
  }

  const exists = await schemaManager.tableExists(table);
  if (exists) return true;

  databaseLogger.info('[AggressiveCRUD] Ensuring table exists', { table });
  
  const defaultColumns = columns || [
    { name: 'id', type: 'UUID', defaultValue: 'gen_random_uuid()' },
    { name: 'created_at', type: 'TIMESTAMPTZ', defaultValue: 'now()' },
    { name: 'updated_at', type: 'TIMESTAMPTZ', defaultValue: 'now()' },
  ];

  return await schemaManager.createTable({
    tableName: table,
    columns: defaultColumns,
    primaryKey: 'id',
  });
}

/**
 * Get table info (columns, types, etc.)
 */
export async function getTableInfo(table: string): Promise<any[]> {
  if (!hasAdminAccess()) return [];

  const admin = getAdminClient();
  
  try {
    const { data } = await (admin as any)
      .from('information_schema.columns')
      .select('column_name, data_type, is_nullable, column_default')
      .eq('table_schema', 'public')
      .eq('table_name', table) as any;

    return data || [];
  } catch (err) {
    databaseLogger.error('[AggressiveCRUD] Failed to get table info', { table, err });
    return [];
  }
}

export const aggressiveCRUD = {
  select: aggressiveSelect,
  insert: aggressiveInsert,
  update: aggressiveUpdate,
  upsert: aggressiveUpsert,
  delete: aggressiveDelete,
  rpc: aggressiveRPC,
  ensureColumn,
  ensureTable,
  getTableInfo,
};

export default aggressiveCRUD;
