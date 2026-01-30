import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * SIMPLIFIED BALANCE PAYMENT FUNCTION
 * 
 * This is a straightforward wrapper around the purchase_tickets_with_balance RPC.
 * No complex logic, no multiple fallbacks, no syncing across tables.
 * 
 * Flow:
 * 1. Parse request
 * 2. Call RPC with user identifier, competition, and tickets
 * 3. RPC handles everything atomically:
 *    - Checks sub_account_balance for available_balance
 *    - Matches by canonical_user_id or wallet_address  
 *    - Deducts balance
 *    - Allocates tickets (selected or lucky dip)
 * 4. Return response
 */

// =====================================================
// CORS Configuration
// =====================================================

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
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

// =====================================================
// Main Handler
// =====================================================

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const corsHeaders = buildCorsHeaders(req.headers.get('origin'));

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Only allow POST
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ status: 'error', error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log(`[${requestId}] Purchase with balance request started`);

  try {
    // =====================================================
    // STEP 1: Parse request body
    // =====================================================
    
    let body: any;
    try {
      body = await req.json();
    } catch {
      console.error(`[${requestId}] Invalid JSON body`);
      return new Response(
        JSON.stringify({ 
          status: 'error', 
          error: 'Invalid JSON body',
          errorCode: 'INVALID_JSON'
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[${requestId}] Request body keys:`, Object.keys(body));

    // Extract parameters - support multiple naming conventions for compatibility
    const competitionId = body.competition_id || body.competitionId;
    const tickets = body.tickets || body.selectedTickets || body.ticket_numbers;
    const idempotent = body.idempotent || body.idempotency_key;
    
    // User identifier can come from auth header or body
    const authHeader = req.headers.get('authorization');
    let userIdentifier = body.user_id || body.userId || body.userIdentifier || body.canonical_user_id;

    // Try to extract from JWT if not provided in body
    if (!userIdentifier && authHeader) {
      try {
        const token = authHeader.replace('Bearer ', '');
        const payload = JSON.parse(atob(token.split('.')[1]));
        userIdentifier = payload.sub;
      } catch {
        // Ignore JWT parsing errors
      }
    }

    // =====================================================
    // STEP 2: Validate required fields
    // =====================================================
    
    if (!userIdentifier) {
      console.error(`[${requestId}] Missing user identifier`);
      return new Response(
        JSON.stringify({ 
          status: 'error', 
          error: 'User identifier is required',
          errorCode: 'MISSING_USER'
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!competitionId) {
      console.error(`[${requestId}] Missing competition_id`);
      return new Response(
        JSON.stringify({ 
          status: 'error', 
          error: 'competition_id is required',
          errorCode: 'MISSING_COMPETITION'
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!tickets || !Array.isArray(tickets) || tickets.length === 0) {
      console.error(`[${requestId}] Missing or invalid tickets array`);
      return new Response(
        JSON.stringify({ 
          status: 'error', 
          error: 'tickets array is required and must not be empty',
          errorCode: 'MISSING_TICKETS',
          hint: 'Send body with: { competition_id, tickets: [{ticket_number: 1}, ...] }'
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =====================================================
    // STEP 3: Extract ticket numbers from tickets array
    // =====================================================
    
    // Frontend sends: [{ ticket_number: 1 }, { ticket_number: 5 }, ...]
    const ticketNumbers = tickets
      .map((t: any) => {
        // Handle both object format {ticket_number: N} and direct number format
        if (typeof t === 'object' && t.ticket_number !== undefined) {
          return Number(t.ticket_number);
        } else if (typeof t === 'number') {
          return t;
        }
        return NaN;
      })
      .filter((n: number) => !isNaN(n) && n > 0);

    if (ticketNumbers.length === 0) {
      console.error(`[${requestId}] No valid ticket numbers found in tickets array`);
      return new Response(
        JSON.stringify({ 
          status: 'error', 
          error: 'No valid ticket numbers found in tickets array',
          errorCode: 'INVALID_TICKET_NUMBERS'
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[${requestId}] Parsed request:`, {
      userIdentifier: userIdentifier.substring(0, 15) + '...',
      competitionId: competitionId.substring(0, 10) + '...',
      ticketCount: ticketNumbers.length,
      ticketNumbers: ticketNumbers.slice(0, 5) // Log first 5
    });

    // =====================================================
    // STEP 4: Get competition to determine ticket price
    // =====================================================
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      console.error(`[${requestId}] Missing Supabase configuration`);
      return new Response(
        JSON.stringify({ 
          status: 'error', 
          error: 'Server configuration error',
          errorCode: 'CONFIG_ERROR'
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: competition, error: compError } = await supabase
      .from("competitions")
      .select("ticket_price, status")
      .eq("id", competitionId)
      .single();

    if (compError || !competition) {
      console.error(`[${requestId}] Competition not found:`, compError?.message);
      return new Response(
        JSON.stringify({ 
          status: 'error', 
          error: 'Competition not found',
          errorCode: 'COMPETITION_NOT_FOUND'
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ticketPrice = Number(competition.ticket_price) || 1;

    console.log(`[${requestId}] Competition found:`, {
      status: competition.status,
      ticketPrice
    });

    // =====================================================
    // STEP 5: Call the simplified RPC function
    // =====================================================
    
    console.log(`[${requestId}] Calling purchase_tickets_with_balance RPC...`);

    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      'purchase_tickets_with_balance',
      {
        p_user_identifier: userIdentifier,
        p_competition_id: competitionId,
        p_ticket_price: ticketPrice,
        p_ticket_count: null, // Not using lucky dip in this flow
        p_ticket_numbers: ticketNumbers,
        p_idempotency_key: idempotent || null
      }
    );

    if (rpcError) {
      console.error(`[${requestId}] RPC error:`, rpcError);
      return new Response(
        JSON.stringify({ 
          status: 'error', 
          error: rpcError.message || 'Purchase failed',
          errorCode: 'RPC_ERROR'
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[${requestId}] RPC result:`, rpcResult);

    // =====================================================
    // STEP 6: Check RPC response and return appropriate result
    // =====================================================
    
    if (!rpcResult || typeof rpcResult !== 'object') {
      console.error(`[${requestId}] Invalid RPC response:`, rpcResult);
      return new Response(
        JSON.stringify({ 
          status: 'error', 
          error: 'Invalid response from purchase function',
          errorCode: 'INVALID_RESPONSE'
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!rpcResult.success) {
      // RPC returned an error
      const errorCode = rpcResult.error_code || 'PURCHASE_FAILED';
      const statusCode = errorCode === 'INSUFFICIENT_BALANCE' ? 402 : 400;
      
      console.error(`[${requestId}] Purchase failed:`, rpcResult.error);
      return new Response(
        JSON.stringify({ 
          status: 'error', 
          error: rpcResult.error,
          errorCode: errorCode
        }),
        { status: statusCode, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =====================================================
    // STEP 7: Success! Return response in expected format
    // =====================================================
    
    console.log(`[${requestId}] Purchase successful:`, {
      entry_id: rpcResult.entry_id,
      ticket_count: rpcResult.ticket_count,
      total_cost: rpcResult.total_cost,
      new_balance: rpcResult.new_balance
    });

    // Return in the format expected by frontend
    // Frontend expects: { status: 'ok', competition_id, tickets: [{ticket_number}], idempotent? }
    const response = {
      status: 'ok',
      success: true,
      competition_id: competitionId,
      tickets: (rpcResult.ticket_numbers || []).map((num: number) => ({ 
        ticket_number: num 
      })),
      entry_id: rpcResult.entry_id,
      ticket_count: rpcResult.ticket_count,
      total_cost: rpcResult.total_cost,
      previous_balance: rpcResult.previous_balance,
      new_balance: rpcResult.new_balance,
      idempotent: rpcResult.idempotent || false
    };

    return new Response(
      JSON.stringify(response),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );

  } catch (error) {
    console.error(`[${requestId}] Unexpected error:`, error);
    
    return new Response(
      JSON.stringify({ 
        status: 'error', 
        error: error instanceof Error ? error.message : 'Internal server error',
        errorCode: 'INTERNAL_ERROR'
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
