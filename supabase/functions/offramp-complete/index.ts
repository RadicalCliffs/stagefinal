import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { toPrizePid } from "../_shared/userId.ts";

/**
 * Coinbase Offramp Complete Handler
 *
 * This edge function handles the redirect callback when a user completes
 * an offramp transaction via Coinbase. It updates the transaction status
 * and can redirect the user back to the application.
 *
 * Endpoint: https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/offramp-complete
 */

// CORS configuration
const ALLOWED_ORIGINS = [
  'https://vocal-cascaron-bcef9b.netlify.app',
  'https://stage.theprize.io',
  'https://theprize.io',
  'https://www.theprize.io',
  'http://localhost:3000',
  'http://localhost:5173',
];

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey, cache-control, pragma, expires',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

// Default redirect URL - Always redirect to substage.theprize.io/dashboard/entries
const DEFAULT_REDIRECT_URL = 'https://substage.theprize.io/dashboard/entries?status=complete';

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);
  const requestId = crypto.randomUUID().slice(0, 8);

  console.log(`[offramp-complete][${requestId}] Incoming request: method=${req.method}`);

  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    const url = new URL(req.url);

    // Extract query parameters (Coinbase may pass these on redirect)
    const partnerUserRef = url.searchParams.get('partnerUserRef');
    const transactionId = url.searchParams.get('transactionId');
    const payoutId = url.searchParams.get('payoutId');
    const status = url.searchParams.get('status') || 'complete';
    const redirectUrl = url.searchParams.get('redirectUrl');

    const txId = transactionId || payoutId;

    console.log(`[offramp-complete][${requestId}] partnerUserRef=${partnerUserRef}, transactionId=${txId}, status=${status}`);

    // If we have transaction tracking info, update the database
    if (partnerUserRef || txId) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      if (supabaseUrl && supabaseServiceKey) {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Try to find and update the transaction
        if (txId) {
          await supabase
            .from('user_transactions')
            .update({
              status: 'complete',
              payment_status: 'confirmed',
              updated_at: new Date().toISOString(),
            })
            .eq('external_transaction_id', txId);
        } else if (partnerUserRef) {
          // Convert to canonical format for lookup
          const canonicalUserRef = toPrizePid(partnerUserRef);
          console.log(`[offramp-complete][${requestId}] Looking up by partnerUserRef: ${partnerUserRef} -> ${canonicalUserRef}`);

          // Try canonical user_id lookup first
          const { error: canonicalError, count: canonicalCount } = await supabase
            .from('user_transactions')
            .update({
              status: 'complete',
              payment_status: 'confirmed',
              updated_at: new Date().toISOString(),
            })
            .eq('user_id', canonicalUserRef)
            .eq('payment_provider', 'coinbase_offramp')
            .in('status', ['pending', 'processing'])
            .order('created_at', { ascending: false })
            .limit(1);

          // If no rows updated with canonical, try legacy user_privy_id
          if (!canonicalError && (!canonicalCount || canonicalCount === 0)) {
            await supabase
              .from('user_transactions')
              .update({
                status: 'complete',
                payment_status: 'confirmed',
                updated_at: new Date().toISOString(),
              })
              .eq('user_privy_id', partnerUserRef)
              .eq('payment_provider', 'coinbase_offramp')
              .in('status', ['pending', 'processing'])
              .order('created_at', { ascending: false })
              .limit(1);
          }
        }
      }
    }

    // Handle GET requests (redirect callback)
    if (req.method === "GET") {
      const finalRedirectUrl = redirectUrl || DEFAULT_REDIRECT_URL;
      const redirectWithStatus = new URL(finalRedirectUrl);
      redirectWithStatus.searchParams.set('offramp_status', 'complete');

      if (txId) {
        redirectWithStatus.searchParams.set('transaction_id', txId);
      }

      return new Response(null, {
        status: 302,
        headers: {
          ...cors,
          'Location': redirectWithStatus.toString(),
        },
      });
    }

    // Handle POST requests (API callback)
    if (req.method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        body = await req.json();
      } catch {
        // Body may be empty for simple completion calls
      }

      console.log(`[offramp-complete][${requestId}] POST body:`, JSON.stringify(body));

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Offramp completion acknowledged',
          status: 'complete',
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json", ...cors } }
    );
  } catch (error) {
    console.error(`[offramp-complete][${requestId}] Error:`, error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      { status: 500, headers: { "Content-Type": "application/json", ...cors } }
    );
  }
});
