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
 */
export function getCorsOrigin(requestOrigin: string | null): string {
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
    return requestOrigin;
  }
  return SITE_URL;
}

/**
 * Build CORS headers for a given request origin
 * Always includes Vary: Origin for proper caching behavior
 */
export function buildCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const origin = getCorsOrigin(requestOrigin);
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

/**
 * Handle OPTIONS preflight request
 * Returns a 204 No Content response with proper CORS headers
 */
export function handleCorsOptions(req: Request): Response {
  const origin = req.headers.get('origin');
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(origin),
  });
}

// corsHeaders export for backwards compatibility
// IMPORTANT: This returns dynamic headers based on SITE_URL to avoid wildcard origin
// For new code, prefer using buildCorsHeaders(req.headers.get('origin'))
export const corsHeaders = {
  'Access-Control-Allow-Origin': SITE_URL,
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
