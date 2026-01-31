import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// Inlined CORS configuration (bundler doesn't support shared module imports)
import { toPrizePid, isPrizePid } from "../_shared/userId.ts";

const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://substage.theprize.io';
const ALLOWED_ORIGINS = [
  SITE_URL,
  'https://substage.theprize.io',
  'https://theprize.io',
  'https://theprizeio.netlify.app',
  'https://www.theprize.io',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8888',
];

function getCorsOrigin(requestOrigin: string | null): string {
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
    return requestOrigin;
  }
  return SITE_URL;
}

function buildCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const origin = getCorsOrigin(requestOrigin);
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
    status: 204,
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

        // First, try to find the user by canonical_user_id (primary lookup)
        let checkResponse = await fetch(
            `${supabaseUrl}/rest/v1/user_profiles_raw?canonical_user_id=eq.${encodeURIComponent(canonicalUserId)}`,
            {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${serviceRoleKey}`,
                    'apikey': serviceRoleKey,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (!checkResponse.ok) {
            const errorText = await checkResponse.text();
            throw new Error(`Failed to check user profile: ${errorText}`);
        }

        let existingProfiles = await checkResponse.json();
        let queryField = 'canonical_user_id';
        let queryValue = canonicalUserId;

        // If no results with canonical, try fallback lookups for legacy data
        if (!existingProfiles || existingProfiles.length === 0) {
            console.log(`[update-user-avatar] No match with canonical ID, trying legacy lookups`);

            // Try by privy_wallet_id if it starts with did:privy:
            if (user_id.startsWith('did:privy:')) {
                queryField = 'privy_wallet_id';
                queryValue = user_id;
            }
            // Try by uid if it starts with id_
            else if (user_id.startsWith('id_')) {
                queryField = 'uid';
                queryValue = user_id;
            }
            // Otherwise try uid as fallback
            else {
                queryField = 'uid';
                queryValue = user_id;
            }

            checkResponse = await fetch(
                `${supabaseUrl}/rest/v1/user_profiles_raw?${queryField}=eq.${encodeURIComponent(queryValue)}`,
                {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${serviceRoleKey}`,
                        'apikey': serviceRoleKey,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (!checkResponse.ok) {
                const errorText = await checkResponse.text();
                throw new Error(`Failed to check user profile (fallback): ${errorText}`);
            }

            existingProfiles = await checkResponse.json();
        }

        if (!existingProfiles || existingProfiles.length === 0) {
            return new Response(JSON.stringify({
                error: {
                    code: 'USER_NOT_FOUND',
                    message: `User not found with ${queryField}: ${queryValue}`
                }
            }), {
                status: 404,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // Update existing profile with new avatar URL
        const updateResponse = await fetch(
            `${supabaseUrl}/rest/v1/user_profiles_raw?${queryField}=eq.${encodeURIComponent(queryValue)}`,
            {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${serviceRoleKey}`,
                    'apikey': serviceRoleKey,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=representation'
                },
                body: JSON.stringify({
                    image_url: image_url
                })
            }
        );

        if (!updateResponse.ok) {
            const errorText = await updateResponse.text();
            throw new Error(`Failed to update avatar: ${errorText}`);
        }

        const updatedProfile = await updateResponse.json();

        // Return success response
        return new Response(JSON.stringify({
            data: {
                success: true,
                profile: Array.isArray(updatedProfile) ? updatedProfile[0] : updatedProfile
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
