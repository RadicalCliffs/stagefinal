/**
 * Supabase Admin Client - Service Level Access
 * 
 * This client uses service-level credentials for unrestricted database access.
 * It bypasses RLS policies and has full admin privileges to:
 * - Create/modify schema (tables, columns, constraints)
 * - Perform unrestricted CRUD operations
 * - Fix database issues on the fly
 * 
 * USAGE: Staging/Development only with full admin access
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://mthwfldcjvpxjtmrqkqm.supabase.co';

// Try multiple environment variable names for service-level key
const serviceKey = 
  import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY || 
  import.meta.env.SUPABASE_SERVICE_ROLE_KEY ||
  import.meta.env.VITE_SUPABASE_SERVICE_KEY ||
  import.meta.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl) {
  throw new Error('Missing VITE_SUPABASE_URL environment variable');
}

let supabaseAdmin: ReturnType<typeof createClient<Database>> | null = null;

// Only create admin client if service key is available
if (serviceKey) {
  supabaseAdmin = createClient<Database>(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    db: {
      schema: 'public',
    },
  });
  console.log('[SupabaseAdmin] Service-level client initialized ✓');
} else {
  console.warn('[SupabaseAdmin] Service key not found - admin client not available');
  console.warn('[SupabaseAdmin] Set VITE_SUPABASE_SERVICE_ROLE_KEY to enable aggressive mode');
}

/**
 * Check if admin client is available
 */
export function hasAdminAccess(): boolean {
  return supabaseAdmin !== null;
}

/**
 * Get admin client or throw error
 */
export function getAdminClient() {
  if (!supabaseAdmin) {
    throw new Error('Admin client not available - service key not configured');
  }
  return supabaseAdmin;
}

/**
 * Get admin client or fallback to regular client
 */
export function getAdminClientOrFallback(fallback: any) {
  return supabaseAdmin || fallback;
}

export { supabaseAdmin };
export default supabaseAdmin;
