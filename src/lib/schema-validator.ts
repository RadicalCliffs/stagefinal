/**
 * Schema Validator for Omnipotent Data Service
 * 
 * Provides quick lookup and validation of database schema objects.
 * Automatically creates missing functions, indexes, triggers, and constraints
 * at key points in the user journey.
 * 
 * Key Features:
 * - Quick existence checks (cached for performance)
 * - Auto-creation of missing schema objects
 * - Non-intrusive: only fixes what's missing
 * - Journey-aware: validates at specific user flow points
 */

import { hasAdminAccess, getAdminClient } from './supabase-admin';
import { databaseLogger } from './debug-console';
import { schemaManager } from './aggressive-schema-manager';

// Cache for schema existence checks (TTL: 60 seconds)
interface SchemaCache {
  [key: string]: { exists: boolean; timestamp: number };
}

const schemaCache: SchemaCache = {};
const CACHE_TTL = 60000; // 60 seconds

/**
 * Clear schema cache (used after creating schema objects)
 */
export function clearSchemaCache(pattern?: string): void {
  if (!pattern) {
    Object.keys(schemaCache).forEach(key => delete schemaCache[key]);
    databaseLogger.info('[SchemaValidator] Cache cleared');
  } else {
    Object.keys(schemaCache).forEach(key => {
      if (key.includes(pattern)) {
        delete schemaCache[key];
      }
    });
    databaseLogger.info('[SchemaValidator] Cache cleared for pattern', { pattern });
  }
}

/**
 * Check if a schema object exists (with caching)
 */
function getCached(key: string): boolean | null {
  const cached = schemaCache[key];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.exists;
  }
  return null;
}

/**
 * Set cache value
 */
function setCached(key: string, exists: boolean): void {
  schemaCache[key] = { exists, timestamp: Date.now() };
}

// =============================================================================
// QUICK LOOKUP METHODS
// =============================================================================

/**
 * Quick check if a function exists
 */
export async function functionExists(functionName: string): Promise<boolean> {
  const cacheKey = `function:${functionName}`;
  const cached = getCached(cacheKey);
  if (cached !== null) return cached;

  if (!hasAdminAccess()) {
    setCached(cacheKey, false);
    return false;
  }

  const admin = getAdminClient();
  
  try {
    const { data, error } = await admin
      .from('information_schema.routines' as any)
      .select('routine_name')
      .eq('routine_schema', 'public')
      .eq('routine_name', functionName)
      .maybeSingle();

    const exists = !error && data !== null;
    setCached(cacheKey, exists);
    return exists;
  } catch (err) {
    databaseLogger.warn('[SchemaValidator] Could not check function existence', { functionName, err });
    setCached(cacheKey, false);
    return false;
  }
}

/**
 * Quick check if an index exists
 */
export async function indexExists(indexName: string): Promise<boolean> {
  const cacheKey = `index:${indexName}`;
  const cached = getCached(cacheKey);
  if (cached !== null) return cached;

  if (!hasAdminAccess()) {
    setCached(cacheKey, false);
    return false;
  }

  const admin = getAdminClient();
  
  try {
    const { data, error } = await admin
      .from('pg_indexes' as any)
      .select('indexname')
      .eq('schemaname', 'public')
      .eq('indexname', indexName)
      .maybeSingle();

    const exists = !error && data !== null;
    setCached(cacheKey, exists);
    return exists;
  } catch (err) {
    databaseLogger.warn('[SchemaValidator] Could not check index existence', { indexName, err });
    setCached(cacheKey, false);
    return false;
  }
}

/**
 * Quick check if a trigger exists
 */
export async function triggerExists(tableName: string, triggerName: string): Promise<boolean> {
  const cacheKey = `trigger:${tableName}:${triggerName}`;
  const cached = getCached(cacheKey);
  if (cached !== null) return cached;

  if (!hasAdminAccess()) {
    setCached(cacheKey, false);
    return false;
  }

  const admin = getAdminClient();
  
  try {
    const { data, error } = await admin
      .from('information_schema.triggers' as any)
      .select('trigger_name')
      .eq('event_object_schema', 'public')
      .eq('event_object_table', tableName)
      .eq('trigger_name', triggerName)
      .maybeSingle();

    const exists = !error && data !== null;
    setCached(cacheKey, exists);
    return exists;
  } catch (err) {
    databaseLogger.warn('[SchemaValidator] Could not check trigger existence', { tableName, triggerName, err });
    setCached(cacheKey, false);
    return false;
  }
}

/**
 * Quick check if a constraint exists
 */
