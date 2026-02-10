import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// Inlined CORS configuration (bundler doesn't support shared module imports)
import { toPrizePid, isPrizePid } from "../_shared/userId.ts";

const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://stage.theprize.io';
const ALLOWED_ORIGINS = [
  SITE_URL,
  'https://stage.theprize.io',
  'https://theprize.io',
  'https://theprizeio.netlify.app',
  'https://www.theprize.io',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8888',
];

function getCorsOrigin(requestOrigin: string | null): string {
  // Validate request origin is in allowed list
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
    return requestOrigin;
  }
  
  // Always return a specific origin (never empty string or wildcard)
  // This is required when using Access-Control-Allow-Credentials: true
  return SITE_URL;
}

function buildCorsHeaders(requestOrigin: string | null): Record<string, string> {
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

function handleCorsOptions(req: Request): Response {
  const origin = req.headers.get('origin');
  return new Response(null, {
    status: 200,  // Use 200 instead of 204 for better compatibility
    headers: buildCorsHeaders(origin),
  });
}

Deno.serve(async (req) => {
    // Handle CORS preflight - no auth required
    if (req.method === 'OPTIONS') {
        return handleCorsOptions(req);
    }

    // Get origin for CORS headers on all responses
    const corsHeaders = buildCorsHeaders(req.headers.get('origin'));

    try {
        // Extract parameters from request body
        const requestData = await req.json();
        const { user_id, image_url } = requestData;

        // Validate required parameters
        if (!user_id) {
            return new Response(JSON.stringify({
                error: {
                    code: 'MISSING_USER_ID',
                    message: 'user_id is required'
                }
            }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        if (!image_url) {
            return new Response(JSON.stringify({
                error: {
                    code: 'MISSING_IMAGE_URL',
                    message: 'image_url is required'
                }
            }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // Get Supabase credentials from environment
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        const supabaseUrl = Deno.env.get('SUPABASE_URL');

        if (!serviceRoleKey || !supabaseUrl) {
            throw new Error('Supabase configuration missing');
        }

        // Convert to canonical format for primary lookup
        const canonicalUserId = toPrizePid(user_id);
        console.log(`[update-user-avatar] Canonical user ID: ${canonicalUserId}`);
        console.log(`[update-user-avatar] Image URL: ${image_url}`);

        // Use the RPC function to update avatar (it has SECURITY DEFINER and handles all user ID formats)
        const rpcResponse = await fetch(
            `${supabaseUrl}/rest/v1/rpc/update_user_avatar`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${serviceRoleKey}`,
                    'apikey': serviceRoleKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    user_identifier: canonicalUserId,
                    new_avatar_url: image_url
                })
            }
        );

        if (!rpcResponse.ok) {
            const errorText = await rpcResponse.text();
            console.error(`[update-user-avatar] RPC call failed:`, errorText);
            throw new Error(`Failed to update avatar via RPC: ${errorText}`);
        }

        const rpcResult = await rpcResponse.json();
        console.log(`[update-user-avatar] RPC result:`, rpcResult);

        if (!rpcResult.success) {
            return new Response(JSON.stringify({
                error: {
                    code: 'USER_NOT_FOUND',
                    message: `User not found for identifier: ${canonicalUserId}`
                }
            }), {
                status: 404,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // Return success response
        return new Response(JSON.stringify({
            data: {
                success: true,
                avatar_url: rpcResult.avatar_url
            }
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('Avatar update error:', error);

        const errorResponse = {
            error: {
                code: 'AVATAR_UPDATE_FAILED',
                message: error.message || 'Failed to update avatar'
            }
        };

        return new Response(JSON.stringify(errorResponse), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});
