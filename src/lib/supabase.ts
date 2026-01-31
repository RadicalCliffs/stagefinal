import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://mthwfldcjvpxjtmrqkqm.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required');
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
  global: {
    headers: {
      // Prevent Safari and other browsers from aggressively caching responses
      // This fixes Safari users not seeing recent entries and transactions
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    },
  },
});

export default supabase;
export { supabase };
