import type { Context, Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { toPrizePid, extractPrizePid, isWalletAddress } from "./_shared/userId.mts";

/**
 * Secure Write Function - Server-side proxy for database writes
 *
 * This function handles all secure database write operations that require
 * bypassing client-side RLS restrictions. It:
 * 1. Validates the user session via Base wallet token or Supabase auth
 * 2. Uses the service role key to perform writes
 * 3. Automatically populates user_id from the authenticated session
 *
 * Routes:
 * - POST /api/secure-write/orders/topup - Create wallet top-up order
 * - POST /api/secure-write/orders/purchase - Create competition ticket order
 * - PATCH /api/secure-write/profile - Update user profile
 * - POST /api/secure-write/competition/join - Join a competition
 */

// Supabase clients will be created per-request to avoid connection issues
function getSupabaseClients() {
  const supabaseUrl = Netlify.env.get("VITE_SUPABASE_URL") || Netlify.env.get("SUPABASE_URL");
  const supabaseAnonKey = Netlify.env.get("VITE_SUPABASE_ANON_KEY") || Netlify.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase configuration");
  }

  if (!supabaseServiceKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY - required for secure writes");
  }

  // Anon client for auth verification
  const anonClient = createClient(supabaseUrl, supabaseAnonKey);

  // Service role client for privileged operations
  const serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return { anonClient, serviceClient };
}

/**
 * Verify wallet address token for Base/CDP authentication.
 * The client sends tokens in format "wallet:0x..." where the address
 * is the user's authenticated Base wallet address.
 */
async function verifyWalletToken(
  token: string,
  serviceClient: ReturnType<typeof createClient>
): Promise<{ userId: string; privyUserId?: string; email?: string } | null> {
  // Check if token is in wallet:address format
  if (!token.startsWith('wallet:')) {
    return null;
  }

  const walletAddress = token.replace('wallet:', '').trim();

  // Validate wallet address format (0x + 40 hex chars)
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    console.error("Invalid wallet address format:", walletAddress);
    return null;
  }

  // Normalize wallet address to lowercase for case-insensitive comparison
  // Ethereum addresses are case-insensitive (checksummed vs non-checksummed)
  const normalizedAddress = walletAddress.toLowerCase();

  // Look up the user by wallet address in canonical_users
  // For Base auth, the wallet address is stored in multiple fields
  // Use ilike for case-insensitive matching (Ethereum addresses can be checksummed or lowercase)
  const { data: userConnection, error } = await serviceClient
    .from("canonical_users")
    .select("id, email, privy_user_id, wallet_address, base_wallet_address")
    .or(`wallet_address.ilike.${normalizedAddress},base_wallet_address.ilike.${normalizedAddress},privy_user_id.ilike.${normalizedAddress}`)
    .maybeSingle();

  if (error) {
    console.error("Error looking up wallet user:", error.message);
    return null;
  }

  if (!userConnection) {
    console.error("Wallet user not found in database:", walletAddress);
    return null;
  }

  console.log("Successfully authenticated via wallet address");
  // Return internal UUID as userId, and wallet address as privyUserId (since it's the primary identifier for Base auth)
  return {
    userId: userConnection.id,
    privyUserId: userConnection.privy_user_id || walletAddress,
    email: userConnection.email
  };
}

