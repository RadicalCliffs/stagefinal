import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { toPrizePid, isPrizePid, normalizeWalletAddress } from "../_shared/userId.ts";

// Inlined CORS configuration (bundler doesn't support shared module imports)
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

function handleCorsOptions(req: Request): Response {
  const origin = req.headers.get('origin');
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(origin),
  });
}

// Inlined ticket assignment helpers (bundler doesn't support shared module imports)
interface AssignTicketsParams {
  supabase: SupabaseClient;
  userIdentifier: string;
  privyUserId?: string;
  competitionId: string;
  orderId?: string | null;
  ticketCount: number;
  preferredTicketNumbers?: number[];
}

interface AssignTicketsResult {
  ticketNumbers: number[];
}

function pickRandomUnique<T>(arr: T[], count: number): T[] {
  const result: T[] = [];
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  for (let i = 0; i < count && i < copy.length; i++) {
    result.push(copy[i]);
  }
  return result;
}

async function assignTickets(params: AssignTicketsParams): Promise<AssignTicketsResult> {
  const { supabase, competitionId, orderId, ticketCount, preferredTicketNumbers } = params;
  const userIdentifier = params.userIdentifier || params.privyUserId;

  if (!userIdentifier) throw new Error("assignTickets: userIdentifier (wallet address or privy_user_id) is required");
  if (!competitionId) throw new Error("assignTickets: competitionId is required");
  if (!Number.isFinite(ticketCount) || ticketCount <= 0) throw new Error("assignTickets: ticketCount must be > 0");

  if (orderId) {
    const { data: existingOrderTickets, error: existingOrderTicketsError } = await supabase
      .from("tickets")
      .select("ticket_number")
      .eq("order_id", orderId);

    if (existingOrderTicketsError) {
      console.error("assignTickets: error reading existing order tickets", existingOrderTicketsError);
    } else if (existingOrderTickets && existingOrderTickets.length > 0) {
      return { ticketNumbers: existingOrderTickets.map((t: any) => Number(t.ticket_number)) };
    }
  }

  const { data: competition, error: competitionError } = await supabase
    .from("competitions")
    .select("total_tickets, status")
    .eq("id", competitionId)
    .maybeSingle();

  if (competitionError) {
    console.warn("assignTickets: unable to read competition", competitionError);
    throw new Error("assignTickets: competition not found or error reading competition");
  }

  if (competition?.status && competition.status !== "active") {
    throw new Error(`assignTickets: competition is not active (status: ${competition.status})`);
  }

  const maxTickets = Number(competition?.total_tickets) || 0;
  if (maxTickets === 0) {
    throw new Error("assignTickets: competition has no tickets configured");
  }

  const { data: usedTickets, error: usedError } = await supabase
    .from("tickets")
    .select("ticket_number")
    .eq("competition_id", competitionId);

  if (usedError) {
    console.error("assignTickets: error reading used tickets", usedError);
    throw usedError;
  }

  const usedSet = new Set<number>((usedTickets || []).map((t: any) => Number(t.ticket_number)));

  const availableCount = maxTickets - usedSet.size;
  if (availableCount <= 0) {
    throw new Error("assignTickets: competition is sold out - no tickets available");
  }

  if (ticketCount > availableCount) {
    throw new Error(`assignTickets: cannot allocate ${ticketCount} tickets, only ${availableCount} available`);
  }

  let finalTicketNumbers: number[] = [];
  const preferred: number[] = Array.isArray(preferredTicketNumbers)
    ? preferredTicketNumbers.map(n => Number(n)).filter(n => Number.isFinite(n) && n >= 1 && n <= maxTickets)
    : [];

  for (const n of preferred) {
    if (!usedSet.has(n)) {
      finalTicketNumbers.push(n);
      usedSet.add(n);
      if (finalTicketNumbers.length >= ticketCount) break;
    }
  }

  const remainingCount = ticketCount - finalTicketNumbers.length;
  if (remainingCount > 0) {
    const available: number[] = [];
    for (let n = 1; n <= maxTickets; n++) {
      if (!usedSet.has(n)) available.push(n);
      if (available.length >= remainingCount * 5) break;
    }

    if (available.length < remainingCount) {
      throw new Error(`assignTickets: not enough available tickets - need ${remainingCount}, found ${available.length}`);
    }

    const picked = pickRandomUnique(available, remainingCount);
    finalTicketNumbers.push(...picked);
  }

  const maxRetries = 3;
  let successfullyInserted: number[] = [];
  let remainingToInsert = [...finalTicketNumbers];

  for (let attempt = 0; attempt < maxRetries && remainingToInsert.length > 0; attempt++) {
    const rows = remainingToInsert.map(num => ({
      competition_id: competitionId,
      order_id: orderId ?? null,
      ticket_number: num,
      user_id: userIdentifier,
    }));

    const { error: insertError } = await supabase.from("tickets").insert(rows);

    if (!insertError) {
      successfullyInserted.push(...remainingToInsert);
      remainingToInsert = [];
      break;
    }

    const isConflictError = insertError.code === '23505' ||
      insertError.message?.includes('unique') ||
      insertError.message?.includes('duplicate');

    if (!isConflictError) {
      console.error("assignTickets: error inserting tickets", insertError);
      throw insertError;
    }

    console.warn(`assignTickets: conflict on attempt ${attempt + 1}, retrying with fresh ticket selection`);

    const { data: currentUsedTickets, error: refetchError } = await supabase
      .from("tickets")
      .select("ticket_number")
      .eq("competition_id", competitionId);

    if (refetchError) {
      console.error("assignTickets: error re-fetching used tickets", refetchError);
      throw refetchError;
    }

    const currentUsedSet = new Set<number>((currentUsedTickets || []).map((t: any) => Number(t.ticket_number)));

    const currentAvailable = maxTickets - currentUsedSet.size;
    if (currentAvailable < remainingToInsert.length) {
      throw new Error(`assignTickets: competition became sold out during allocation - only ${currentAvailable} tickets remain`);
    }

    const stillAvailable = remainingToInsert.filter(n => !currentUsedSet.has(n));
    const needToReplace = remainingToInsert.length - stillAvailable.length;

    const newAvailable: number[] = [];
    for (let n = 1; n <= maxTickets && newAvailable.length < needToReplace * 5; n++) {
      if (!currentUsedSet.has(n) && !stillAvailable.includes(n)) {
        newAvailable.push(n);
      }
    }

    if (newAvailable.length < needToReplace) {
      throw new Error("assignTickets: not enough available tickets remain after conflict resolution");
    }

    const replacements = pickRandomUnique(newAvailable, needToReplace);
    remainingToInsert = [...stillAvailable, ...replacements];
    finalTicketNumbers = [...successfullyInserted, ...remainingToInsert];
  }

  if (remainingToInsert.length > 0) {
    throw new Error("assignTickets: failed to insert tickets after multiple retries");
  }

  return { ticketNumbers: finalTicketNumbers };
}

