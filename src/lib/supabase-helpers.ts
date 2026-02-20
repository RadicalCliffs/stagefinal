/**
 * Supabase Type Helpers
 * 
 * This module provides properly typed helper functions for Supabase queries
 * to avoid the need for `as any` casts throughout the codebase.
 * 
 * The generated Supabase types have optional fields which causes TypeScript
 * to infer `never` in some cases. These helpers provide proper typing.
 */

import type { Database } from '../../supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Type helper to extract table row types from the Database type
 */
export type Tables = Database['public']['Tables'];
export type TableName = keyof Tables;
export type Row<T extends TableName> = Tables[T]['Row'];
export type Insert<T extends TableName> = Tables[T]['Insert'];
export type Update<T extends TableName> = Tables[T]['Update'];

/**
 * Type helper for RPC functions
 */
export type Functions = Database['public']['Functions'];
export type FunctionName = keyof Functions;
export type FunctionArgs<T extends FunctionName> = Functions[T]['Args'];
export type FunctionReturn<T extends FunctionName> = Functions[T]['Returns'];

/**
 * Type-safe wrapper for Supabase RPC calls
 * 
 * This avoids the need for `(supabase.rpc as any)` throughout the codebase
 */
export async function callRPC<T extends FunctionName>(
  supabase: SupabaseClient<Database>,
  functionName: T,
  args: FunctionArgs<T>
): Promise<{ data: FunctionReturn<T> | null; error: any }> {
  // TypeScript has issues with RPC type inference, so we need to cast here
  // but at least it's centralized in one place
  const result = await (supabase.rpc as any)(functionName, args);
  return result;
}

/**
 * Type helper for query results with proper nullability handling
 */
export type QueryResult<T> = {
  data: T | null;
  error: any;
};

/**
 * Helper to safely access query results with proper type checking
 */
export function unwrapQuery<T>(
  result: QueryResult<T>,
  errorMessage?: string
): T {
  if (result.error) {
    throw new Error(errorMessage || result.error.message);
  }
  if (!result.data) {
    throw new Error(errorMessage || 'No data returned from query');
  }
  return result.data;
}

/**
 * Helper for single row queries that might return null
 */
export function unwrapMaybe<T>(
  result: QueryResult<T>
): T | null {
  if (result.error) {
    throw result.error;
  }
  return result.data;
}

/**
 * Type-safe order clause helper
 */
export type OrderOptions = {
  ascending?: boolean;
  nullsFirst?: boolean;
};

/**
 * Creates a properly typed order options object
 */
export function createOrderOptions(options: OrderOptions): any {
  return options;
}