// Extract and verify the user from the Authorization header
async function getAuthenticatedUser(
  request: Request,
  anonClient: ReturnType<typeof createClient>,
  serviceClient: ReturnType<typeof createClient>
): Promise<{ userId: string; privyUserId?: string; email?: string } | null> {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader) {
    console.error("No Authorization header present in request");
    return null;
  }

  if (!authHeader.startsWith("Bearer ")) {
    console.error("Authorization header does not start with 'Bearer '");
    return null;
  }

  const token = authHeader.replace("Bearer ", "").trim();

  if (!token || token.length < 10) {
    console.error("Authorization token is empty or too short");
    return null;
  }

  // First, try to verify as a wallet address token (Base/CDP auth)
  // These tokens are in format "wallet:0x..."
  const walletUser = await verifyWalletToken(token, serviceClient);
  if (walletUser) {
    return walletUser;
  }

  // Fallback: try Supabase auth token
  try {
    const {
      data: { user },
      error,
    } = await anonClient.auth.getUser(token);

    if (error || !user) {
      console.error("Auth verification failed:", error?.message || "No user returned");
      return null;
    }

    console.log("Successfully authenticated via Supabase token");
    return { userId: user.id, email: user.email };
  } catch (err) {
    console.error("Auth verification error:", err);
    return null;
  }
}

