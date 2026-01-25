import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { toPrizePid } from "../_shared/userId.ts";

// CORS configuration - allow all origins since Netlify proxy handles origin validation
// Production calls go through the Netlify proxy function which adds proper CORS headers
const ALLOWED_METHODS = 'GET,POST,PUT,DELETE,OPTIONS';
const ALLOWED_HEADERS = 'authorization,content-type,x-client-info,apikey';
const MAX_AGE = '86400';

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') ?? '*';
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Max-Age': MAX_AGE,
    'Vary': 'Origin',
  };
}

// Coinbase Commerce API base URL
const COINBASE_COMMERCE_API = 'https://api.commerce.coinbase.com';

interface ChargeMetadata {
  user_id: string;
  wallet_address?: string | null;
  competition_id?: string;
  entry_count?: number;
  entry_price?: number;
  reservation_id?: string;
  type: 'entry' | 'topup';
}

interface CreateChargeRequest {
  userId: string;
  competitionId?: string;
  entryPrice?: number;
  entryCount?: number;
  totalAmount?: number;
  amount?: number; // Legacy field name, prefer totalAmount
  selectedTickets?: number[];
  reservationId?: string;
  type: 'entry' | 'topup';
  checkoutUrl?: string;
}

Deno.serve(async (req: Request) => {
  // Compute CORS headers once for this request
  const cors = corsHeaders(req);
  const requestId = crypto.randomUUID().slice(0, 8);
  const startTime = Date.now();

  console.log(`[create-charge][${requestId}] Incoming request: method=${req.method}, origin=${req.headers.get('origin')}`);

  // Handle preflight
  if (req.method === "OPTIONS") {
    console.log(`[create-charge][${requestId}] Responding to OPTIONS preflight`);
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // Support both COINBASE_COMMERCE_API_KEY and COMMERCE_API_KEY for flexibility
    const coinbaseApiKey = Deno.env.get("COINBASE_COMMERCE_API_KEY") || Deno.env.get("COMMERCE_API_KEY");
    const successBaseUrl = Deno.env.get("SUCCESS_URL") || "https://substage.theprize.io";

    console.log(`[create-charge][${requestId}] Config check: supabaseUrl=${!!supabaseUrl}, serviceKey=${!!supabaseServiceKey}, apiKey=${!!coinbaseApiKey}`);

    if (!coinbaseApiKey) {
      console.error(`[create-charge][${requestId}] Missing COINBASE_COMMERCE_API_KEY or COMMERCE_API_KEY environment variable`);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Payment service configuration error - missing API key",
          code: "CONFIG_ERROR",
          hint: "Ensure COINBASE_COMMERCE_API_KEY or COMMERCE_API_KEY is set in Supabase secrets"
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body
    let body: CreateChargeRequest;
    try {
      const rawBody = await req.text();
      console.log(`[create-charge][${requestId}] Raw body length: ${rawBody.length}`);
      body = JSON.parse(rawBody);
    } catch (parseError) {
      console.error(`[create-charge][${requestId}] JSON parse error:`, parseError);
      return new Response(
        JSON.stringify({ success: false, error: "Invalid JSON in request body", code: "VALIDATION_ERROR" }),
        { status: 200, headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    const {
      userId,
      competitionId,
      entryPrice,
      entryCount,
      totalAmount,
      amount, // Legacy field name
      selectedTickets,
      reservationId,
      type,
      checkoutUrl,
    } = body;

    // Support both 'totalAmount' (preferred) and 'amount' (legacy) field names
    const rawAmount = totalAmount ?? amount;

    // Convert userId to canonical format immediately for consistent storage
    const canonicalUserId = toPrizePid(userId);
    console.log(`[create-charge][${requestId}] Parsed request: userId=${userId} -> canonical=${canonicalUserId}, competitionId=${competitionId}, entryCount=${entryCount}, totalAmount=${totalAmount}, amount=${amount}, rawAmount=${rawAmount} (type: ${typeof rawAmount}), type=${type}`);
    
    // Extract wallet address from userId if it's a wallet format
    // This ensures we always have the parent wallet in metadata
    let walletAddress: string | null = null;
    if (userId.startsWith('0x') && userId.length === 42) {
      walletAddress = userId.toLowerCase();
    } else if (userId.startsWith('prize:pid:0x')) {
      walletAddress = userId.substring(10).toLowerCase(); // Remove 'prize:pid:' prefix
    }
    console.log(`[create-charge][${requestId}] Extracted wallet address from userId: ${walletAddress}`);

    // CRITICAL: Ensure user exists in canonical_users before creating transaction
    // This prevents orphaned transactions for users who bypassed the auth modal
    
    // Extract wallet address for fallback lookup
    if (!walletAddress && canonicalUserId.startsWith('prize:pid:0x')) {
      walletAddress = canonicalUserId.substring(10).toLowerCase();
    }
    
    // Step 1: Try to find user by canonical_user_id
    let { data: existingUser } = await supabase
      .from('canonical_users')
      .select('id, canonical_user_id')
      .eq('canonical_user_id', canonicalUserId)
      .maybeSingle();

    // Step 2: If not found by canonical_user_id, try wallet_address (user from signup form)
    if (!existingUser && walletAddress) {
      const { data: userByWallet } = await supabase
        .from('canonical_users')
        .select('id, canonical_user_id')
        .eq('wallet_address', walletAddress)
        .maybeSingle();
      
      if (userByWallet) {
        console.log(`[create-charge][${requestId}] Found user by wallet_address, updating canonical_user_id`);
        // User exists but needs canonical_user_id set - UPDATE, don't create
        await supabase
          .from('canonical_users')
          .update({ canonical_user_id: canonicalUserId })
          .eq('id', userByWallet.id);
        existingUser = userByWallet;
      }
    }

    // Step 3: Only create new user if truly not found anywhere
    if (!existingUser) {
      console.log(`[create-charge][${requestId}] No user found, creating minimal entry`);
      const { error: createUserError } = await supabase.from('canonical_users').insert({
        canonical_user_id: canonicalUserId,
        privy_user_id: walletAddress,
        wallet_address: walletAddress,
        base_wallet_address: walletAddress,
        eth_wallet_address: walletAddress,
        username: walletAddress ? `user_${walletAddress.slice(2, 8)}` : `user_${Date.now()}`,
        usdc_balance: 0,
        has_used_new_user_bonus: false,
        created_at: new Date().toISOString(),
      });
      
      // Error code 23505 = unique_violation (user already exists due to race condition)
      if (createUserError && createUserError.code !== '23505') {
        console.error(`[create-charge][${requestId}] Failed to create user:`, createUserError);
        return new Response(
          JSON.stringify({ success: false, error: "Failed to initialize user account" }),
          { status: 200, headers: { "Content-Type": "application/json", ...cors } }
        );
      }
      console.log(`[create-charge][${requestId}] Created canonical_users entry for ${canonicalUserId}`);
    }

    // Validate required fields
    if (!userId) {
      console.log(`[create-charge][${requestId}] Validation failed: missing userId`);
      return new Response(
        JSON.stringify({ success: false, error: "Missing userId", code: "VALIDATION_ERROR" }),
        { status: 200, headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    // Normalize totalAmount - handle string values that may come from JSON
    // rawAmount supports both 'totalAmount' (preferred) and 'amount' (legacy) field names
    const normalizedAmount = Number(rawAmount);
    if (!normalizedAmount || !Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      console.log(`[create-charge][${requestId}] Validation failed: invalid amount - totalAmount=${totalAmount}, amount=${amount}, rawAmount=${rawAmount} (type: ${typeof rawAmount}), normalized=${normalizedAmount}`);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required fields: amount",
          code: "VALIDATION_ERROR",
          debug: {
            receivedTotalAmount: totalAmount,
            receivedAmount: amount,
            receivedType: typeof rawAmount,
            normalizedValue: normalizedAmount,
            hint: "Provide either 'totalAmount' or 'amount' as a positive number"
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    const isEntry = type === 'entry' && competitionId;

    // Create a transaction record first - use canonical userId
    const transactionId = crypto.randomUUID();
    const webhookRef = isEntry
      ? `COMP_${canonicalUserId}_${competitionId}_${transactionId}`
      : `TOPUP_${canonicalUserId}_${transactionId}`;

    console.log(`[create-charge][${requestId}] Creating transaction: id=${transactionId}, webhookRef=${webhookRef}`);

    // Prepare insert data for logging and insertion
    const transactionData = {
      id: transactionId,
      user_id: canonicalUserId,
      competition_id: isEntry ? competitionId : null,
      amount: normalizedAmount,
      currency: "USD",
      payment_status: "pending",
      status: "pending",
      ticket_count: isEntry ? (entryCount || 1) : 0,
      order_id: reservationId || null,
      webhook_ref: webhookRef,
      payment_provider: "coinbase",
      type: type || 'entry', // Default to 'entry' if not specified for backward compatibility
    };
    console.log(`[create-charge][${requestId}] Transaction data:`, JSON.stringify(transactionData));

    const { error: insertError } = await supabase
      .from("user_transactions")
      .insert(transactionData);

    if (insertError) {
      console.error(`[create-charge][${requestId}] Transaction insert error:`, insertError);
      console.error(`[create-charge][${requestId}] Insert error details: code=${insertError.code}, message=${insertError.message}, hint=${insertError.hint}`);
      // Include more detail for debugging while keeping user-facing message clean
      const errorDetails = [
        insertError.message,
        insertError.code ? `(code: ${insertError.code})` : null,
        insertError.hint ? `Hint: ${insertError.hint}` : null
      ].filter(Boolean).join(' - ');
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to create transaction record",
          code: "DB_ERROR",
          details: errorDetails,
          db_error_code: insertError.code
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    // If a pre-configured checkout URL was provided (for fixed-price products), use it directly
    if (checkoutUrl) {
      console.log(`[create-charge][${requestId}] Using pre-configured checkout URL`);

      // Update transaction with checkout URL
      await supabase
        .from("user_transactions")
        .update({ session_id: checkoutUrl })
        .eq("id", transactionId);

      const elapsed = Date.now() - startTime;
      console.log(`[create-charge][${requestId}] SUCCESS (pre-configured): transaction=${transactionId}, elapsed=${elapsed}ms`);

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            transactionId,
            checkoutUrl,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    // Create a Coinbase Commerce charge
    const chargePayload = {
      name: isEntry
        ? `Competition Entry: ${entryCount} ticket${entryCount !== 1 ? 's' : ''}`
        : `Wallet Top-Up: $${normalizedAmount}`,
      description: isEntry
        ? `Purchase ${entryCount} entry ticket${entryCount !== 1 ? 's' : ''} for competition`
        : `Add $${normalizedAmount} to your wallet balance`,
      pricing_type: "fixed_price",
      local_price: {
        amount: normalizedAmount.toFixed(2),
        currency: "USD",
      },
      metadata: {
        user_id: canonicalUserId,
        wallet_address: walletAddress, // Parent wallet address for smart wallet resolution
        competition_id: competitionId || null,
        entry_count: entryCount || null,
        entry_price: entryPrice || null,
        reservation_id: reservationId || null,
        transaction_id: transactionId,
        type,
        selected_tickets: selectedTickets ? JSON.stringify(selectedTickets) : null,
      } as ChargeMetadata,
      // CRITICAL: Always redirect to /dashboard/entries for ALL payment types (entries and top-ups)
      // This ensures users see their entries immediately after payment completion
      redirect_url: `${successBaseUrl}/dashboard/entries?payment=success&txId=${transactionId}`,
      cancel_url: `${successBaseUrl}/dashboard/entries?payment=cancelled&txId=${transactionId}`,
    };

    console.log(`[create-charge][${requestId}] Creating Coinbase Commerce charge for $${normalizedAmount}`);

    const chargeResponse = await fetch(`${COINBASE_COMMERCE_API}/charges`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CC-Api-Key": coinbaseApiKey,
        "X-CC-Version": "2018-03-22",
      },
      body: JSON.stringify(chargePayload),
    });

    const responseText = await chargeResponse.text();
    console.log(`[create-charge][${requestId}] Coinbase response: status=${chargeResponse.status}, body_length=${responseText.length}`);

    if (!chargeResponse.ok) {
      console.error(`[create-charge][${requestId}] Coinbase Commerce API error:`, chargeResponse.status, responseText.slice(0, 500));

      // Update transaction to failed
      await supabase
        .from("user_transactions")
        .update({ status: "failed", payment_status: "failed" })
        .eq("id", transactionId);

      let errorMessage = "Failed to create payment";
      if (chargeResponse.status === 401) {
        errorMessage = "Payment service authentication failed";
      } else if (chargeResponse.status === 429) {
        errorMessage = "Too many requests. Please try again.";
      } else if (chargeResponse.status >= 500) {
        errorMessage = "Payment service temporarily unavailable";
      }

      return new Response(
        JSON.stringify({ success: false, error: errorMessage, code: "PROVIDER_ERROR", upstream_status: chargeResponse.status }),
        { status: 200, headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    const chargeData = JSON.parse(responseText);
    const charge = chargeData.data;

    console.log(`[create-charge][${requestId}] Charge created: id=${charge.id}, code=${charge.code}, hosted_url=${charge.hosted_url}`);

    // Validate that we received the hosted_url (checkout URL)
    if (!charge.hosted_url) {
      console.error(`[create-charge][${requestId}] WARNING: Coinbase Commerce did not return hosted_url. Charge data:`, JSON.stringify(charge).substring(0, 500));
    }

    // Update transaction with charge info
    const { error: updateError } = await supabase
      .from("user_transactions")
      .update({
        tx_id: charge.id,
        session_id: charge.code,
        payment_status: "waiting",
      })
      .eq("id", transactionId);

    if (updateError) {
      console.error(`[create-charge][${requestId}] Error updating transaction with charge data:`, updateError);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[create-charge][${requestId}] SUCCESS: transaction=${transactionId}, charge=${charge.id}, elapsed=${elapsed}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          transactionId,
          checkoutUrl: charge.hosted_url,
          chargeId: charge.id,
          chargeCode: charge.code,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...cors } }
    );
  } catch (error) {
    console.error(`[create-charge] Unhandled error:`, error);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error", code: "INTERNAL_ERROR", message: (error as Error).message }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders(req) } }
    );
  }
});
