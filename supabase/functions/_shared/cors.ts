// Dynamic CORS configuration for Supabase Edge Functions
// Allows stage.theprize.io and localhost development origins

const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://substage.theprize.io';
const ALLOWED_ORIGINS = [
  SITE_URL,
  'https://substage.theprize.io',
  'https://theprize.io',
  'https://theprizeio.netlify.app', // Netlify hosted site
  'https://www.theprize.io',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8888', // Netlify dev server
];

/**
 * Get the validated origin for CORS headers
 * Returns the request origin if it's in the allowed list, otherwise falls back to SITE_URL
 * IMPORTANT: Never returns empty string "" because Access-Control-Allow-Credentials: true
 * requires a specific origin (wildcard and empty string are not allowed with credentials)
 */
export function getCorsOrigin(requestOrigin: string | null): string {
  // Validate request origin is in allowed list
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
    return requestOrigin;
  }
  
  // Always return a specific origin (never empty string or wildcard)
  // This is required when using Access-Control-Allow-Credentials: true
  return SITE_URL;
}

/**
 * Build CORS headers for a given request origin
 * Always includes Vary: Origin for proper caching behavior
 * 
 * SECURITY NOTES:
 * - Access-Control-Allow-Origin MUST be a specific origin (not * or empty string)
 *   when Access-Control-Allow-Credentials is true
 * - Vary: Origin ensures proper caching when origin-specific responses are sent
 * - All responses (success, error, preflight) must include these headers
 */
export function buildCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const origin = getCorsOrigin(requestOrigin);
  
  // Ensure we never return empty string (required for credentials: true)
  if (!origin) {
    throw new Error('CORS origin cannot be empty when using credentials');
  }
  
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control, pragma, expires',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

/**
 * Handle OPTIONS preflight request
 * Returns a 200 OK response with proper CORS headers
 */
export function handleCorsOptions(req: Request): Response {
  const origin = req.headers.get('origin');
  return new Response(null, {
    status: 200,
    headers: buildCorsHeaders(origin),
  });
}

// corsHeaders export for backwards compatibility
// IMPORTANT: This returns dynamic headers based on SITE_URL to avoid wildcard origin
// For new code, prefer using buildCorsHeaders(req.headers.get('origin'))
export const corsHeaders = {
  'Access-Control-Allow-Origin': SITE_URL,
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control, pragma, expires',
}