// Validate UUID format
function isValidUUID(str: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

// CORS headers for browser requests
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

// Response helpers
function jsonResponse(data: object, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function errorResponse(message: string, status: number = 400): Response {
  return jsonResponse({ error: message, ok: false }, status);
}

// Route: Create top-up order
async function handleTopUpOrder(
  body: Record<string, unknown>,
  userId: string,
  serviceClient: ReturnType<typeof createClient>
): Promise<Response> {
  const { amount, payment_method, wallet_address } = body;

  if (typeof amount !== "number" || amount <= 0) {
    return errorResponse("Invalid amount - must be a positive number");
  }

  if (amount > 10000) {
    return errorResponse("Amount exceeds maximum allowed (10000)");
  }

  const { data: order, error } = await serviceClient
    .from("orders")
    .insert({
      user_id: userId,
      competition_id: null,
      ticket_count: 0,
      amount_usd: amount,
      payment_status: "pending",
      payment_method: payment_method || "USDC",
      order_type: "wallet_topup",
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating top-up order:", error);
    return errorResponse(`Failed to create order: ${error.message}`, 500);
  }

  return jsonResponse({ ok: true, order });
}

// Route: Create transaction record for Base CDP payments
async function handleCreateTransaction(
  body: Record<string, unknown>,
  userId: string,
  serviceClient: ReturnType<typeof createClient>
): Promise<Response> {
  const {
    wallet_address,
    competition_id,
    ticket_count,
    amount,
    reservation_id,
    payment_provider, // Allow client to specify: 'privy_base_wallet', 'base-cdp', etc.
    network, // Allow client to specify: 'base', 'base-sepolia', etc.
  } = body;

  if (!wallet_address || typeof wallet_address !== "string") {
    return errorResponse("wallet_address is required");
  }

  if (!competition_id || typeof competition_id !== "string") {
    return errorResponse("competition_id is required");
  }

  if (typeof ticket_count !== "number" || ticket_count <= 0) {
    return errorResponse("Invalid ticket_count - must be a positive number");
  }

  if (typeof amount !== "number" || amount <= 0) {
    return errorResponse("Invalid amount - must be a positive number");
  }

  // Look up the user's privy_user_id and canonical_user_id
  const { data: userData, error: userError } = await serviceClient
    .from("canonical_users")
    .select("privy_user_id, canonical_user_id")
    .eq("id", userId)
    .single();

  if (userError || !userData) {
    console.error("Error looking up user:", userError);
    return errorResponse("User not found", 404);
  }

  const privyUserId = userData.privy_user_id;
  const canonicalUserId = userData.canonical_user_id;

  // Create transaction record in user_transactions
  // Use client-provided payment_provider and network, with sensible defaults
  const finalPaymentProvider = typeof payment_provider === "string" && payment_provider
    ? payment_provider
    : "privy_base_wallet";
  const finalNetwork = typeof network === "string" && network
    ? network
    : "base";

  // CRITICAL: Direct on-chain payments (Base Account, OnchainKit) don't use internal balance
  // Mark them as posted_to_balance=true to skip balance validation triggers
  // These are direct wallet-to-wallet transfers confirmed on-chain
  // 
  // NOTE: Commerce (coinbase_commerce, cdp_commerce) is NOT in this list because:
  // - Commerce is for TOP-UPS only, not direct entry purchases
  // - Top-ups go through create-charge → webhook → credits balance
  // - Users then use that balance to purchase entries
  // - If Commerce somehow appears here, it's an error in the payment flow
  const isExternalPayment = [
    'base_account',        // Base Account SDK - direct on-chain USDC transfer
    'privy_base_wallet',   // Privy Base wallet - direct on-chain transfer
    'base-cdp',            // CDP Base - direct on-chain transfer
    'onchainkit',          // OnchainKit - direct on-chain transfer
    'onchainkit_checkout', // OnchainKit checkout - direct on-chain transfer
  ].includes(finalPaymentProvider);

  // For external payments, we need to set balance_before and balance_after
  // to satisfy the user_tx_posted_balance_chk constraint
  // Since external payments don't affect internal balance, both values are the current balance
  let currentBalance = 0;
  if (isExternalPayment) {
    if (!canonicalUserId) {
      console.warn("[secure-write] External payment attempted without canonical_user_id, balance will be set to 0");
    } else {
      const { data: balanceData, error: balanceError } = await serviceClient
        .from("sub_account_balances")
        .select("available_balance")
        .eq("canonical_user_id", canonicalUserId)
        .eq("currency", "USD")
        .maybeSingle();
      
      if (balanceError) {
        console.error("[secure-write] Error querying balance:", balanceError.message);
        // Continue with currentBalance = 0 as fallback
      } else if (balanceData) {
        currentBalance = balanceData.available_balance || 0;
      }
    }
  }

  // Build the transaction data
  const transactionData: Record<string, unknown> = {
    user_id: privyUserId,
    canonical_user_id: canonicalUserId,
    wallet_address,
    competition_id,
    ticket_count,
    amount,
    currency: "USDC",
    network: finalNetwork,
    payment_provider: finalPaymentProvider,
    status: "pending",
    payment_status: "pending",
    type: "entry", // This route is for entry purchases (competition_id is required)
    posted_to_balance: isExternalPayment, // Skip balance triggers for external payments
    created_at: new Date().toISOString(),
  };

  // For external payments, set balance_before and balance_after to current balance
  // since these payments don't affect the internal balance
  if (isExternalPayment) {
    transactionData.balance_before = currentBalance;
    transactionData.balance_after = currentBalance;
  }

  let transaction: { id: string } | null = null;
  let txError: Error | { message: string } | null = null;

  // Try to insert with network column first
  const result1 = await serviceClient
    .from("user_transactions")
    .insert(transactionData)
    .select("id")
    .single();

  if (result1.error) {
    // Check if the error is specifically about the network column not existing
    const errorMsg = result1.error.message || "";
    if (errorMsg.includes("network") && (errorMsg.includes("schema cache") || errorMsg.includes("column"))) {
      console.warn("[secure-write] 'network' column issue detected, retrying without network field");
      // Remove network from the data and retry
      const { network: _, ...transactionDataWithoutNetwork } = transactionData;
      const result2 = await serviceClient
        .from("user_transactions")
        .insert(transactionDataWithoutNetwork)
        .select("id")
        .single();

      if (result2.error) {
        txError = result2.error;
      } else {
        transaction = result2.data;
      }
    } else {
      txError = result1.error;
    }
  } else {
    transaction = result1.data;
  }

  if (txError || !transaction) {
    console.error("Error creating transaction:", txError);
    return errorResponse(`Failed to create transaction: ${txError?.message || 'Unknown error'}`, 500);
  }

  // Link the reservation if provided
  if (reservation_id && typeof reservation_id === "string") {
    await serviceClient
      .from("pending_tickets")
      .update({ session_id: transaction.id })
      .eq("id", reservation_id);
  }

  return jsonResponse({
    ok: true,
    transactionId: transaction.id,
    totalAmount: amount,
  });
}

// Route: Create purchase order
async function handlePurchaseOrder(
  body: Record<string, unknown>,
  userId: string,
  serviceClient: ReturnType<typeof createClient>
): Promise<Response> {
  const {
    competition_id,
    ticket_count,
    amount_usd,
    payment_method,
    selected_tickets,
  } = body;

  if (!competition_id || typeof competition_id !== "string") {
    return errorResponse("competition_id is required");
  }

  if (!isValidUUID(competition_id)) {
    return errorResponse("Invalid competition_id format - must be a valid UUID");
  }

  if (typeof ticket_count !== "number" || ticket_count <= 0) {
    return errorResponse("Invalid ticket_count - must be a positive number");
  }

  if (typeof amount_usd !== "number" || amount_usd <= 0) {
    return errorResponse("Invalid amount_usd - must be a positive number");
  }

  // Create order with service role (bypasses RLS)
  const { data: order, error: orderError } = await serviceClient
    .from("orders")
    .insert({
      user_id: userId, // Auto-populated from authenticated session
      competition_id,
      ticket_count,
      amount_usd,
      payment_status: "pending",
      payment_method: payment_method || "USDC",
    })
    .select()
    .single();

  if (orderError) {
    console.error("Error creating order:", orderError);
    return errorResponse(`Failed to create order: ${orderError.message}`, 500);
  }

  // Store selected tickets if provided
  if (Array.isArray(selected_tickets) && selected_tickets.length > 0) {
    const ticketRecords = selected_tickets.map((ticketNumber: number) => ({
      order_id: order.id,
      ticket_number: ticketNumber,
    }));

    const { error: ticketsError } = await serviceClient
      .from("order_tickets")
      .insert(ticketRecords);

    if (ticketsError) {
      console.error("Error storing ticket selections:", ticketsError);
      // Non-fatal - order was created successfully
    }
  }

  return jsonResponse({ ok: true, order });
}

// Route: Update user profile
async function handleProfileUpdate(
  body: Record<string, unknown>,
  userId: string,
  serviceClient: ReturnType<typeof createClient>
): Promise<Response> {
  // Whitelist of allowed profile fields
  const allowedFields = [
    "username",
    "email",
    "telegram_handle",
    "telephone_number",
    "avatar_url",
    "country",
  ];

  const updates: Record<string, unknown> = {};

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates[field] = body[field];
    }
  }

  if (Object.keys(updates).length === 0) {
    return errorResponse("No valid fields to update");
  }

  updates["updated_at"] = new Date().toISOString();

  // Update profile in canonical_users table
  // userId can be: wallet address (0x...), internal UUID, or Privy DID
  // We need to query using multiple conditions to find the right user
  const isWalletAddress = userId.startsWith('0x') && userId.length === 42;
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);

  let query;
  if (isWalletAddress) {
    // For wallet addresses, query by wallet_address or base_wallet_address (PRIMARY for Base auth)
    // Use ilike for case-insensitive matching (Ethereum addresses can be checksummed or lowercase)
    const normalizedAddress = userId.toLowerCase();
    query = serviceClient
      .from("canonical_users")
      .update(updates)
      .or(`wallet_address.ilike.${normalizedAddress},base_wallet_address.ilike.${normalizedAddress},privy_user_id.ilike.${normalizedAddress}`)
      .select();
  } else if (isUUID) {
    // For UUIDs, query by internal id
    query = serviceClient
      .from("canonical_users")
      .update(updates)
      .eq("id", userId)
      .select();
  } else {
    // For Privy DIDs or other identifiers, query by privy_user_id
    query = serviceClient
      .from("canonical_users")
      .update(updates)
      .eq("privy_user_id", userId)
      .select();
  }

  const { data: profile, error } = await query;

  if (error) {
    console.error("Error updating profile:", error);
    return errorResponse(`Failed to update profile: ${error.message}`, 500);
  }

  // Check if any records were updated
  if (!profile || (Array.isArray(profile) && profile.length === 0)) {
    console.error("No profile found for userId:", userId);
    return errorResponse("Profile not found for this user", 404);
  }

  // Return the first (or only) updated profile
  const updatedProfile = Array.isArray(profile) ? profile[0] : profile;
  return jsonResponse({ ok: true, profile: updatedProfile });
}