export async function constraintExists(tableName: string, constraintName: string): Promise<boolean> {
  const cacheKey = `constraint:${tableName}:${constraintName}`;
  const cached = getCached(cacheKey);
  if (cached !== null) return cached;

  if (!hasAdminAccess()) {
    setCached(cacheKey, false);
    return false;
  }

  const admin = getAdminClient();
  
  try {
    const { data, error } = await admin
      .from('information_schema.table_constraints' as any)
      .select('constraint_name')
      .eq('table_schema', 'public')
      .eq('table_name', tableName)
      .eq('constraint_name', constraintName)
      .maybeSingle();

    const exists = !error && data !== null;
    setCached(cacheKey, exists);
    return exists;
  } catch (err) {
    databaseLogger.warn('[SchemaValidator] Could not check constraint existence', { tableName, constraintName, err });
    setCached(cacheKey, false);
    return false;
  }
}

// =============================================================================
// AUTO-CREATION METHODS
// =============================================================================

/**
 * Create an index if it doesn't exist
 */
export async function ensureIndex(
  indexName: string,
  tableName: string,
  columns: string[],
  options: { unique?: boolean; where?: string } = {}
): Promise<boolean> {
  if (!hasAdminAccess()) return false;

  const exists = await indexExists(indexName);
  if (exists) {
    databaseLogger.debug('[SchemaValidator] Index already exists', { indexName });
    return true;
  }

  const uniqueStr = options.unique ? 'UNIQUE ' : '';
  const whereStr = options.where ? ` WHERE ${options.where}` : '';
  const columnsStr = columns.map(c => `"${c}"`).join(', ');
  
  const sql = `CREATE ${uniqueStr}INDEX IF NOT EXISTS "${indexName}" ON "${tableName}" (${columnsStr})${whereStr};`;

  databaseLogger.info('[SchemaValidator] Creating index', { indexName, tableName, columns });
  
  const { error } = await schemaManager.executeSQL(sql);
  
  if (!error) {
    databaseLogger.info('[SchemaValidator] ✓ Index created successfully', { indexName });
    clearSchemaCache(`index:${indexName}`);
    return true;
  } else {
    databaseLogger.error('[SchemaValidator] Failed to create index', { indexName, error });
    return false;
  }
}

/**
 * Create a function if it doesn't exist
 */
export async function ensureFunction(
  functionName: string,
  functionDefinition: string
): Promise<boolean> {
  if (!hasAdminAccess()) return false;

  const exists = await functionExists(functionName);
  if (exists) {
    databaseLogger.debug('[SchemaValidator] Function already exists', { functionName });
    return true;
  }

  databaseLogger.info('[SchemaValidator] Creating function', { functionName });
  
  const { error } = await schemaManager.executeSQL(functionDefinition);
  
  if (!error) {
    databaseLogger.info('[SchemaValidator] ✓ Function created successfully', { functionName });
    clearSchemaCache(`function:${functionName}`);
    return true;
  } else {
    databaseLogger.error('[SchemaValidator] Failed to create function', { functionName, error });
    return false;
  }
}

/**
 * Create a trigger if it doesn't exist
 */
export async function ensureTrigger(
  triggerName: string,
  tableName: string,
  triggerDefinition: string
): Promise<boolean> {
  if (!hasAdminAccess()) return false;

  const exists = await triggerExists(tableName, triggerName);
  if (exists) {
    databaseLogger.debug('[SchemaValidator] Trigger already exists', { triggerName, tableName });
    return true;
  }

  databaseLogger.info('[SchemaValidator] Creating trigger', { triggerName, tableName });
  
  const { error } = await schemaManager.executeSQL(triggerDefinition);
  
  if (!error) {
    databaseLogger.info('[SchemaValidator] ✓ Trigger created successfully', { triggerName });
    clearSchemaCache(`trigger:${tableName}:${triggerName}`);
    return true;
  } else {
    databaseLogger.error('[SchemaValidator] Failed to create trigger', { triggerName, error });
    return false;
  }
}

// =============================================================================
// USER JOURNEY VALIDATION POINTS
// =============================================================================

/**
 * Validate schema for ticket reservation operations
 * Called before ticket reservation attempts
 */
