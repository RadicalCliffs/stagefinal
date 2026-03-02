import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://mthwfldcjvpxjtmrqkqm.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables: VITE_SUPABASE_URL and VITE_SUPABASE_SERVICE_ROLE_KEY are required');
}

// Create Supabase client with explicit persistence configuration and TypeScript types
// This ensures sessions survive page refreshes and navigations
const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
  auth: {
    // Store session in localStorage for persistence across page loads
    persistSession: true,
    // Use localStorage as the storage mechanism (default, but explicit for clarity)
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    // Auto-refresh tokens before they expire
    autoRefreshToken: true,
    // Detect session from URL (for OAuth redirects)
    detectSessionInUrl: true,
    // Storage key prefix - don't change this as existing sessions use this key
    storageKey: 'sb-' + new URL(supabaseUrl).hostname.split('.')[0] + '-auth-token',
  },
  // NOTE: global.headers configuration removed to prevent CORS preflight failures
  // Headers like 'Cache-Control', 'Pragma', and 'Expires' are non-simple headers
  // that trigger CORS preflight (OPTIONS) requests for POST/RPC calls
  // This was causing "Fetch failed loading: POST" errors for ticket reservations
  // Cache control can be handled via Supabase dashboard settings if needed
});

export default supabase;
export { supabase };