// Route: Join competition
async function handleJoinCompetition(
  body: Record<string, unknown>,
  userId: string,
  privyUserId: string | undefined,
  serviceClient: ReturnType<typeof createClient>
): Promise<Response> {
  const {
    competition_id,
    number_of_tickets,
    ticket_numbers,
    amount_spent,
    wallet_address,
  } = body;

  if (!competition_id || typeof competition_id !== "string") {
    return errorResponse("competition_id is required");
  }

  if (!isValidUUID(competition_id)) {
    return errorResponse("Invalid competition_id format - must be a valid UUID");
  }

  if (typeof number_of_tickets !== "number" || number_of_tickets <= 0) {
    return errorResponse("Invalid number_of_tickets");
  }

  // Create competition entry with both userid and privy_user_id
  // privy_user_id is the PRIMARY identifier (how users login via Privy/Base)
  const { data: entry, error } = await serviceClient
    .from("joincompetition")
    .insert({
      competitionid: competition_id,
      userid: userId,
      privy_user_id: privyUserId || userId, // Privy ID is primary; fall back to userId if not available
      numberoftickets: number_of_tickets,
      ticketnumbers: ticket_numbers || [],
      amountspent: amount_spent || 0,
      walletaddress: wallet_address || null,
      purchasedate: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error("Error joining competition:", error);
    return errorResponse(`Failed to join competition: ${error.message}`, 500);
  }

  return jsonResponse({ ok: true, entry });
}

// Helper to normalize user IDs to canonical prize:pid format
function normalizeUserIdToCanonical(userId: string | null | undefined): string {
  if (!userId) return '';
  return toPrizePid(userId);
}

// Route: Get unavailable tickets (sold + pending reservations)
// This replaces the RPC function that requires Supabase CLI to create
async function handleGetUnavailableTickets(
  body: Record<string, unknown>,
  serviceClient: ReturnType<typeof createClient>
): Promise<Response> {
  const { competition_id, exclude_user_id } = body;

  if (!competition_id || typeof competition_id !== "string") {
    return errorResponse("competition_id is required");
  }

  // Validate UUID format
  if (!isValidUUID(competition_id)) {
    return errorResponse("Invalid competition_id format - must be a valid UUID");
  }

  // Normalize exclude_user_id to canonical format for case-insensitive comparison
  const canonicalExcludeUserId = exclude_user_id ? toPrizePid(exclude_user_id as string) : '';

  try {
    const unavailableSet = new Set<number>();

    // First, get the competition's legacy uid for fallback queries
    // joincompetition.competitionid may contain either id (UUID) or uid (legacy text)
    const { data: competition } = await serviceClient
      .from("competitions")
      .select("id, uid")
      .eq("id", competition_id)
      .maybeSingle();

    const competitionUid = competition?.uid || competition_id;

    // Step 1: Get pending (reserved but not yet paid) tickets
    // Filter by status to only get active reservations, and exclude expired ones
    const { data: pendingData, error: pendingError } = await serviceClient
      .from("pending_tickets")
      .select("ticket_numbers, user_id, expires_at")
      .eq("competition_id", competition_id)
      .in("status", ["pending", "confirming"]);

    if (pendingError) {
      console.error("Error fetching pending tickets:", pendingError);
      // Don't fail completely - we can still try to get sold tickets
    } else if (pendingData) {
      const now = new Date();
      pendingData.forEach((row: { ticket_numbers: number[]; user_id: string; expires_at: string }) => {
        // Optionally exclude the requesting user's own reservations
        // Use canonical format for consistent comparison
        const canonicalRowUserId = toPrizePid(row.user_id);
        if (canonicalExcludeUserId && canonicalRowUserId === canonicalExcludeUserId) {
          return;
        }
        // Skip expired reservations (they'll be cleaned up by a scheduled job)
        if (row.expires_at && new Date(row.expires_at) < now) {
          return;
        }
        if (Array.isArray(row.ticket_numbers)) {
          row.ticket_numbers.forEach((n: number) => {
            if (Number.isFinite(n)) unavailableSet.add(n);
          });
        }
      });
    }

    // Step 2: Get sold tickets from joincompetition
    // CRITICAL: joincompetition.competitionid is a TEXT field that may contain either:
    // - The competition.id (UUID) for newer entries
    // - The competition.uid (legacy text) for older entries
    // We must check BOTH to get accurate sold ticket counts
    const { data: soldData, error: soldError } = await serviceClient
      .from("joincompetition")
      .select("ticketnumbers, userid")
      .or(`competitionid.eq.${competition_id},competitionid.eq.${competitionUid}`);

    if (soldError) {
      console.error("Error fetching sold tickets:", soldError);
      // Don't fail completely
    } else if (soldData) {
      soldData.forEach((row: { ticketnumbers: string | null; userid: string }) => {
        // ticketnumbers is stored as comma-separated string
        const nums = String(row.ticketnumbers || "")
          .split(",")
          .map((x: string) => parseInt(x.trim(), 10))
          .filter((n: number) => Number.isFinite(n) && n > 0);
        nums.forEach((n: number) => unavailableSet.add(n));
      });
    }

    const unavailableTickets = Array.from(unavailableSet).sort((a, b) => a - b);

    return jsonResponse({
      ok: true,
      unavailableTickets,
      count: unavailableTickets.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error getting unavailable tickets:", error);
    return errorResponse(
      `Failed to get unavailable tickets: ${error instanceof Error ? error.message : String(error)}`,
      500
    );
  }
}

// Route: Reserve tickets atomically
// This replaces the reserve_tickets_atomically RPC function
async function handleReserveTickets(
  body: Record<string, unknown>,
  userId: string,
  serviceClient: ReturnType<typeof createClient>
): Promise<Response> {
  const {
    competition_id,
    selected_tickets,
    ticket_price,
    session_id
  } = body;

  if (!competition_id || typeof competition_id !== "string") {
    return errorResponse("competition_id is required");
  }

  if (!isValidUUID(competition_id)) {
    return errorResponse("Invalid competition_id format - must be a valid UUID");
  }

  if (!Array.isArray(selected_tickets) || selected_tickets.length === 0) {
    return errorResponse("selected_tickets array is required and must not be empty");
  }

  // Validate all tickets are positive integers
  const invalidTickets = selected_tickets.filter(
    (t) => typeof t !== "number" || !Number.isInteger(t) || t < 1
  );
  if (invalidTickets.length > 0) {
    return errorResponse(`Invalid ticket numbers: ${invalidTickets.join(", ")}`);
  }

  // Will fetch from competition below

  try {
    // Step 1: Verify competition exists and is active
    // Fetch both id (UUID) and uid (legacy text) since joincompetition.competitionid
    // may contain either field depending on when the entry was created
    const { data: competition, error: compError } = await serviceClient
      .from("competitions")
      .select("id, uid, status, total_tickets, end_date, ticket_price")
      .eq("id", competition_id)
      .single();

    // DEBUG: Log competition query results to diagnose schema mismatches
    console.log(`[reserve-tickets] Competition row:`, competition);
    console.log(`[reserve-tickets] Competition error:`, compError);

    if (compError || !competition) {
      console.error("Competition lookup error:", compError);
      return errorResponse("Competition not found", 404);
    }

    if (competition.status !== "live" && competition.status !== "active") {
      return errorResponse("Competition is not currently active", 400);
    }

    // Check if competition has ended - fail loudly on invalid date
    if (competition.end_date) {
      const endDate = new Date(competition.end_date);
      if (isNaN(endDate.getTime())) {
        console.error(`Invalid end_date format:`, competition.end_date);
        return errorResponse("Competition configuration error: invalid end_date", 500);
      }
      if (endDate < new Date()) {
        return errorResponse("Competition has ended", 400);
      }
    }

    // Fail loudly if total_tickets is missing or invalid - don't silently default to 1000
    if (typeof competition.total_tickets !== "number" || !Number.isFinite(competition.total_tickets) || competition.total_tickets <= 0) {
      console.error(`Missing or invalid total_tickets on competition row:`, competition);
      return jsonResponse({
        ok: false,
        error: "Competition configuration error: total_tickets missing or invalid",
        retryable: false
      }, 500);
    }
    const maxTicket = competition.total_tickets;

    // Use ticket_price from competition if available, otherwise use provided ticket_price or default to 1
    const competitionTicketPrice = competition.ticket_price;
    const validTicketPrice = typeof ticket_price === "number" && ticket_price > 0 
      ? ticket_price 
      : (typeof competitionTicketPrice === "number" && competitionTicketPrice > 0 ? competitionTicketPrice : 1);
    const outOfRange = selected_tickets.filter((t: number) => t > maxTicket);
    if (outOfRange.length > 0) {
      return errorResponse(`Tickets out of range (max ${maxTicket}): ${outOfRange.join(", ")}`, 400);
    }

    // Step 2: Get currently unavailable tickets
    const unavailableSet = new Set<number>();
    const now = new Date();

    // Convert userId to canonical format for consistent comparison
    const canonicalUserId = toPrizePid(userId);

    // Get pending tickets
    const { data: pendingData } = await serviceClient
      .from("pending_tickets")
      .select("ticket_numbers, user_id, expires_at")
      .eq("competition_id", competition_id)
      .in("status", ["pending", "confirming"]);

    if (pendingData) {
      pendingData.forEach((row: { ticket_numbers: number[]; user_id: string; expires_at: string }) => {
        // Convert row user_id to canonical format for consistent comparison
        const canonicalRowUserId = toPrizePid(row.user_id);

        // Exclude the current user's own expired reservations
        if (canonicalRowUserId === canonicalUserId && row.expires_at && new Date(row.expires_at) < now) {
          return;
        }
        // Include other users' pending tickets
        if (canonicalRowUserId !== canonicalUserId && Array.isArray(row.ticket_numbers)) {
          row.ticket_numbers.forEach((n: number) => {
            if (Number.isFinite(n)) unavailableSet.add(n);
          });
        }
      });
    }

    // Get sold tickets
    // CRITICAL: joincompetition.competitionid is a TEXT field that may contain either:
    // - The competition.id (UUID) for newer entries
    // - The competition.uid (legacy text) for older entries
    // We must check BOTH to get accurate sold ticket counts
    const competitionUid = competition.uid || competition_id;
    const { data: soldData } = await serviceClient
      .from("joincompetition")
      .select("ticketnumbers")
      .or(`competitionid.eq.${competition_id},competitionid.eq.${competitionUid}`);

    if (soldData) {
      soldData.forEach((row: { ticketnumbers: string | null }) => {
        const nums = String(row.ticketnumbers || "")
          .split(",")
          .map((x: string) => parseInt(x.trim(), 10))
          .filter((n: number) => Number.isFinite(n) && n > 0);
        nums.forEach((n: number) => unavailableSet.add(n));
      });
    }

    // Step 3: Check if requested tickets are available
    const conflictingTickets = selected_tickets.filter((t: number) => unavailableSet.has(t));
    if (conflictingTickets.length > 0) {
      return jsonResponse({
        ok: false,
        error: "Some selected tickets are no longer available",
        unavailableTickets: conflictingTickets,
        retryable: true
      }, 409);
    }

    // Step 4: Create reservation
    const reservationId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
    const totalAmount = validTicketPrice * selected_tickets.length;

    // Use canonical userId for consistent storage
    // This ensures consistent lookup regardless of original input format

    const { data: reservation, error: insertError } = await serviceClient
      .from("pending_tickets")
      .insert({
        id: reservationId,
        user_id: canonicalUserId,
        competition_id,
        ticket_numbers: selected_tickets,
        ticket_count: selected_tickets.length,
        ticket_price: validTicketPrice,
        total_amount: totalAmount,
        status: "pending",
        expires_at: expiresAt.toISOString(),
        session_id: typeof session_id === "string" ? session_id : null,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error creating reservation:", insertError);

      // Check for unique constraint violation (race condition)
      if (insertError.code === "23505") {
        return jsonResponse({
          ok: false,
          error: "Some tickets were reserved by another user. Please try again.",
          retryable: true
        }, 409);
      }

      return errorResponse(`Failed to create reservation: ${insertError.message}`, 500);
    }

    console.log(`Reservation created: ${reservationId} for ${selected_tickets.length} tickets`);

    return jsonResponse({
      ok: true,
      reservationId,
      ticketNumbers: selected_tickets,
      ticketCount: selected_tickets.length,
      totalAmount,
      expiresAt: expiresAt.toISOString(),
      message: `Successfully reserved ${selected_tickets.length} tickets. Complete payment within 15 minutes.`
    });
  } catch (error) {
    console.error("Error reserving tickets:", error);
    return errorResponse(
      `Failed to reserve tickets: ${error instanceof Error ? error.message : String(error)}`,
      500
    );
  }
}

// Main handler
export default async (req: Request, context: Context): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  // Only allow POST and PATCH methods
  if (req.method !== "POST" && req.method !== "PATCH") {
    return errorResponse("Method not allowed", 405);
  }

  // Parse the route from the URL
  const url = new URL(req.url);
  const pathParts = url.pathname.replace("/api/secure-write", "").split("/").filter(Boolean);
  const route = pathParts.join("/");

  try {
    const { anonClient, serviceClient } = getSupabaseClients();

    // Parse request body first (needed for some public routes)
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON body");
    }

    // Handle public routes that don't require authentication
    // tickets/unavailable is public because users need to see available tickets before login
    if (route === "tickets/unavailable") {
      return handleGetUnavailableTickets(body, serviceClient);
    }

    // Verify authentication for all other routes
    const authUser = await getAuthenticatedUser(req, anonClient, serviceClient);

    if (!authUser) {
      const authHeader = req.headers.get("Authorization");
      const hasHeader = !!authHeader;
      const hasBearerPrefix = authHeader?.startsWith("Bearer ") ?? false;
      console.error(`Auth failed - header present: ${hasHeader}, has Bearer prefix: ${hasBearerPrefix}`);
      return errorResponse(
        "Unauthorized - valid Bearer token required. Ensure you pass Authorization: Bearer <token> header with a valid wallet or Supabase JWT.",
        401
      );
    }

    // Route to appropriate handler
    switch (route) {
      case "orders/topup":
        return handleTopUpOrder(body, authUser.userId, serviceClient);

      case "orders/purchase":
        return handlePurchaseOrder(body, authUser.userId, serviceClient);

      case "transactions/create":
        return handleCreateTransaction(body, authUser.userId, serviceClient);

      case "profile":
        return handleProfileUpdate(body, authUser.userId, serviceClient);

      case "competition/join":
        return handleJoinCompetition(body, authUser.userId, authUser.privyUserId, serviceClient);

      case "tickets/reserve":
        return handleReserveTickets(body, authUser.userId, serviceClient);

      default:
        return errorResponse(`Unknown route: ${route}`, 404);
    }
  } catch (err) {
    console.error("Secure write error:", err);
    return errorResponse(
      err instanceof Error ? err.message : "Internal server error",
      500
    );
  }
};

export const config: Config = {
  path: "/api/secure-write/*",
};