/**
 * Check if a string is a valid Ethereum wallet address
 */
function isWalletAddress(identifier: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/i.test(identifier);
}

/**
 * Check if a string is a valid UUID v4
 * Returns false for placeholder values like 'pending'
 */
function isValidUUID(str: string | null | undefined): boolean {
  if (!str || typeof str !== 'string') return false;
  // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Tolerant parameter parser for purchase-tickets-with-bonus
 *
 * FRONTEND IDENTITY FIELDS CURRENTLY SENT:
 * - userId: primary identifier (wallet address like "0x..." or legacy privy DID like "did:privy:...")
 * - competitionId: UUID of the competition
 * - numberOfTickets: integer count of tickets to purchase
 * - ticketPrice: decimal price per ticket in USD
 * - selectedTickets: optional array of specific ticket numbers
 * - reservationId: optional UUID of existing ticket reservation
 * - referenceId: optional transaction reference for idempotency
 *
 * THIS FUNCTION ACCEPTS ALTERNATIVE PARAMETER NAMES:
 * - walletAddress → translated to userId via canonical_users lookup
 * - userIdentifier → alias for userId
 * - user_id → snake_case alias for userId
 * - canonical_user_id → treated as userId
 * - competition_id → alias for competitionId
 * - quantity / ticketCount / ticket_count / numberOfTickets / number_of_tickets → numberOfTickets
 * - price / ticket_price → alias for ticketPrice
 * - tickets / selected_tickets → alias for selectedTickets
 * - reservation_id → alias for reservationId
 * - reference_id / txRef / transactionRef → alias for referenceId
 */
interface ParsedPurchaseParams {
  userId: string | null;
  walletAddress: string | null;
  competitionId: string | null;
  numberOfTickets: number | null;
  ticketPrice: number | null;
  referenceId: string | null;
  selectedTickets: number[];
  reservationId: string | null;
}

function parseTolerantParams(body: Record<string, unknown>): ParsedPurchaseParams {
  // User identifier - accept multiple field names
  const userId =
    body.userId as string | null ||
    body.userIdentifier as string | null ||
    body.user_id as string | null ||
    body.canonical_user_id as string | null ||
    null;

  // Wallet address - separate field that can be translated
  const walletAddress =
    body.walletAddress as string | null ||
    body.wallet_address as string | null ||
    null;

  // Competition ID - accept snake_case and camelCase
  const competitionId =
    body.competitionId as string | null ||
    body.competition_id as string | null ||
    null;

  // Number of tickets - accept various naming conventions
  const rawTicketCount =
    body.numberOfTickets ??
    body.number_of_tickets ??
    body.ticketCount ??
    body.ticket_count ??
    body.quantity ??
    null;
  const numberOfTickets = rawTicketCount !== null ? Number(rawTicketCount) : null;

  // Ticket price - accept price as an alias
  const rawPrice =
    body.ticketPrice ??
    body.ticket_price ??
    body.price ??
    null;
  const ticketPrice = rawPrice !== null ? Number(rawPrice) : null;

  // Reference ID for idempotency
  const referenceId =
    body.referenceId as string | null ||
    body.reference_id as string | null ||
    body.txRef as string | null ||
    body.transactionRef as string | null ||
    null;

  // Selected tickets array
  const rawSelectedTickets =
    body.selectedTickets ||
    body.selected_tickets ||
    body.tickets ||
    [];
  const selectedTickets = Array.isArray(rawSelectedTickets)
    ? rawSelectedTickets.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0)
    : [];

  // Reservation ID
  const reservationId =
    body.reservationId as string | null ||
    body.reservation_id as string | null ||
    null;

  return {
    userId,
    walletAddress,
    competitionId,
    numberOfTickets,
    ticketPrice,
    referenceId,
    selectedTickets,
    reservationId,
  };
}

/**
 * Lookup canonical_user_id from wallet address
 * Queries canonical_users table to find the user by their wallet address
 */
