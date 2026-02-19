// functions/purchase-tickets-with-bonus/index.ts
// Purchase tickets with bonus/balance using reservation
// Accepts: reservation_id, uid (competition), optional ticket_numbers

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// ============================================================================
// CORS Configuration
// ============================================================================

const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://stage.theprize.io';
const ALLOWED_ORIGINS = [
  SITE_URL,
  'https://stage.theprize.io',
  'https://theprize.io',
  'https://theprizeio.netlify.app',
  'https://www.theprize.io',
  'https://vocal-cascaron-bcef9b.netlify.app',
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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control, pragma, expires',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function jsonResponse(data: object, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

function errorResponse(code: string, message: string, status: number, corsHeaders: Record<string, string>): Response {
  return jsonResponse({ success: false, error: { code, message } }, status, corsHeaders);
}

// ============================================================================
// Main Handler
// ============================================================================

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const corsHeaders = buildCorsHeaders(req.headers.get('origin'));

  console.log(`[purchase-tickets-with-bonus][${requestId}] ${req.method} request received at ${new Date().toISOString()}`);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Method Not Allowed', 405, corsHeaders);
  }

  try {
    // Parse request body
    const body = await req.json();
    const {
      reservation_id,
      uid,
      ticket_numbers,
    } = body;

    console.log(`[purchase-tickets-with-bonus][${requestId}] Parsed request:`, {
      has_reservation_id: !!reservation_id,
      has_uid: !!uid,
      has_ticket_numbers: !!ticket_numbers,
      ticket_count: ticket_numbers?.length || 0,
    });

    // Validate required parameters
    if (!reservation_id) {
      return errorResponse(
        'VALIDATION_ERROR',
        'Missing required parameter: reservation_id',
        400,
        corsHeaders
      );
    }

    if (!uid) {
      return errorResponse(
        'VALIDATION_ERROR',
        'Missing required parameter: uid (competition ID)',
        400,
        corsHeaders
      );
    }

    // Validate UUID format
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(reservation_id)) {
      return errorResponse(
        'VALIDATION_ERROR',
        'Invalid reservation_id format (must be UUID)',
        400,
        corsHeaders
      );
    }

    if (!uuidPattern.test(uid)) {
      return errorResponse(
        'VALIDATION_ERROR',
        'Invalid uid format (must be UUID)',
        400,
        corsHeaders
      );
    }

    // Validate ticket_numbers if provided
    if (ticket_numbers !== undefined && ticket_numbers !== null) {
      if (!Array.isArray(ticket_numbers)) {
        return errorResponse(
          'VALIDATION_ERROR',
          'ticket_numbers must be an array',
          400,
          corsHeaders
        );
      }
      
      if (ticket_numbers.some((num: any) => typeof num !== 'number' || !Number.isInteger(num))) {
        return errorResponse(
          'VALIDATION_ERROR',
          'ticket_numbers must contain only integers',
          400,
          corsHeaders
        );
      }
    }

    const baseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!baseUrl || !serviceRoleKey) {
      return errorResponse(
        'CONFIGURATION_ERROR',
        'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
        500,
        corsHeaders
      );
    }

    const supabase = createClient(baseUrl, serviceRoleKey);

    // Fetch reservation details
    console.log(`[purchase-tickets-with-bonus][${requestId}] Fetching reservation ${reservation_id}`);
    
    const { data: reservation, error: reservationError } = await supabase
      .from('pending_tickets')
      .select('*')
      .eq('id', reservation_id)
      .maybeSingle();

    if (reservationError) {
      console.error(`[purchase-tickets-with-bonus][${requestId}] Reservation fetch error:`, reservationError);
      return errorResponse(
        'DATABASE_ERROR',
        `Failed to fetch reservation: ${reservationError.message}`,
        500,
        corsHeaders
      );
    }

    if (!reservation) {
      return errorResponse(
        'NOT_FOUND',
        'Reservation not found',
        404,
        corsHeaders
      );
    }

    // Check if reservation is already confirmed or expired
    if (reservation.status === 'confirmed') {
      console.log(`[purchase-tickets-with-bonus][${requestId}] Reservation already confirmed`);
      return errorResponse(
        'ALREADY_PROCESSED',
        'Reservation already confirmed',
        409,
        corsHeaders
      );
    }

    if (reservation.status === 'expired') {
      return errorResponse(
        'RESERVATION_EXPIRED',
        'Reservation has expired',
        410,
        corsHeaders
      );
    }

    // Use ticket_numbers from request if provided, otherwise from reservation
    const ticketsToConfirm = ticket_numbers || reservation.ticket_numbers || [];
    
    if (!ticketsToConfirm || ticketsToConfirm.length === 0) {
      return errorResponse(
        'VALIDATION_ERROR',
        'No ticket numbers provided in request or reservation',
        400,
        corsHeaders
      );
    }

    console.log(`[purchase-tickets-with-bonus][${requestId}] Confirming ${ticketsToConfirm.length} tickets for competition ${uid}`);

    // Update reservation status to confirmed
    const { error: updateError } = await supabase
      .from('pending_tickets')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        competition_id: uid,
        ticket_numbers: ticketsToConfirm,
      })
      .eq('id', reservation_id);

    if (updateError) {
      console.error(`[purchase-tickets-with-bonus][${requestId}] Failed to update reservation:`, updateError);
      return errorResponse(
        'UPDATE_ERROR',
        `Failed to confirm reservation: ${updateError.message}`,
        500,
        corsHeaders
      );
    }

    // Get user ID from reservation
    const userId = reservation.user_id || reservation.canonical_user_id;

    // Create competition entry
    console.log(`[purchase-tickets-with-bonus][${requestId}] Creating competition entry`);
    
    const entryId = crypto.randomUUID();
    const ticketNumbersStr = ticketsToConfirm.join(',');
    const ticketPrice = reservation.ticket_price || 0;
    const totalCost = ticketPrice * ticketsToConfirm.length;

    const { error: entryError } = await supabase
      .from('joincompetition')
      .insert({
        uid: entryId,
        userid: userId,
        canonical_user_id: userId,
        competitionid: uid,
        ticketnumbers: ticketNumbersStr,
        numberoftickets: ticketsToConfirm.length,
        amountspent: totalCost,
        transactionhash: reservation_id, // Use reservation_id as transaction hash for idempotency
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (entryError) {
      console.error(`[purchase-tickets-with-bonus][${requestId}] Failed to create entry:`, entryError);
      // If entry creation fails, revert reservation status
      await supabase
        .from('pending_tickets')
        .update({ status: 'pending' })
        .eq('id', reservation_id);
        
      return errorResponse(
        'ENTRY_ERROR',
        `Failed to create competition entry: ${entryError.message}`,
        500,
        corsHeaders
      );
    }

    console.log(`[purchase-tickets-with-bonus][${requestId}] Purchase successful!`);

    // Return success response
    const responseData = {
      success: true,
      status: 'ok',
      reservation_id,
      competition_id: uid,
      entry_id: entryId,
      tickets: ticketsToConfirm.map((num: number) => ({ ticket_number: num })),
      ticket_count: ticketsToConfirm.length,
      total_cost: totalCost,
      message: `Successfully confirmed ${ticketsToConfirm.length} ticket${ticketsToConfirm.length === 1 ? '' : 's'}`,
      timestamp: new Date().toISOString(),
    };

    return jsonResponse(responseData, 200, corsHeaders);

  } catch (error) {
    console.error(`[purchase-tickets-with-bonus][${requestId}] Error:`, error);
    return errorResponse(
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Internal server error',
      500,
      corsHeaders
    );
  }
});