export async function validateReservationSchema(): Promise<void> {
  if (!hasAdminAccess()) {
    databaseLogger.debug('[SchemaValidator] Skipping validation - no admin access');
    return;
  }

  databaseLogger.info('[SchemaValidator] Validating reservation schema...');

  // Ensure pending_tickets table exists with required columns
  const pendingTicketsExists = await schemaManager.tableExists('pending_tickets');
  if (!pendingTicketsExists) {
    databaseLogger.warn('[SchemaValidator] pending_tickets table missing, creating...');
    await schemaManager.createTable({
      tableName: 'pending_tickets',
      columns: [
        { name: 'id', type: 'UUID', defaultValue: 'gen_random_uuid()' },
        { name: 'user_id', type: 'TEXT' },
        { name: 'competition_id', type: 'TEXT' },
        { name: 'ticket_numbers', type: 'INTEGER[]' },
        { name: 'ticket_count', type: 'INTEGER' },
        { name: 'ticket_price', type: 'NUMERIC' },
        { name: 'total_amount', type: 'NUMERIC' },
        { name: 'status', type: 'TEXT' },
        { name: 'expires_at', type: 'TIMESTAMPTZ' },
        { name: 'created_at', type: 'TIMESTAMPTZ', defaultValue: 'now()' },
      ],
      primaryKey: 'id',
    });
  }

  // Ensure critical indexes exist for performance
  await ensureIndex(
    'idx_pending_tickets_competition_status',
    'pending_tickets',
    ['competition_id', 'status'],
    { where: "status IN ('pending', 'confirming')" }
  );

  await ensureIndex(
    'idx_pending_tickets_expires_at',
    'pending_tickets',
    ['expires_at'],
    { where: "expires_at > now()" }
  );

  await ensureIndex(
    'idx_pending_tickets_user_competition',
    'pending_tickets',
    ['user_id', 'competition_id']
  );

  databaseLogger.info('[SchemaValidator] ✓ Reservation schema validated');
}

/**
 * Validate schema for competition queries
 * Called before competition data fetching
 */
export async function validateCompetitionSchema(): Promise<void> {
  if (!hasAdminAccess()) {
    databaseLogger.debug('[SchemaValidator] Skipping validation - no admin access');
    return;
  }

  databaseLogger.info('[SchemaValidator] Validating competition schema...');

  // Ensure competitions table exists
  const competitionsExists = await schemaManager.tableExists('competitions');
  if (!competitionsExists) {
    databaseLogger.warn('[SchemaValidator] competitions table missing, creating...');
    await schemaManager.createTable({
      tableName: 'competitions',
      columns: [
        { name: 'id', type: 'UUID', defaultValue: 'gen_random_uuid()' },
        { name: 'uid', type: 'TEXT' },
        { name: 'title', type: 'TEXT' },
        { name: 'description', type: 'TEXT' },
        { name: 'image_url', type: 'TEXT' },
        { name: 'status', type: 'TEXT', defaultValue: "'active'" },
        { name: 'total_tickets', type: 'INTEGER' },
        { name: 'tickets_sold', type: 'INTEGER', defaultValue: '0' },
        { name: 'ticket_price', type: 'NUMERIC' },
        { name: 'prize_value', type: 'TEXT' },
        { name: 'end_date', type: 'TIMESTAMPTZ' },
        { name: 'deleted', type: 'BOOLEAN', defaultValue: 'false' },
        { name: 'created_at', type: 'TIMESTAMPTZ', defaultValue: 'now()' },
        { name: 'updated_at', type: 'TIMESTAMPTZ', defaultValue: 'now()' },
      ],
      primaryKey: 'id',
    });
  }

  // Ensure performance indexes
  await ensureIndex(
    'idx_competitions_status_deleted',
    'competitions',
    ['status', 'deleted']
  );

  await ensureIndex(
    'idx_competitions_end_date',
    'competitions',
    ['end_date']
  );

  databaseLogger.info('[SchemaValidator] ✓ Competition schema validated');
}

/**
 * Validate schema for user entries
 * Called before entry queries
 */
export async function validateEntriesSchema(): Promise<void> {
  if (!hasAdminAccess()) {
    databaseLogger.debug('[SchemaValidator] Skipping validation - no admin access');
    return;
  }

  databaseLogger.info('[SchemaValidator] Validating entries schema...');

  // Ensure critical indexes on v_joincompetition_active view's base table
  await ensureIndex(
    'idx_joincompetition_competition_id',
    'v_joincompetition_active',
    ['competitionid']
  );

  databaseLogger.info('[SchemaValidator] ✓ Entries schema validated');
}

/**
 * Validate all critical schemas at once
 * Called on app initialization or when admin access is detected
 */
export async function validateAllSchemas(): Promise<void> {
  if (!hasAdminAccess()) {
    databaseLogger.debug('[SchemaValidator] Skipping validation - no admin access');
    return;
  }

  databaseLogger.info('[SchemaValidator] Running full schema validation...');

  await Promise.all([
    validateReservationSchema(),
    validateCompetitionSchema(),
    validateEntriesSchema(),
  ]);

  databaseLogger.info('[SchemaValidator] ✓ Full schema validation complete');
}

export const schemaValidator = {
  // Quick lookup methods
  functionExists,
  indexExists,
  triggerExists,
  constraintExists,
  
  // Auto-creation methods
  ensureIndex,
  ensureFunction,
  ensureTrigger,
  
  // Journey validation points
  validateReservationSchema,
  validateCompetitionSchema,
  validateEntriesSchema,
  validateAllSchemas,
  
  // Utility
  clearSchemaCache,
};

export default schemaValidator;
