import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://cyxjzycxnfqctxocolwr.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required');
}

// Create Supabase client with explicit persistence configuration
// This ensures sessions survive page refreshes and navigations
const supabase = createClient(supabaseUrl, supabaseKey, {
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
});

export default supabase;
export { supabase };
