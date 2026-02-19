// functions/purchase-with-balance/index.ts
// Server-side proxy using SUPABASE_SERVICE_ROLE_KEY (safe on server, NEVER in browser)

import { buildCorsHeaders, handleCorsOptions } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return handleCorsOptions(req);
  }

  // Build CORS headers based on request origin
  const corsHeaders = buildCorsHeaders(req.headers.get('origin'));

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { 
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Require an Authorization header with either a user token or anon key
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ code: 401, message: 'Missing authorization header' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const {
      p_user_identifier,
      p_competition_id,
      p_ticket_price,
      p_ticket_count = null,
      p_ticket_numbers = null,
      p_idempotency_key,
    } = await req.json()
    if (!p_user_identifier || !p_competition_id || typeof p_ticket_price !== 'number') {
      return new Response(JSON.stringify({ error: 'Missing required params' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    const baseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!baseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    const res = await fetch(`${baseUrl}/rest/v1/rpc/purchase_tickets_with_balance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        p_user_identifier,
        p_competition_id,
        p_ticket_price,
        p_ticket_count,
        p_ticket_numbers,
        p_idempotency_key,
      }),
    })
    const text = await res.text()
    if (!res.ok) {
      return new Response(text || JSON.stringify({ error: 'RPC error' }), {
        status: res.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    // Pass-through JSON from RPC
    return new Response(text, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message ?? 'Unhandled error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
