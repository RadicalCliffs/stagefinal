// functions/purchase-with-balance/index.ts
// Comprehensive purchase-with-balance Edge Function
// Features: CORS, retry logic, fallback mechanisms, comprehensive error handling

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
// RPC Retry Logic (SAFEGUARD 1)
// ============================================================================

async function callRpcWithRetry(
  baseUrl: string,
  serviceRoleKey: string,
  params: {
    p_user_identifier: string;
    p_competition_id: string;
    p_ticket_price: number;
    p_ticket_count: number | null;
    p_ticket_numbers: number[] | null;
    p_idempotency_key: string;
    p_reservation_id?: string | null;
  },
  requestId: string,
  maxRetries: number = 2
): Promise<{ data: any; error: any }> {
  let lastError: any = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(500 * Math.pow(2, attempt - 1), 2000);
      console.log(
        `[purchase-with-balance][${requestId}] RPC retry ${attempt}/${maxRetries} after ${delay}ms`
      );
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      const res = await fetch(`${baseUrl}/rest/v1/rpc/purchase_tickets_with_balance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceRoleKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Prefer': 'return=representation',
        },
        body: JSON.stringify(params),
      });

      const text = await res.text();
      let rpcResult;
      
      try {
        rpcResult = JSON.parse(text);
      } catch {
        lastError = { message: 'Invalid JSON response from RPC' };
        console.warn(
          `[purchase-with-balance][${requestId}] RPC attempt ${attempt + 1} returned invalid JSON`
        );
        continue;
      }

      if (res.ok && rpcResult) {
        // If the RPC returned a result, check if it was a success
        if (rpcResult.success) {
          return { data: rpcResult, error: null };
        }

        // RPC returned {success: false} - check the error code
        const code = rpcResult.error_code || '';

        // Validation errors should be returned immediately (no retry)
        if (
          code === 'INSUFFICIENT_BALANCE' ||
          code === 'NO_BALANCE_RECORD' ||
          code === 'VALIDATION_ERROR'
        ) {
          return { data: rpcResult, error: null };
        }

        // INTERNAL_ERROR means a trigger or constraint failed inside the RPC.
        // Retry and eventually fall through to direct DB fallback.
        lastError = {
          message: rpcResult.error || 'RPC internal error',
          code: rpcResult.error_code,
        };
        console.warn(
          `[purchase-with-balance][${requestId}] RPC attempt ${attempt + 1} returned internal error:`,
          rpcResult.error
        );
        continue;
      }

      lastError = { message: text || 'RPC failed', code: 'RPC_ERROR' };
      console.warn(
        `[purchase-with-balance][${requestId}] RPC attempt ${attempt + 1} failed with status ${res.status}`
      );
    } catch (err) {
      lastError = err;
      console.warn(
        `[purchase-with-balance][${requestId}] RPC attempt ${attempt + 1} exception:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return { data: null, error: lastError };
}

// ============================================================================
// Direct Database Fallback (SAFEGUARD 2)
// ============================================================================

async function directDatabaseFallback(
  supabase: any,
  params: {
    canonicalUserId: string;
    competitionId: string;
    ticketPrice: number;
    ticketNumbers: number[];
    idempotencyKey: string;
    reservationId: string | null;
  },
  requestId: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  const { canonicalUserId, competitionId, ticketNumbers, ticketPrice, idempotencyKey } = params;

  console.log(
    `[purchase-with-balance][${requestId}] FALLBACK: Direct DB operations for ${ticketNumbers.length} tickets`
  );

  try {
    // Step 1: Check for idempotent duplicate
    const { data: existingEntry } = await supabase
      .from('joincompetition')
      .select('uid, ticketnumbers, amountspent')
      .eq('competitionid', competitionId)
      .eq('transactionhash', idempotencyKey)
      .limit(1)
      .maybeSingle();

    if (existingEntry) {
      console.log(
        `[purchase-with-balance][${requestId}] FALLBACK: Idempotent hit - already processed`
      );
      const existingTickets = existingEntry.ticketnumbers
        ? existingEntry.ticketnumbers.split(',').map(Number)
        : ticketNumbers;

      // Get current balance
      const { data: balRow } = await supabase
        .from('sub_account_balances')
        .select('available_balance')
        .eq('canonical_user_id', canonicalUserId)
        .eq('currency', 'USD')
        .limit(1)
        .maybeSingle();

      return {
        success: true,
        data: {
          success: true,
          idempotent: true,
          entry_id: existingEntry.uid,
          ticket_numbers: existingTickets,
          ticket_count: existingTickets.length,
          total_cost: existingEntry.amountspent,
          available_balance: balRow?.available_balance ?? 0,
          competition_id: competitionId,
        },
      };
    }

    // Step 2: Get user balance
    const { data: balanceRow, error: balError } = await supabase
      .from('sub_account_balances')
      .select('available_balance, id')
      .eq('canonical_user_id', canonicalUserId)
      .eq('currency', 'USD')
      .limit(1)
      .maybeSingle();

    if (balError || !balanceRow) {
      return { success: false, error: 'User balance not found' };
    }

    const currentBalance = Number(balanceRow.available_balance);
    const totalCost = ticketPrice * ticketNumbers.length;

    if (currentBalance < totalCost) {
      return { success: false, error: 'Insufficient balance' };
    }

    const newBalance = currentBalance - totalCost;

    // Step 3: Deduct balance
    const { error: updateErr } = await supabase
      .from('sub_account_balances')
      .update({
        available_balance: newBalance,
        updated_at: new Date().toISOString(),
      })
      .eq('canonical_user_id', canonicalUserId)
      .eq('currency', 'USD');

    if (updateErr) {
      console.error(
        `[purchase-with-balance][${requestId}] FALLBACK: Balance update failed:`,
        updateErr.message
      );
      return { success: false, error: 'Failed to deduct balance' };
    }

    // Step 4: Create competition entry
    const entryId = crypto.randomUUID();
    const ticketNumbersStr = ticketNumbers.join(',');

    const { error: entryErr } = await supabase
      .from('joincompetition')
      .insert({
        uid: entryId,
        userid: canonicalUserId,
        canonical_user_id: canonicalUserId,
        competitionid: competitionId,
        ticketnumbers: ticketNumbersStr,
        numberoftickets: ticketNumbers.length,
        amountspent: totalCost,
        transactionhash: idempotencyKey,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (entryErr) {
      console.error(
        `[purchase-with-balance][${requestId}] FALLBACK: Entry insert failed:`,
        entryErr.message
      );
      // Refund the balance
      await supabase
        .from('sub_account_balances')
        .update({
          available_balance: currentBalance,
          updated_at: new Date().toISOString(),
        })
        .eq('canonical_user_id', canonicalUserId)
        .eq('currency', 'USD');
      return { success: false, error: 'Failed to create competition entry' };
    }

    console.log(
      `[purchase-with-balance][${requestId}] FALLBACK: Success! ${ticketNumbers.length} tickets`
    );

    return {
      success: true,
      data: {
        success: true,
        entry_id: entryId,
        ticket_numbers: ticketNumbers,
        ticket_count: ticketNumbers.length,
        total_cost: totalCost,
        previous_balance: currentBalance,
        available_balance: newBalance,
        competition_id: competitionId,
        fallback: true,
      },
    };
  } catch (err) {
    console.error(
      `[purchase-with-balance][${requestId}] FALLBACK: Fatal error:`,
      err
    );
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Fallback failed',
    };
  }
}

// ============================================================================
// Main Handler
// ============================================================================

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const corsHeaders = buildCorsHeaders(req.headers.get('origin'));

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Method Not Allowed', 405, corsHeaders);
  }

  // Require authorization header
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    return errorResponse('UNAUTHORIZED', 'Missing authorization header', 401, corsHeaders);
  }

  try {
    // Parse request body
    const body = await req.json();
    const {
      p_user_identifier,
      p_competition_id,
      p_ticket_price,
      p_ticket_count = null,
      p_ticket_numbers = null,
      p_idempotency_key,
      p_reservation_id = null,
    } = body;

    // Validate required parameters
    if (!p_user_identifier || !p_competition_id || typeof p_ticket_price !== 'number') {
      return errorResponse(
        'VALIDATION_ERROR',
        'Missing required parameters: p_user_identifier, p_competition_id, p_ticket_price',
        400,
        corsHeaders
      );
    }

    // Validate ticket parameters
    if (!p_ticket_numbers && !p_ticket_count) {
      return errorResponse(
        'VALIDATION_ERROR',
        'Must provide either p_ticket_numbers or p_ticket_count',
        400,
        corsHeaders
      );
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

    console.log(`[purchase-with-balance][${requestId}] Processing purchase`, {
      userId: p_user_identifier.substring(0, 20) + '...',
      competitionId: p_competition_id.substring(0, 10) + '...',
      ticketCount: p_ticket_numbers?.length || p_ticket_count,
      ticketPrice: p_ticket_price,
      hasReservation: !!p_reservation_id,
    });

    // Attempt RPC with retry
    const { data: rpcResult, error: rpcError } = await callRpcWithRetry(
      baseUrl,
      serviceRoleKey,
      {
        p_user_identifier,
        p_competition_id,
        p_ticket_price,
        p_ticket_count,
        p_ticket_numbers,
        p_idempotency_key,
        p_reservation_id,
      },
      requestId
    );

    let finalResult = rpcResult;

    // If RPC completely failed and we have ticket numbers, try fallback
    if (!finalResult && p_ticket_numbers && Array.isArray(p_ticket_numbers)) {
      console.log(`[purchase-with-balance][${requestId}] RPC failed, attempting fallback`);
      
      const supabase = createClient(baseUrl, serviceRoleKey);
      const fallbackResult = await directDatabaseFallback(
        supabase,
        {
          canonicalUserId: p_user_identifier,
          competitionId: p_competition_id,
          ticketPrice: p_ticket_price,
          ticketNumbers: p_ticket_numbers,
          idempotencyKey: p_idempotency_key,
          reservationId: p_reservation_id,
        },
        requestId
      );

      if (fallbackResult.success) {
        finalResult = fallbackResult.data;
      }
    }

    if (!finalResult) {
      console.error(
        `[purchase-with-balance][${requestId}] No result from any attempt`,
        rpcError
      );
      return errorResponse(
        'RPC_ERROR',
        rpcError?.message || 'No response from purchase function',
        500,
        corsHeaders
      );
    }

    // Handle error responses
    if (!finalResult.success) {
      const errorCode = finalResult.error_code || 'PURCHASE_FAILED';
      const errorMessage = finalResult.error || 'Purchase failed';

      // Map error codes to HTTP status codes
      let httpStatus = 400;
      if (errorCode === 'INSUFFICIENT_BALANCE') httpStatus = 402;
      if (errorCode === 'NO_BALANCE_RECORD') httpStatus = 404;
      if (errorCode === 'NOT_ENOUGH_TICKETS') httpStatus = 409;
      if (errorCode === 'INTERNAL_ERROR') httpStatus = 500;

      return errorResponse(errorCode, errorMessage, httpStatus, corsHeaders);
    }

    // Transform result to match expected format
    const ticketNumbersResult: number[] = finalResult.ticket_numbers || [];
    const responseData = {
      status: 'ok',
      success: true,
      competition_id: finalResult.competition_id || p_competition_id,
      tickets: ticketNumbersResult.map((num: number) => ({
        ticket_number: num,
      })),
      entry_id: finalResult.entry_id,
      total_cost: finalResult.total_cost,
      new_balance: finalResult.available_balance,
      available_balance: finalResult.available_balance,
      previous_balance: finalResult.previous_balance,
      idempotent: finalResult.idempotent || false,
      used_reservation_id: finalResult.used_reservation_id,
      used_reserved_count: finalResult.used_reserved_count,
      topped_up_count: finalResult.topped_up_count,
      note: finalResult.note,
      fallback: finalResult.fallback || false,
      message: `Successfully purchased ${ticketNumbersResult.length} tickets`,
    };

    console.log(
      `[purchase-with-balance][${requestId}] Success: ${ticketNumbersResult.length} tickets purchased`
    );

    return jsonResponse(responseData, 200, corsHeaders);
  } catch (error) {
    console.error(`[purchase-with-balance][${requestId}] Error:`, error);
    return errorResponse(
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Internal server error',
      500,
      corsHeaders
    );
  }
});
