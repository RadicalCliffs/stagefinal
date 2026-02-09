import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Coinbase Onramp Cancel Handler
 *
 * This edge function handles the redirect callback when a user cancels
 * an onramp transaction via Coinbase. It updates the transaction status
 * and redirects the user back to the application.
 *
 * Endpoint: https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/onramp-cancel
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
const DEFAULT_REDIRECT_URL = 'https://substage.theprize.io/dashboard/entries?status=cancelled';

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);
  const requestId = crypto.randomUUID().slice(0, 8);

  console.log(`[onramp-cancel][${requestId}] Incoming request: method=${req.method}`);

  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200,  // Use 200 instead of 204 for better compatibility headers: cors });
  }

  try {
    const url = new URL(req.url);

    // Extract query parameters
    const partnerUserRef = url.searchParams.get('partnerUserRef');
    const transactionId = url.searchParams.get('transactionId');
    const reason = url.searchParams.get('reason') || 'user_cancelled';
    const redirectUrl = url.searchParams.get('redirectUrl');

    console.log(`[onramp-cancel][${requestId}] partnerUserRef=${partnerUserRef}, transactionId=${transactionId}, reason=${reason}`);

    // If we have transaction tracking info, update the database
    if (partnerUserRef || transactionId) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      if (supabaseUrl && supabaseServiceKey) {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Try to find and update the transaction
        if (transactionId) {
          await supabase
            .from('user_transactions')
            .update({
              status: 'cancelled',
              payment_status: 'cancelled',
              metadata: { cancel_reason: reason },
              updated_at: new Date().toISOString(),
            })
            .eq('id', transactionId);
        } else if (partnerUserRef) {
          // If we only have partnerUserRef, try to find the latest pending transaction
          // IMPORTANT: partnerUserRef could be a Privy user ID, wallet address, or email-derived value
          // We should match against multiple identifier fields to find the right user
          // First try to find user by privy_user_id, then by looking up via wallet address
          const { data: txByPrivyId } = await supabase
            .from('user_transactions')
            .select('id')
            .eq('user_privy_id', partnerUserRef)
            .eq('payment_provider', 'coinbase_onramp')
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (txByPrivyId) {
            // Found transaction by privy_user_id match
            await supabase
              .from('user_transactions')
              .update({
                status: 'cancelled',
                payment_status: 'cancelled',
                metadata: { cancel_reason: reason },
                updated_at: new Date().toISOString(),
              })
              .eq('id', txByPrivyId.id);
          } else {
            // Try to find user by wallet address in canonical_users, then find their transaction
            const { data: userData } = await supabase
              .from('canonical_users')
              .select('privy_user_id')
              .eq('wallet_address', partnerUserRef)
              .maybeSingle();

            if (userData?.privy_user_id) {
              await supabase
                .from('user_transactions')
                .update({
                  status: 'cancelled',
                  payment_status: 'cancelled',
                  metadata: { cancel_reason: reason },
                  updated_at: new Date().toISOString(),
                })
                .eq('user_privy_id', userData.privy_user_id)
                .eq('payment_provider', 'coinbase_onramp')
                .eq('status', 'pending')
                .order('created_at', { ascending: false })
                .limit(1);
            } else {
              console.warn(`[onramp-cancel][${requestId}] Could not find user for partnerUserRef: ${partnerUserRef}`);
            }
          }
        }
      }
    }

    // Handle GET requests (redirect callback)
    if (req.method === "GET") {
      const finalRedirectUrl = redirectUrl || DEFAULT_REDIRECT_URL;
      const redirectWithStatus = new URL(finalRedirectUrl);
      redirectWithStatus.searchParams.set('onramp_status', 'cancelled');
      redirectWithStatus.searchParams.set('reason', reason);

      if (transactionId) {
        redirectWithStatus.searchParams.set('transaction_id', transactionId);
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
        // Body may be empty
      }

      console.log(`[onramp-cancel][${requestId}] POST body:`, JSON.stringify(body));

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Onramp cancellation acknowledged',
          status: 'cancelled',
          reason,
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json", ...cors } }
    );
  } catch (error) {
    console.error(`[onramp-cancel][${requestId}] Error:`, error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      { status: 500, headers: { "Content-Type": "application/json", ...cors } }
    );
  }
});