async function lookupUserByWallet(
  supabase: SupabaseClient,
  walletAddress: string
): Promise<{ canonical_user_id: string | null; uid: string | null }> {
  const normalizedWallet = walletAddress.toLowerCase();

  // Query canonical_users by wallet_address or base_wallet_address
  const { data, error } = await supabase
    .from("canonical_users")
    .select("canonical_user_id, uid, wallet_address, base_wallet_address")
    .or(`wallet_address.ilike.${normalizedWallet},base_wallet_address.ilike.${normalizedWallet}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn(`[lookupUserByWallet] Error looking up wallet ${normalizedWallet.substring(0, 10)}...:`, error.message);
    return { canonical_user_id: null, uid: null };
  }

  if (data) {
    console.log(`[lookupUserByWallet] Found user for wallet ${normalizedWallet.substring(0, 10)}...: canonical_user_id=${data.canonical_user_id?.substring(0, 20)}...`);
    return {
      canonical_user_id: data.canonical_user_id,
      uid: data.uid
    };
  }

  console.log(`[lookupUserByWallet] No user found for wallet ${normalizedWallet.substring(0, 10)}...`);
  return { canonical_user_id: null, uid: null };
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight - no auth required
  if (req.method === "OPTIONS") {
    return handleCorsOptions(req);
  }

  // Get origin for CORS headers on all responses
  const corsHeaders = buildCorsHeaders(req.headers.get('origin'));

  try {
    // Parse body with tolerant parameter handling
    const rawBody = await req.json();
    const params = parseTolerantParams(rawBody);

    // Log parsed parameters for debugging
    console.log(`[purchase-tickets-with-bonus] Parsed params:`, {
      hasUserId: !!params.userId,
      hasWalletAddress: !!params.walletAddress,
      competitionId: params.competitionId?.substring(0, 10),
      numberOfTickets: params.numberOfTickets,
      ticketPrice: params.ticketPrice,
    });

    // Extract parsed values
    let { userId, walletAddress, competitionId, numberOfTickets, ticketPrice, referenceId, selectedTickets, reservationId } = params;

    // If no userId but have walletAddress, we'll resolve it after creating supabase client
    // For now, validate what we have
    const hasUserIdentifier = !!userId || !!walletAddress;

    // Validate inputs
    if (!hasUserIdentifier || !competitionId || !numberOfTickets || !ticketPrice) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required parameters. Required: (userId or walletAddress), competitionId (or competition_id), numberOfTickets (or quantity), ticketPrice (or price)",
          hint: "Accepted user fields: userId, userIdentifier, user_id, canonical_user_id, walletAddress, wallet_address",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (numberOfTickets <= 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Number of tickets must be greater than 0" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate ticket price range ($0.10 - $100)
    if (ticketPrice < 0.1 || ticketPrice > 100) {
      return new Response(
        JSON.stringify({ success: false, error: "Ticket price must be between $0.10 and $100" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create supabase client early - needed for wallet-to-user lookups
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase configuration missing");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // If walletAddress provided instead of userId, look up the canonical_user_id
    // This allows callers to just pass a wallet address and have it resolved
    if (!userId && walletAddress && isWalletAddress(walletAddress)) {
      console.log(`[purchase-tickets-with-bonus] No userId provided, looking up wallet: ${walletAddress.substring(0, 10)}...`);
      const lookupResult = await lookupUserByWallet(supabase, walletAddress);

      if (lookupResult.canonical_user_id) {
        userId = lookupResult.canonical_user_id;
        console.log(`[purchase-tickets-with-bonus] Resolved walletAddress to userId: ${userId.substring(0, 20)}...`);
      } else {
        // No user found for this wallet - could be a new user
        // Generate a canonical ID from the wallet address
        userId = walletAddress;
        console.log(`[purchase-tickets-with-bonus] No existing user for wallet, using wallet as userId`);
      }
    }

    // Final validation: ensure we have a userId now
    if (!userId) {
      console.error(`[purchase-tickets-with-bonus] No userId after wallet lookup. walletAddress=${walletAddress?.substring(0, 10)}`);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Could not determine user identity. Please provide userId or walletAddress.",
          hint: "Accepted fields: userId, userIdentifier, user_id, canonical_user_id, walletAddress, wallet_address",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // CRITICAL: Convert to canonical format for consistent matching across ALL operations
    // This is the primary identifier format used throughout the system
    const canonicalUserId = toPrizePid(userId);
    const normalizedUserId = isPrizePid(userId) ? userId : (isWalletAddress(userId) ? userId.toLowerCase() : userId);
    console.log(`[purchase-tickets-with-bonus] Canonical user ID: ${canonicalUserId}, normalized: ${normalizedUserId.substring(0, 15)}...`);

    // Validate that we have a usable canonical user ID
    // toPrizePid should always return a value, but we double-check to prevent downstream errors
    if (!canonicalUserId || canonicalUserId === 'prize:pid:' || canonicalUserId.length < 15) {
      console.error(`[purchase-tickets-with-bonus] Invalid canonical user ID generated from userId: ${userId?.substring(0, 20)}...`);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid user identifier. Please try logging out and logging back in.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // STEP 1: Load user balance from sub_account_balances (primary) with fallback to canonical_users
    // Try canonical lookup first, then fallback to wallet/privy_user_id for legacy data
    let userBalanceRecord: {
      available_balance: number;
      canonical_user_id?: string;
      user_id?: string;
      record_id?: string;
    } | null = null;
    let pucRows: {
      has_used_new_user_bonus: boolean;
      wallet_address?: string;
      uid?: string;
      canonical_user_id?: string;
    } | null = null;
    const isUserIdWallet = isWalletAddress(userId);

    // Primary: Try to get balance from sub_account_balances table
    const { data: subAccountData, error: subAccountError } = await supabase
      .from("sub_account_balances")
      .select("id, available_balance, pending_balance, canonical_user_id, user_id, privy_user_id")
      .eq("currency", "USD")
      .or(`canonical_user_id.eq.${canonicalUserId},user_id.eq.${normalizedUserId},privy_user_id.eq.${normalizedUserId}`)
      .maybeSingle();

    if (subAccountData && !subAccountError) {
      userBalanceRecord = {
        available_balance: Number(subAccountData.available_balance || 0),
        canonical_user_id: subAccountData.canonical_user_id,
        user_id: subAccountData.user_id,
        record_id: subAccountData.id,
      };
      console.log(`[purchase-tickets-with-bonus] Found balance in sub_account_balances: ${userBalanceRecord.available_balance}`);
    }

    // Also fetch user metadata from canonical_users for bonus status and wallet address
    const { data: canonicalData, error: canonicalError } = await supabase
      .from("canonical_users")
      .select("has_used_new_user_bonus, wallet_address, uid, canonical_user_id")
      .eq("canonical_user_id", canonicalUserId)
      .maybeSingle();

    if (canonicalData) {
      pucRows = canonicalData;
      console.log(`[purchase-tickets-with-bonus] Found user metadata by canonical ID`);
    } else {
      // Fallback to legacy lookups
      console.log(`[purchase-tickets-with-bonus] No match with canonical ID, trying legacy lookups`);

      if (isUserIdWallet) {
        const { data: exactData } = await supabase
          .from("canonical_users")
          .select("has_used_new_user_bonus, wallet_address, uid, canonical_user_id")
          .eq("wallet_address", normalizedUserId)
          .maybeSingle();

        if (exactData) {
          pucRows = exactData;
        } else {
          const { data: privyData } = await supabase
            .from("canonical_users")
            .select("has_used_new_user_bonus, wallet_address, uid, canonical_user_id")
            .eq("privy_user_id", normalizedUserId)
            .maybeSingle();
          pucRows = privyData;
        }
      } else {
        const { data } = await supabase
          .from("canonical_users")
          .select("has_used_new_user_bonus, wallet_address, uid, canonical_user_id")
          .eq("privy_user_id", normalizedUserId)
          .maybeSingle();
        pucRows = data;
      }
    }

    // If no sub_account_balances record, fall back to wallet_balances and canonical_users
    if (!userBalanceRecord || userBalanceRecord.available_balance === 0) {
      console.log(`[purchase-tickets-with-bonus] No sub_account_balances record or zero balance, checking wallet_balances`);

      // Try wallet_balances table first (created for RLS support)
      if (isUserIdWallet) {
        const { data: walletBalanceData } = await supabase
          .from("wallet_balances")
          .select("balance, canonical_user_id, wallet_address, user_id")
          .or(`canonical_user_id.eq.${canonicalUserId},wallet_address.ilike.${normalizedUserId},base_wallet_address.ilike.${normalizedUserId}`)
          .maybeSingle();

        if (walletBalanceData && Number(walletBalanceData.balance) > 0) {
          userBalanceRecord = {
            available_balance: Number(walletBalanceData.balance || 0),
            canonical_user_id: walletBalanceData.canonical_user_id,
            user_id: walletBalanceData.user_id,
          };
          console.log(`[purchase-tickets-with-bonus] Found balance in wallet_balances: ${userBalanceRecord.available_balance}`);
        }
      }
    }

    // If still no record, fall back to canonical_users.usdc_balance
    if (!userBalanceRecord || userBalanceRecord.available_balance === 0) {
      console.log(`[purchase-tickets-with-bonus] No wallet_balances record, falling back to canonical_users`);

      let legacyData = null;
      if (isUserIdWallet) {
        // Try wallet_address first
        const { data } = await supabase
          .from("canonical_users")
          .select("usdc_balance, wallet_address, base_wallet_address, uid, canonical_user_id")
          .ilike("wallet_address", normalizedUserId)
          .maybeSingle();
        legacyData = data;

        // If not found by wallet_address, try base_wallet_address for Base users
        if (!legacyData || Number(legacyData.usdc_balance) === 0) {
          const { data: baseData } = await supabase
            .from("canonical_users")
            .select("usdc_balance, wallet_address, base_wallet_address, uid, canonical_user_id")
            .ilike("base_wallet_address", normalizedUserId)
            .maybeSingle();
          if (baseData && Number(baseData.usdc_balance) > 0) {
            legacyData = baseData;
          }
        }
      }
      if (!legacyData || Number(legacyData.usdc_balance) === 0) {
        const { data } = await supabase
          .from("canonical_users")
          .select("usdc_balance, wallet_address, base_wallet_address, uid, canonical_user_id")
          .eq("privy_user_id", normalizedUserId)
          .maybeSingle();
        if (data && Number(data.usdc_balance) > 0) {
          legacyData = data;
        }
      }

      if (legacyData && Number(legacyData.usdc_balance) > 0) {
        userBalanceRecord = {
          available_balance: Number(legacyData.usdc_balance || 0),
          canonical_user_id: legacyData.canonical_user_id,
          user_id: legacyData.uid,
        };
        if (!pucRows) {
          pucRows = {
            has_used_new_user_bonus: false,
            wallet_address: legacyData.wallet_address || legacyData.base_wallet_address,
            uid: legacyData.uid,
            canonical_user_id: legacyData.canonical_user_id,
          };
        }
        console.log(`[purchase-tickets-with-bonus] Found balance in canonical_users: ${userBalanceRecord.available_balance}`);
      }
    }

    if (!userBalanceRecord || !pucRows) {
      return new Response(
        JSON.stringify({ success: false, error: "User balance data not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const hasUsedBonus: boolean = Boolean(pucRows.has_used_new_user_bonus);
    const userBalance: number = userBalanceRecord.available_balance;

    // Track if we've debited the balance (for rollback in case of errors)
    let balanceDebited = false;
    let newBalance = userBalance;

    // STEP 2: Calculate tickets and cost
    // NOTE: 50% bonus is now applied on wallet TOP-UPS, not on ticket purchases
    // Users get bonus credits when they top up their wallet, which they can then spend on tickets
    const totalTickets = numberOfTickets; // No bonus tickets on purchase anymore
    const totalCost = numberOfTickets * ticketPrice;

    // STEP 3: Check sufficient balance
    if (userBalance < totalCost) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Insufficient balance. Need ${totalCost.toFixed(2)} USDC, have ${userBalance.toFixed(2)} USDC`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // STEP 4: Verify competition exists and check ticket availability
    const { data: comp, error: compErr } = await supabase
      .from("competitions")
      .select("id, is_instant_win, total_tickets, status")
      .eq("id", competitionId)
      .maybeSingle();

    if (compErr || !comp) {
      return new Response(
        JSON.stringify({ success: false, error: "Competition not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if competition is active
    if (comp.status !== "active") {
      return new Response(
        JSON.stringify({ success: false, error: "Competition is not active" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // STEP 4a: Check for existing reservation (if reservationId provided or user has one)
    // This ensures balance payments respect the reservation system
    let reservedTicketNumbers: number[] | null = null;
    let reservationRecord: any = null;

    // Only query by reservationId if it's a valid UUID (not a placeholder like 'pending')
    if (reservationId && isValidUUID(reservationId)) {
      // Try canonical ID match first
      let { data: reservation, error: resError } = await supabase
        .from("pending_tickets")
        .select("*")
        .eq("id", reservationId)
        .eq("user_id", canonicalUserId)
        .eq("competition_id", competitionId)
        .eq("status", "pending")
        .maybeSingle();

      // If not found with canonical, try with normalized userId (fallback for legacy data)
      if (!reservation && !isPrizePid(userId)) {
        console.log(`[purchase-tickets-with-bonus] Canonical match failed, trying legacy lookup`);
        const { data: legacyReservation } = await supabase
          .from("pending_tickets")
          .select("*")
          .eq("id", reservationId)
          .eq("user_id", normalizedUserId)
          .eq("competition_id", competitionId)
          .eq("status", "pending")
          .maybeSingle();
        reservation = legacyReservation;
      }

      // If still not found, try case-insensitive match for wallet addresses
      if (!reservation && isUserIdWallet) {
        console.log(`[purchase-tickets-with-bonus] Exact match failed, trying case-insensitive lookup`);
        const { data: altReservation } = await supabase
          .from("pending_tickets")
          .select("*")
          .eq("id", reservationId)
          .ilike("user_id", normalizedUserId)
          .eq("competition_id", competitionId)
          .eq("status", "pending")
          .maybeSingle();
        reservation = altReservation;
      }

      if (!resError && reservation) {
        // Check if reservation is still valid (not expired)
        if (reservation.expires_at && new Date(reservation.expires_at) < new Date()) {
          // Mark as expired
          await supabase
            .from("pending_tickets")
            .update({ status: "expired", updated_at: new Date().toISOString() })
            .eq("id", reservationId);

          return new Response(
            JSON.stringify({
              success: false,
              error: "Your ticket reservation has expired. Please select tickets again.",
              expiredAt: reservation.expires_at
            }),
            { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        reservationRecord = reservation;
        reservedTicketNumbers = (reservation.ticket_numbers || [])
          .map((n: any) => Number(n))
          .filter((n: number) => Number.isFinite(n));

        console.log(`Using reservation ${reservationId} with ${reservedTicketNumbers.length} tickets`);
      }
    }

    // If no valid reservationId or no reservation found, try to find most recent pending reservation for this user/competition
    // This handles cases where reservationId is a placeholder like 'pending' or null
    if (!reservedTicketNumbers && (!reservationId || !isValidUUID(reservationId))) {
      console.log(`No valid reservationId provided (got: '${reservationId || 'null'}'), searching for latest reservation for user: ${canonicalUserId.substring(0, 20)}...`);

      // First try with canonical userId
      let { data: latestReservation } = await supabase
        .from("pending_tickets")
        .select("*")
        .eq("user_id", canonicalUserId)
        .eq("competition_id", competitionId)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // If not found with canonical, try with normalized userId (fallback for legacy data)
      if (!latestReservation && !isPrizePid(userId)) {
        console.log(`[purchase-tickets-with-bonus] Canonical fallback lookup failed, trying legacy`);
        const { data: legacyReservation } = await supabase
          .from("pending_tickets")
          .select("*")
          .eq("user_id", normalizedUserId)
          .eq("competition_id", competitionId)
          .eq("status", "pending")
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        latestReservation = legacyReservation;
      }

      // If still not found, try case-insensitive match for wallet addresses
      if (!latestReservation && isUserIdWallet) {
        console.log(`[purchase-tickets-with-bonus] Exact fallback lookup failed, trying case-insensitive`);
        const { data: altReservation } = await supabase
          .from("pending_tickets")
          .select("*")
          .ilike("user_id", normalizedUserId)
          .eq("competition_id", competitionId)
          .eq("status", "pending")
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        latestReservation = altReservation;
      }

      if (latestReservation) {
        reservationRecord = latestReservation;
        reservedTicketNumbers = (latestReservation.ticket_numbers || [])
          .map((n: any) => Number(n))
          .filter((n: number) => Number.isFinite(n));

        console.log(`Found existing reservation ${latestReservation.id} with ${reservedTicketNumbers.length} tickets`);
      }
    }

    // Get currently unavailable tickets (sold + pending reservations from OTHER users)
    // Use RPC to get entries with both UUID and legacy uid
    let soldTicketsJC: any[] = [];
    const { data: entriesFromRpc, error: rpcError } = await supabase
      .rpc('get_joincompetition_entries_for_competition', {
        p_competition_id: competitionId
      });

    if (!rpcError && entriesFromRpc) {
      soldTicketsJC = entriesFromRpc;
    } else {
      // Fallback: direct query (may miss entries with legacy uid)
      console.warn('[purchase-tickets-with-bonus] RPC get entries failed, using fallback:', rpcError?.message);
      const { data: fallbackEntries } = await supabase
        .from("joincompetition")
        .select("ticketnumbers")
        .eq("competitionid", competitionId);
      soldTicketsJC = fallbackEntries || [];
    }

    const { data: soldTicketsTable } = await supabase
      .from("tickets")
      .select("ticket_number")
      .eq("competition_id", competitionId);

    // Only count pending reservations from OTHER users (not our own reservation)
    let pendingReservationsQuery = supabase
      .from("pending_tickets")
      .select("ticket_numbers, user_id")
      .eq("competition_id", competitionId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString());

    // Exclude our own reservation from the unavailable count
    if (reservationRecord?.id) {
      pendingReservationsQuery = pendingReservationsQuery.neq("id", reservationRecord.id);
    }

    const { data: pendingReservations } = await pendingReservationsQuery;

    // Build set of unavailable tickets
    const unavailableTickets = new Set<number>();

    // Add sold tickets from joincompetition (comma-separated format)
    (soldTicketsJC || []).forEach((entry: any) => {
      if (entry.ticketnumbers) {
        const nums = entry.ticketnumbers.split(",").map((n: string) => parseInt(n.trim())).filter((n: number) => !isNaN(n));
        nums.forEach((n: number) => unavailableTickets.add(n));
      }
    });

    // Add sold tickets from tickets table
    (soldTicketsTable || []).forEach((ticket: any) => {
      if (ticket.ticket_number) {
        unavailableTickets.add(Number(ticket.ticket_number));
      }
    });

    // Add pending reservations from OTHER users (not expired)
    (pendingReservations || []).forEach((res: any) => {
      if (res.ticket_numbers && Array.isArray(res.ticket_numbers)) {
        res.ticket_numbers.forEach((n: number) => unavailableTickets.add(n));
      }
    });

    // Validate total tickets requested doesn't exceed available
    const maxTicket = comp.total_tickets || 1000;
    const totalAvailable = maxTicket - unavailableTickets.size;
    if (totalTickets > totalAvailable) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Cannot purchase ${totalTickets} tickets. Only ${totalAvailable} tickets are available.`,
          availableCount: totalAvailable,
          requestedCount: totalTickets
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use reserved tickets if we have them, otherwise use selectedTickets from request
    const userSelectedTickets = reservedTicketNumbers && reservedTicketNumbers.length > 0
      ? reservedTicketNumbers
      : (Array.isArray(selectedTickets) && selectedTickets.length > 0
        ? selectedTickets.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0)
        : []);

    if (userSelectedTickets.length > 0) {
      const unavailableSelected = userSelectedTickets.filter((t: number) => unavailableTickets.has(t));
      if (unavailableSelected.length > 0) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Some selected tickets are no longer available: ${unavailableSelected.join(", ")}`,
            unavailableTickets: unavailableSelected
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // STEP 5: Idempotency check BEFORE balance debit (moved up to prevent partial state)
    // This ensures we don't debit balance for already-processed transactions
    const txRef = referenceId || crypto.randomUUID();
    if (referenceId) {
      const { data: existing } = await supabase
        .from("joincompetition")
        .select("id")
        .eq("userid", normalizedUserId)
        .eq("competitionid", competitionId)
        .eq("transactionhash", referenceId)
        .maybeSingle();
      if (existing) {
        // Already processed; return success with current balance (no deduction)
        return new Response(
          JSON.stringify({
            success: true,
            ticketsCreated: 0,
            ticketsPurchased: 0,
            totalCost: 0,
            balanceAfterPurchase: userBalance, // Return original balance since nothing changed
            message: "Already processed",
            tickets: [],
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // STEP 6: Debit user balance (optimistic, with rollback on failure later)
    // Primary: Update sub_account_balances table
    // Secondary: Update wallet_balances table
    // Fallback: Update canonical_users.usdc_balance for legacy records
    newBalance = Number((userBalance - totalCost).toFixed(2));
    let debitErr;
    let debitResult;
    let debitSource: 'sub_account_balances' | 'wallet_balances' | 'canonical_users' = 'sub_account_balances';

    // Primary: Try to update sub_account_balances if we have a record
    if (userBalanceRecord?.record_id) {
      const { error, data } = await supabase
        .from("sub_account_balances")
        .update({
          available_balance: newBalance,
          last_updated: new Date().toISOString(),
        })
        .eq("id", userBalanceRecord.record_id)
        .gte("available_balance", totalCost)
        .select("id, available_balance");
      debitErr = error;
      debitResult = data;
      debitSource = 'sub_account_balances';

      if (!error && data && data.length > 0) {
        console.log("[Balance Debit] Successfully updated sub_account_balances, new balance:", newBalance);
      } else {
        console.log("[Balance Debit] sub_account_balances update failed or no rows matched, error:", error?.message);
      }
    }

    // Secondary: Try to update wallet_balances if sub_account_balances failed
    if (!debitResult || debitResult.length === 0) {
      console.log("[Balance Debit] Trying wallet_balances update");
      debitSource = 'wallet_balances';

      // Try by canonical_user_id first, then by wallet addresses
      let walletBalanceUpdate = null;
      if (userBalanceRecord?.canonical_user_id) {
        const { error, data } = await supabase
          .from("wallet_balances")
          .update({
            balance: newBalance,
            updated_at: new Date().toISOString(),
          })
          .eq("canonical_user_id", userBalanceRecord.canonical_user_id)
          .gte("balance", totalCost)
          .select("user_id, balance");
        if (data && data.length > 0) {
          debitErr = error;
          debitResult = data;
          walletBalanceUpdate = data;
        }
      }

      // If not found by canonical, try by wallet_address
      if (!walletBalanceUpdate && isUserIdWallet) {
        const { error, data } = await supabase
          .from("wallet_balances")
          .update({
            balance: newBalance,
            updated_at: new Date().toISOString(),
          })
          .or(`wallet_address.ilike.${normalizedUserId},base_wallet_address.ilike.${normalizedUserId}`)
          .gte("balance", totalCost)
          .select("user_id, balance");
        if (data && data.length > 0) {
          debitErr = error;
          debitResult = data;
          walletBalanceUpdate = data;
        }
      }

      if (walletBalanceUpdate && walletBalanceUpdate.length > 0) {
        console.log("[Balance Debit] Successfully updated wallet_balances, new balance:", newBalance);
      }
    }

    // Fallback: Update canonical_users if wallet_balances update failed or no record
    if (!debitResult || debitResult.length === 0) {
      console.log("[Balance Debit] Falling back to canonical_users update");
      debitSource = 'canonical_users';

      if (pucRows.uid) {
        const { error, data } = await supabase
          .from("canonical_users")
          .update({
            usdc_balance: newBalance,
          })
          .eq("uid", pucRows.uid)
          .select("uid");
        debitErr = error;
        debitResult = data;
      } else if (isUserIdWallet) {
        const storedWalletAddress = pucRows.wallet_address;

        if (storedWalletAddress) {
          const { error, data } = await supabase
            .from("canonical_users")
            .update({
              usdc_balance: newBalance,
            })
            .ilike("wallet_address", storedWalletAddress)
            .select("uid");
          debitErr = error;
          debitResult = data;
        }

        // If wallet_address failed, try base_wallet_address
        if (!debitResult || debitResult.length === 0) {
          const { error, data } = await supabase
            .from("canonical_users")
            .update({
              usdc_balance: newBalance,
            })
            .ilike("base_wallet_address", normalizedUserId)
            .select("uid");
          if (data && data.length > 0) {
            debitErr = error;
            debitResult = data;
          }
        }

        if (!debitResult || debitResult.length === 0) {
          const { error, data } = await supabase
            .from("canonical_users")
            .update({
              usdc_balance: newBalance,
            })
            .eq("privy_user_id", normalizedUserId)
            .select("uid");
          debitErr = error;
          debitResult = data;
        }
      } else {
        const { error, data } = await supabase
          .from("canonical_users")
          .update({
            usdc_balance: newBalance,
          })
          .eq("privy_user_id", normalizedUserId)
          .select("uid");
        debitErr = error;
        debitResult = data;
      }
    }

    if (debitErr) {
      throw new Error(`Failed to update balance: ${debitErr.message}`);
    }

    // CRITICAL: Verify the update actually affected a row
    if (!debitResult || debitResult.length === 0) {
      console.error("[Balance Debit] No rows were updated! User record may not exist or wallet address mismatch.");
      console.error("[Balance Debit] userId:", userId, "storedWalletAddress:", pucRows.wallet_address, "uid:", pucRows.uid);
      throw new Error(`Balance update did not affect any rows. Please contact support.`);
    }

    console.log(`[Balance Debit] Successfully updated ${debitSource}, new balance:`, newBalance);

    // Mark that balance has been debited - any error after this point needs rollback
    balanceDebited = true;

    // CRITICAL FIX: Create balance_ledger entry for audit trail
    // This ensures all balance changes (both credits AND debits) are tracked
    // Previously, only top-ups created ledger entries; purchases were missing
    const userUuidForLedger = pucRows.uid || debitResult[0]?.uid;
    if (userUuidForLedger) {
      const ledgerEntry = {
        user_id: userUuidForLedger,
        balance_type: 'real',
        source: 'ticket_purchase',
        amount: -totalCost, // Negative for debit
        transaction_id: null, // Will be updated with entry ID if needed
        metadata: {
          competition_id: competitionId,
          tickets_purchased: numberOfTickets,
          total_tickets: totalTickets,
          ticket_price: ticketPrice,
          reference_id: referenceId || null,
          reservation_id: reservationId || null,
          previous_balance: userBalance,
          new_balance: newBalance,
        },
        created_at: new Date().toISOString(),
        expires_at: null,
      };

      const { error: ledgerError } = await supabase
        .from("balance_ledger")
        .insert(ledgerEntry);

      if (ledgerError) {
        // Log but don't fail the transaction - ledger is for audit, not critical path
        console.warn("[Balance Ledger] Failed to create ledger entry:", ledgerError.message);
      } else {
        console.log("[Balance Ledger] Created debit entry for purchase:", totalCost);
      }
    } else {
      console.warn("[Balance Ledger] No user UUID available for ledger entry");
    }

    try {
      // STEP 7: Assign canonical tickets (honors user-selected tickets if provided)
      // Pass selectedTickets as preferredTicketNumbers so the user's choices are respected
      // (userSelectedTickets already validated and populated in STEP 4)
      // Use canonical user ID for ticket storage
      const ticketUserId = pucRows.canonical_user_id || canonicalUserId;

      // CRITICAL: Validate ticketUserId before calling assignTickets
      // This prevents the "userIdentifier is required" error
      if (!ticketUserId || ticketUserId.trim() === '') {
        console.error(`[purchase-tickets-with-bonus] Invalid ticketUserId: pucRows.canonical_user_id=${pucRows.canonical_user_id}, canonicalUserId=${canonicalUserId}`);
        throw new Error("User identifier could not be determined. Please try logging out and back in.");
      }

      const assigned = await assignTickets({
        supabase,
        userIdentifier: ticketUserId, // Use canonical ID for consistent storage
        competitionId,
        orderId: null,
        ticketCount: totalTickets,
        preferredTicketNumbers: userSelectedTickets,
      });
      const assignedNumbers = assigned.ticketNumbers;

      // STEP 8: Set purchase_price for all tickets (no bonus tickets anymore)
      // Update tickets using the user_id column with canonical ID
      if (assignedNumbers.length > 0) {
        const { error: priceErr } = await supabase
          .from("tickets")
          .update({ purchase_price: ticketPrice })
          .eq("competition_id", competitionId)
          .eq("user_id", ticketUserId)
          .in("ticket_number", assignedNumbers);
        if (priceErr) throw priceErr;
      }


      // STEP 9: Get user's wallet address for the entry
      // Determine wallet address from the user identifier or profile
      let walletAddress = isUserIdWallet ? normalizedUserId : null;
      if (!walletAddress) {
        const { data: userWalletData } = await supabase
          .from("canonical_users")
          .select("wallet_address")
          .eq("privy_user_id", normalizedUserId)
          .maybeSingle();
        walletAddress = userWalletData?.wallet_address || normalizedUserId;
      }

      // Create joincompetition entry for dashboard display
      // This is CRITICAL for entries to appear in the user dashboard
      // Use canonical user ID for consistent storage
      const entryUid = crypto.randomUUID();
      let jcEntryCreated = false;
      let jcRetryCount = 0;
      const maxRetries = 3;
      let lastJcError: any = null;
      let jcData: any = null;

      // Retry joincompetition insert with exponential backoff
      while (!jcEntryCreated && jcRetryCount < maxRetries) {
        // Note: userid and privy_user_id both store canonical ID for consistent lookups
        const { error: jcErr, data: insertData } = await supabase
          .from("joincompetition")
          .insert({
            uid: entryUid,
            competitionid: competitionId,
            userid: ticketUserId,  // Use canonical ID
            privy_user_id: ticketUserId, // Also set privy_user_id to canonical ID
            numberoftickets: assignedNumbers.length,
            ticketnumbers: assignedNumbers.join(","),
            amountspent: totalCost,
            walletaddress: walletAddress,
            chain: "USDC",
            transactionhash: txRef,
            purchasedate: new Date().toISOString(),
          })
          .select('uid')
          .single();

        if (jcErr) {
          lastJcError = jcErr;
          jcRetryCount++;
          console.error(`joincompetition insert error (attempt ${jcRetryCount}/${maxRetries}):`, jcErr);
          console.error("Entry data:", { uid: entryUid, competitionId, userId, ticketCount: assignedNumbers.length });

          if (jcRetryCount < maxRetries) {
            // Exponential backoff: 100ms, 200ms, 400ms
            await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, jcRetryCount - 1)));
          }
        } else {
          jcEntryCreated = true;
          jcData = insertData;
          console.log("joincompetition entry created:", jcData?.uid || entryUid);
        }
      }

      // Log warning if joincompetition failed after all retries (tickets still assigned, will appear via RPC fallback)
      if (!jcEntryCreated) {
        console.warn("CRITICAL: joincompetition insert failed after all retries. Tickets are assigned but entry may not appear in dashboard immediately.");
        console.warn("Fallback: get_competition_entries_bypass_rls RPC will fetch from tickets table");
      }

      // STEP 9a: Create user_transactions record for dashboard visibility
      // This is CRITICAL for the order to appear in the user's "Orders" tab
      // Balance payments are immediately completed, so status is 'finished'
      const transactionId = crypto.randomUUID();
      const { error: txInsertErr, data: txData } = await supabase
        .from("user_transactions")
        .insert({
          id: transactionId,
          user_id: ticketUserId,
          user_privy_id: ticketUserId,
          wallet_address: walletAddress,
          competition_id: competitionId,
          ticket_count: assignedNumbers.length,
          amount: totalCost,
          status: 'finished', // Balance payments are immediately complete
          payment_status: 'completed',
          payment_provider: 'balance',
          tx_id: txRef,
          currency: 'usd',
          pay_currency: 'USDC',
          network: 'balance', // Indicates this was paid from account balance
          order_id: jcEntryCreated ? (jcData?.uid || entryUid) : entryUid,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          notes: `Balance payment for ${assignedNumbers.length} tickets in competition ${competitionId}`,
        })
        .select('id')
        .single();

      if (txInsertErr) {
        // Log but don't fail - user_transactions is for visibility, not critical path
        console.warn("[user_transactions] Failed to create transaction record:", txInsertErr.message);
      } else {
        console.log("[user_transactions] Created transaction record:", txData?.id || transactionId);
      }

      // STEP 9b: Mark reservation as confirmed (if we used one)
      if (reservationRecord?.id) {
        const { error: resUpdateErr } = await supabase
          .from("pending_tickets")
          .update({
            status: "confirmed",
            transaction_hash: txRef,
            payment_provider: "balance",
            confirmed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", reservationRecord.id);

        if (resUpdateErr) {
          console.warn("Failed to update reservation status (non-critical):", resUpdateErr);
        } else {
          console.log("Reservation marked as confirmed:", reservationRecord.id);
        }
      }

      // STEP 10: Instant wins (if applicable)
      const instantWins: any[] = [];
      if (comp.is_instant_win && assignedNumbers.length > 0) {
        for (const ticketNum of assignedNumbers) {
          const { data: prize, error: prizeErr } = await supabase
            .from("Prize_Instantprizes")
            .select("*")
            .eq("competitionId", competitionId)
            .eq("winningTicket", ticketNum)
            .is("winningWalletAddress", null)
            .maybeSingle();

          if (!prizeErr && prize) {
            // Use canonical ID for prize winner
            const { error: winUpdateErr } = await supabase
              .from("Prize_Instantprizes")
              .update({ winningWalletAddress: ticketUserId })
              .eq("UID", prize.UID);

            if (!winUpdateErr) {
              instantWins.push({ ticketNumber: ticketNum, prize: prize.prize, prizeId: prize.UID });
            } else {
              console.error("Failed to update prize:", winUpdateErr);
            }
          }
        }
      }

      // STEP 11: Return success
      return new Response(
        JSON.stringify({
          success: true,
          ticketsCreated: totalTickets,
          ticketsPurchased: numberOfTickets,
          totalCost,
          balanceAfterPurchase: newBalance,
          message: `Successfully purchased ${totalTickets} tickets!`,
          tickets: assignedNumbers,
          entryCreated: jcEntryCreated,  // Flag to indicate if dashboard entry was created
          entryId: jcEntryCreated ? (jcData?.uid || entryUid) : null,
          transactionId: transactionId,  // Transaction record ID for tracking in user_transactions
          transactionRef: txRef,  // Transaction reference/hash
          instantWins: instantWins.length > 0 ? instantWins : undefined,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (assignErr) {
      // Rollback balance on failure
      // Primary: Rollback sub_account_balances if that's what we updated
      // Secondary: Rollback wallet_balances
      // Fallback: Rollback canonical_users for legacy records
      const errorMessage = assignErr instanceof Error ? assignErr.message : "Failed to assign tickets";
      console.error("Ticket assignment error, rolling back balance:", errorMessage, assignErr);

      let rbErr;

      // Try to rollback sub_account_balances first
      if (userBalanceRecord?.record_id) {
        const { error } = await supabase
          .from("sub_account_balances")
          .update({
            available_balance: userBalance,
            last_updated: new Date().toISOString(),
          })
          .eq("id", userBalanceRecord.record_id);
        rbErr = error;
        if (!error) {
          console.log("sub_account_balances rollback successful:", { recordId: userBalanceRecord.record_id, restoredBalance: userBalance });
        }
      }

      // Try to rollback wallet_balances
      if (userBalanceRecord?.canonical_user_id) {
        const { error } = await supabase
          .from("wallet_balances")
          .update({
            balance: userBalance,
            updated_at: new Date().toISOString(),
          })
          .eq("canonical_user_id", userBalanceRecord.canonical_user_id);
        if (error && !rbErr) rbErr = error;
        if (!error) {
          console.log("wallet_balances rollback successful:", { canonicalUserId: userBalanceRecord.canonical_user_id, restoredBalance: userBalance });
        }
      } else if (isUserIdWallet) {
        const { error } = await supabase
          .from("wallet_balances")
          .update({
            balance: userBalance,
            updated_at: new Date().toISOString(),
          })
          .or(`wallet_address.ilike.${normalizedUserId},base_wallet_address.ilike.${normalizedUserId}`);
        if (error && !rbErr) rbErr = error;
      }

      // Also rollback canonical_users as a safety measure
      if (isUserIdWallet) {
        const { error } = await supabase
          .from("canonical_users")
          .update({
            usdc_balance: userBalance,
          })
          .or(`wallet_address.ilike.${normalizedUserId},base_wallet_address.ilike.${normalizedUserId},privy_user_id.eq.${normalizedUserId}`);
        if (error && !rbErr) rbErr = error;
      } else {
        const { error } = await supabase
          .from("canonical_users")
          .update({
            usdc_balance: userBalance,
          })
          .eq("privy_user_id", normalizedUserId);
        if (error && !rbErr) rbErr = error;
      }

      if (rbErr) {
        console.error("Rollback balance error:", rbErr);
      } else {
        console.log("Balance rollback successful:", { userId: normalizedUserId, restoredBalance: userBalance });
      }

      return new Response(
        JSON.stringify({
          success: false,
          error: errorMessage,
          code: "TICKET_ASSIGNMENT_FAILED",
          balanceRestored: !rbErr
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("Ticket purchase error:", error);

    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message || "Failed to purchase tickets" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
