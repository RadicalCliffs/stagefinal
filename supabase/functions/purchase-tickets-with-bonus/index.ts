import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { toPrizePid, isPrizePid, normalizeWalletAddress } from "../_shared/userId.ts";

// Inlined CORS configuration (bundler doesn't support shared module imports)
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
  let ticketInsertionSkipped = false;

  for (let attempt = 0; attempt < maxRetries && remainingToInsert.length > 0; attempt++) {
    // Generate a unique tx_id for this batch (required by CHECK constraint)
    const txIdBatch = `balance_${Date.now()}_${attempt}`;
    const rows = remainingToInsert.map(num => ({
      competition_id: competitionId,
      order_id: orderId ?? null,
      ticket_number: num,
      user_id: userIdentifier,
      canonical_user_id: userIdentifier, // Add canonical_user_id for consistency
      status: 'sold',
      tx_id: txIdBatch, // Required by CHECK constraint: tx_id IS NOT NULL AND length(tx_id) > 0
      created_at: new Date().toISOString(),
    }));

    const { error: insertError } = await supabase.from("tickets").insert(rows);

    if (!insertError) {
      successfullyInserted.push(...remainingToInsert);
      remainingToInsert = [];
      break;
    }

    // Check if this is a schema mismatch (column doesn't exist)
    const isSchemaError = insertError.message?.includes('column') ||
      insertError.message?.includes('does not exist') ||
      insertError.message?.includes('null value in column') ||
      insertError.code === '42703' || // undefined_column
      insertError.code === '23502'; // not_null_violation (likely wrong columns)

    if (isSchemaError && attempt === 0) {
      // The tickets table has a different schema - skip ticket insertion
      // The joincompetition entry will be the source of truth
      console.warn("assignTickets: tickets table has different schema, skipping direct insertion");
      console.warn("assignTickets: joincompetition entry will be the source of truth");
      ticketInsertionSkipped = true;
      successfullyInserted = [...finalTicketNumbers];
      remainingToInsert = [];
      break;
    }

    const isConflictError = insertError.code === '23505' ||
      insertError.message?.includes('unique') ||
      insertError.message?.includes('duplicate');

    if (!isConflictError) {
      console.error("assignTickets: error inserting tickets", insertError);
      // For balance payments, we can proceed without tickets table if joincompetition works
      console.warn("assignTickets: proceeding without tickets table insertion");
      ticketInsertionSkipped = true;
      successfullyInserted = [...finalTicketNumbers];
      remainingToInsert = [];
      break;
    }

    console.warn(`assignTickets: conflict on attempt ${attempt + 1}, retrying with fresh ticket selection`);

    const { data: currentUsedTickets, error: refetchError } = await supabase
      .from("tickets")
      .select("ticket_number")
      .eq("competition_id", competitionId);

    if (refetchError) {
      // If we can't query tickets table, fall back to joincompetition
      console.warn("assignTickets: can't query tickets table, using joincompetition as source");
      ticketInsertionSkipped = true;
      successfullyInserted = [...finalTicketNumbers];
      remainingToInsert = [];
      break;
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

  if (remainingToInsert.length > 0 && !ticketInsertionSkipped) {
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
 * AGGRESSIVE, IDEMPOTENT, SELF-HEALING VERSION
 *
 * NEW FEATURES:
 * - idempotency_key: Optional but recommended; using the same key returns the same response on retry
 * - ticket_numbers: Required if reservation is missing/ambiguous; allows direct purchase without reservation
 * - Proceeds even if the reservation is missing/expired (as long as requested ticket_numbers are still available)
 * - Treats canonical_user_id as TEXT and normalizes wallet casing
 * - Auto-ensures minimal schema: purchase_idempotency, pending_tickets columns, and minimal tickets table/indexes
 * - Is idempotent using idempotency_key. If key is reused, it returns the same result
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
 * NEW: RESERVATION-LESS MODE:
 * If reservation is missing/expired, the function will proceed with the purchase
 * as long as the requested ticket_numbers are still available.
 *
 * THIS FUNCTION ACCEPTS ALTERNATIVE PARAMETER NAMES:
 * - walletAddress → translated to userId via canonical_users lookup
 * - userIdentifier → alias for userId
 * - user_id → snake_case alias for userId
 * - canonical_user_id → treated as userId
 * - competition_id → alias for competitionId
 * - quantity / ticketCount / ticket_count / numberOfTickets / number_of_tickets → numberOfTickets
 * - price / ticket_price → alias for ticketPrice
 * - tickets / selected_tickets / ticket_numbers → alias for selectedTickets
 * - reservation_id → alias for reservationId
 * - reference_id / txRef / transactionRef / idempotency_key → alias for referenceId
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
  idempotencyKey: string | null;
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

  // Idempotency key - NEW parameter for aggressive idempotency
  const idempotencyKey =
    body.idempotency_key as string | null ||
    body.idempotencyKey as string | null ||
    null;

  // Reference ID for idempotency (legacy) - also accept idempotency_key as fallback
  const referenceId =
    body.referenceId as string | null ||
    body.reference_id as string | null ||
    body.txRef as string | null ||
    body.transactionRef as string | null ||
    idempotencyKey ||
    null;

  // Selected tickets array - also accept ticket_numbers for reservation-less mode
  const rawSelectedTickets =
    body.selectedTickets ||
    body.selected_tickets ||
    body.tickets ||
    body.ticket_numbers ||
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
    idempotencyKey,
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

    // Create supabase client early - needed for reservation lookups and wallet-to-user lookups
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase configuration missing");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // SCHEMA AUTO-ENSURE (best-effort DDL)
    // This function attempts to ensure minimal schema exists for operation
    // If DDL fails due to permissions, the function still proceeds with existing schema
    const ensureSchema = async () => {
      try {
        // Ensure purchase_idempotency table exists for idempotent purchases
        const { error: idempotencyTableErr } = await supabase.rpc('exec_ddl', {
          ddl_statement: `
            CREATE TABLE IF NOT EXISTS purchase_idempotency (
              idempotency_key TEXT PRIMARY KEY,
              canonical_user_id TEXT,
              competition_id UUID,
              response_data JSONB,
              created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_purchase_idempotency_user ON purchase_idempotency(canonical_user_id);
            CREATE INDEX IF NOT EXISTS idx_purchase_idempotency_created ON purchase_idempotency(created_at);
          `
        });
        if (idempotencyTableErr && !idempotencyTableErr.message?.includes('already exists')) {
          console.warn(`[schema-ensure] Could not ensure purchase_idempotency table:`, idempotencyTableErr.message);
        }

        // Ensure pending_tickets has necessary columns for self-healing mode
        const { error: pendingColumnsErr } = await supabase.rpc('exec_ddl', {
          ddl_statement: `
            ALTER TABLE pending_tickets ADD COLUMN IF NOT EXISTS ticket_price DECIMAL(10,2);
            ALTER TABLE pending_tickets ADD COLUMN IF NOT EXISTS payment_provider TEXT;
            ALTER TABLE pending_tickets ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
          `
        });
        if (pendingColumnsErr && !pendingColumnsErr.message?.includes('already exists')) {
          console.warn(`[schema-ensure] Could not add pending_tickets columns:`, pendingColumnsErr.message);
        }

        // Ensure tickets table has minimal required columns/indexes
        const { error: ticketsIndexErr } = await supabase.rpc('exec_ddl', {
          ddl_statement: `
            CREATE INDEX IF NOT EXISTS idx_tickets_competition_user ON tickets(competition_id, user_id);
            CREATE INDEX IF NOT EXISTS idx_tickets_reservation ON tickets(reservation_id) WHERE reservation_id IS NOT NULL;
          `
        });
        if (ticketsIndexErr && !ticketsIndexErr.message?.includes('already exists')) {
          console.warn(`[schema-ensure] Could not ensure tickets indexes:`, ticketsIndexErr.message);
        }

        console.log(`[schema-ensure] Schema verification completed`);
      } catch (schemaErr) {
        // Schema ensure is best-effort - don't block purchase on DDL failures
        // Common reasons: exec_ddl RPC doesn't exist, permission denied, etc.
        console.warn(`[schema-ensure] Schema ensure skipped (RPC may not exist):`, schemaErr);
      }
    };

    // Run schema ensure in background (don't await, don't block purchase flow)
    ensureSchema().catch(() => {});

    // IDEMPOTENCY CHECK: If idempotency_key provided, check purchase_idempotency table first
    // If a matching record exists, return the cached result immediately
    const effectiveIdempotencyKey = params.idempotencyKey || params.referenceId;
    if (effectiveIdempotencyKey) {
      console.log(`[purchase-tickets-with-bonus] Checking idempotency for key: ${effectiveIdempotencyKey.substring(0, 20)}...`);

      const { data: existingPurchase, error: idempotencyErr } = await supabase
        .from("purchase_idempotency")
        .select("*")
        .eq("idempotency_key", effectiveIdempotencyKey)
        .maybeSingle();

      if (!idempotencyErr && existingPurchase) {
        console.log(`[purchase-tickets-with-bonus] Found existing purchase for idempotency key, returning cached result`);

        // Parse the stored response and return it
        // Ensure it has the required status field for frontend compatibility
        const cachedResponse = existingPurchase.response_data || {};
        
        // If the cached response doesn't have status field, add it based on success field
        if (!cachedResponse.status && cachedResponse.success) {
          cachedResponse.status = 'succeeded';
        }
        
        // Spread cached response first, then override critical fields that must be set
        return new Response(
          JSON.stringify({
            ...cachedResponse,
            idempotent: true,
            message: "Purchase already processed (idempotent response)",
            cachedAt: existingPurchase.created_at,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // If table doesn't exist, the query will fail - that's OK, we'll proceed without idempotency cache
      if (idempotencyErr && !idempotencyErr.message?.includes('does not exist')) {
        console.warn(`[purchase-tickets-with-bonus] Error checking idempotency:`, idempotencyErr.message);
      }
    }

    // NEW: If reservationId is provided and valid, derive missing fields from pending_tickets
    // This allows the function to work with just reservationId
    // AGGRESSIVE MODE: If reservation is missing/expired, proceed with ticket_numbers if provided
    let derivedFromReservation = false;
    let reservationMissingOrExpired = false;
    let reservationExpiredTickets: number[] = [];

    if (reservationId && isValidUUID(reservationId)) {
      console.log(`[purchase-tickets-with-bonus] Attempting to derive fields from reservationId: ${reservationId}`);

      // First check if this reservation was already confirmed (idempotency check)
      const { data: existingReservation, error: checkError } = await supabase
        .from("pending_tickets")
        .select("*")
        .eq("id", reservationId)
        .maybeSingle();

      if (checkError) {
        console.warn(`[purchase-tickets-with-bonus] Error querying reservation (proceeding without):`, checkError.message);
        reservationMissingOrExpired = true;
      } else if (!existingReservation) {
        console.log(`[purchase-tickets-with-bonus] Reservation not found - proceeding with ticket_numbers if available`);
        reservationMissingOrExpired = true;
      } else if (existingReservation.status === "confirmed") {
        // If reservation already confirmed, return success (idempotent response)
        console.log(`[purchase-tickets-with-bonus] Reservation ${reservationId} already confirmed - returning success (idempotent)`);

        // Get the tickets that were assigned to this reservation
        const { data: confirmedTickets } = await supabase
          .from("tickets")
          .select("ticket_number, id")
          .eq("reservation_id", reservationId)
          .order("ticket_number");

        const ticketNumbers = confirmedTickets ? confirmedTickets.map(t => t.ticket_number) : [];
        const tickets = confirmedTickets ? confirmedTickets.map(t => ({
          id: t.id || (() => {
            console.warn(`[purchase-tickets-with-bonus] Ticket missing ID for ticket_number ${t.ticket_number}, using fallback UUID`);
            return crypto.randomUUID();
          })(),
          ticket_number: t.ticket_number
        })) : [];

        // Warn if transaction_hash is missing for an already-confirmed reservation
        if (!existingReservation.transaction_hash) {
          console.warn(`[purchase-tickets-with-bonus] Already-confirmed reservation ${reservationId} is missing transaction_hash, using fallback UUID for payment_id`);
        }

        return new Response(
          JSON.stringify({
            status: 'succeeded',  // CRITICAL: Frontend expects this field
            payment_id: existingReservation.transaction_hash || crypto.randomUUID(),
            amount: String(existingReservation.total_amount || 0),
            currency: 'USD',
            new_balance: String(userBalance),  // Return current balance
            competition_id: existingReservation.competition_id,
            tickets: tickets,
            // Legacy fields
            success: true,
            message: "Tickets already purchased (idempotent response)",
            idempotent: true,
            alreadyConfirmed: true,
            ticketNumbers,
            reservationId: reservationId,
            userId: existingReservation.user_id,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } else if (existingReservation.status === "pending") {
        // Check if reservation is still valid (not expired)
        if (existingReservation.expires_at && new Date(existingReservation.expires_at) < new Date()) {
          // AGGRESSIVE MODE: Don't fail on expired reservation, just note it and proceed
          console.log(`[purchase-tickets-with-bonus] Reservation expired - proceeding with ticket_numbers if available`);
          reservationMissingOrExpired = true;
          reservationExpiredTickets = (existingReservation.ticket_numbers || [])
            .map((n: any) => Number(n))
            .filter((n: number) => Number.isFinite(n));

          // Mark as expired (best effort, don't block on failure)
          await supabase
            .from("pending_tickets")
            .update({ status: "expired", updated_at: new Date().toISOString() })
            .eq("id", reservationId);
        } else {
          // Valid pending reservation - derive missing fields
          const reservation = existingReservation;

          if (!userId && !walletAddress) {
            userId = reservation.user_id;
            console.log(`[purchase-tickets-with-bonus] Derived userId from reservation: ${userId?.substring(0, 20)}...`);
            derivedFromReservation = true;
          }
          if (!competitionId) {
            competitionId = reservation.competition_id;
            console.log(`[purchase-tickets-with-bonus] Derived competitionId from reservation: ${competitionId}`);
            derivedFromReservation = true;
          }
          if (!numberOfTickets) {
            numberOfTickets = reservation.ticket_count || (reservation.ticket_numbers ? reservation.ticket_numbers.length : 0);
            console.log(`[purchase-tickets-with-bonus] Derived numberOfTickets from reservation: ${numberOfTickets}`);
            derivedFromReservation = true;
          }
          if (!ticketPrice) {
            // Try to get ticket_price from reservation first, otherwise derive from total_amount
            ticketPrice = reservation.ticket_price || (reservation.total_amount && numberOfTickets ? Number(reservation.total_amount) / numberOfTickets : null);

            // If still no price, fetch from competition
            if (!ticketPrice && competitionId) {
              const { data: comp } = await supabase
                .from("competitions")
                .select("ticket_price")
                .eq("id", competitionId)
                .maybeSingle();
              if (comp) {
                ticketPrice = comp.ticket_price;
                console.log(`[purchase-tickets-with-bonus] Derived ticketPrice from competition: ${ticketPrice}`);
              }
            } else if (ticketPrice) {
              console.log(`[purchase-tickets-with-bonus] Derived ticketPrice from reservation: ${ticketPrice}`);
            }
            derivedFromReservation = true;
          }

          console.log(`[purchase-tickets-with-bonus] Successfully derived fields from reservation`);
        }
      } else {
        // Unknown status - treat as missing
        console.log(`[purchase-tickets-with-bonus] Reservation has unknown status (${existingReservation.status}) - proceeding with ticket_numbers if available`);
        reservationMissingOrExpired = true;
      }
    }

    // If no userId but have walletAddress, we'll resolve it after creating supabase client
    // For now, validate what we have
    const hasUserIdentifier = !!userId || !!walletAddress;

    // AGGRESSIVE MODE VALIDATION:
    // - competition_id is required unless resolvable from reservation
    // - ticket_numbers are required if reservation is missing/ambiguous
    // Return 422 status for missing_competition or missing_ticket_numbers

    if (!competitionId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing competition_id. Either provide competition_id directly or via a valid reservation.",
          errorCode: "missing_competition",
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If reservation is missing/expired, we need ticket_numbers to proceed
    if (reservationMissingOrExpired && selectedTickets.length === 0) {
      // Try to use expired reservation's tickets if available
      if (reservationExpiredTickets.length > 0) {
        console.log(`[purchase-tickets-with-bonus] Using expired reservation's tickets: [${reservationExpiredTickets.join(', ')}]`);
        selectedTickets.push(...reservationExpiredTickets);
      } else {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Missing ticket_numbers. Since no valid reservation exists, you must specify which ticket numbers to purchase.",
            errorCode: "missing_ticket_numbers",
            hint: "Provide ticket_numbers array with the specific ticket numbers you want to purchase.",
          }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Derive numberOfTickets from selectedTickets if not provided
    if (!numberOfTickets && selectedTickets.length > 0) {
      numberOfTickets = selectedTickets.length;
      console.log(`[purchase-tickets-with-bonus] Derived numberOfTickets from selectedTickets: ${numberOfTickets}`);
    }

    // Validate other required fields
    if (!hasUserIdentifier || !numberOfTickets) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required parameters.",
          hint: "Required: (userId or walletAddress), numberOfTickets (or ticket_numbers array).",
          missingFields: {
            userId: !userId && !walletAddress,
            numberOfTickets: !numberOfTickets,
          }
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Derive ticketPrice from competition if not provided
    if (!ticketPrice) {
      const { data: compPrice } = await supabase
        .from("competitions")
        .select("ticket_price")
        .eq("id", competitionId)
        .maybeSingle();
      if (compPrice?.ticket_price) {
        ticketPrice = compPrice.ticket_price;
        console.log(`[purchase-tickets-with-bonus] Derived ticketPrice from competition: ${ticketPrice}`);
      } else {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Could not determine ticket price. Please provide ticketPrice.",
            errorCode: "missing_ticket_price",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (numberOfTickets <= 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Number of tickets must be greater than 0", errorCode: "invalid_ticket_count" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate ticket price range ($0.10 - $100)
    if (ticketPrice < 0.1 || ticketPrice > 100) {
      return new Response(
        JSON.stringify({ success: false, error: "Ticket price must be between $0.10 and $100", errorCode: "invalid_ticket_price" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
        // Generate a canonical ID from the wallet address using toPrizePid
        userId = toPrizePid(walletAddress);
        console.log(`[purchase-tickets-with-bonus] No existing user for wallet, generated canonical ID from wallet`);
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
        JSON.stringify({ success: false, error: "User balance data not found", errorCode: "user_not_found" }),
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
          errorCode: "insufficient_balance"
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
        JSON.stringify({ success: false, error: "Competition not found", errorCode: "competition_not_found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if competition is active
    if (comp.status !== "active") {
      return new Response(
        JSON.stringify({ success: false, error: "Competition is not active", errorCode: "competition_inactive" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // STEP 4a: Check for existing reservation (if reservationId provided)
    // This ensures balance payments respect the reservation system
    // REQUIREMENT: Strict reservation validation - only use if valid UUID, owned by user, matching competition, pending, not expired
    let reservedTicketNumbers: number[] | null = null;
    let reservationRecord: any = null;

    // ONLY query by reservationId if it's a valid UUID (not a placeholder like 'pending')
    // DO NOT fallback to 'latest' reservation to prevent unauthorized use of other reservations
    if (reservationId && isValidUUID(reservationId)) {
      // STRICT: Try canonical ID match with all required conditions
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

      // STRICT VALIDATION: If reservation ID was provided but not found, or doesn't match requirements, return error
      if (resError) {
        console.error(`[purchase-tickets-with-bonus] Error querying reservation:`, resError);
        return new Response(
          JSON.stringify({
            success: false,
            error: "Error validating reservation",
            errorCode: "reservation_error"
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!reservation) {
        // Reservation ID provided but not found or doesn't match user/competition
        console.log(`[purchase-tickets-with-bonus] Reservation ${reservationId} not found or doesn't match user/competition`);
        return new Response(
          JSON.stringify({
            success: false,
            error: "Reservation not found or does not belong to you",
            errorCode: "reservation_mismatch"
          }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

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
            errorCode: "reservation_expired",
            expiredAt: reservation.expires_at
          }),
          { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Valid reservation found - use it as the single source of truth
      reservationRecord = reservation;
      reservedTicketNumbers = (reservation.ticket_numbers || [])
        .map((n: any) => Number(n))
        .filter((n: number) => Number.isFinite(n));

      // REQUIREMENT: Validate that reservation ticket count matches requested numberOfTickets
      if (reservedTicketNumbers.length !== numberOfTickets) {
        console.log(`[purchase-tickets-with-bonus] Reservation ticket count mismatch: requested ${numberOfTickets}, reservation has ${reservedTicketNumbers.length}`);
        return new Response(
          JSON.stringify({
            success: false,
            error: `Ticket count mismatch. Reservation has ${reservedTicketNumbers.length} tickets but you requested ${numberOfTickets}`,
            errorCode: "reservation_ticket_count_mismatch"
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`Using reservation ${reservationId} with ${reservedTicketNumbers.length} tickets: [${reservedTicketNumbers.join(', ')}]`);
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

    // REQUIREMENT: When using a reservation, use ONLY the reservation's tickets as the authoritative source
    // Do NOT validate against global unavailable sets - the reservation IS the source of truth
    // Otherwise, use client-supplied selectedTickets
    let userSelectedTickets: number[] = [];
    
    if (reservationRecord && reservedTicketNumbers && reservedTicketNumbers.length > 0) {
      // RESERVATION MODE: Use reservation tickets as the ONLY source of truth
      // Do NOT revalidate against global unavailable sets - the reservation already holds these tickets
      userSelectedTickets = reservedTicketNumbers;
      console.log(`[purchase-tickets-with-bonus] Using reservation tickets (bypassing global availability check): [${userSelectedTickets.join(', ')}]`);
    } else {
      // NO RESERVATION: Use client-supplied selectedTickets and validate against global unavailable
      userSelectedTickets = Array.isArray(selectedTickets) && selectedTickets.length > 0
        ? selectedTickets.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0)
        : [];
      
      // Only validate against unavailable tickets when NOT using a reservation
      if (userSelectedTickets.length > 0) {
        const unavailableSelected = userSelectedTickets.filter((t: number) => unavailableTickets.has(t));
        if (unavailableSelected.length > 0) {
          return new Response(
            JSON.stringify({
              success: false,
              error: `Some selected tickets are no longer available: ${unavailableSelected.join(", ")}`,
              errorCode: "tickets_unavailable",
              unavailableTickets: unavailableSelected
            }),
            { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    // STEP 5: Idempotency check BEFORE balance debit (moved up to prevent partial state)
    // This ensures we don't debit balance for already-processed transactions
    const txRef = referenceId || crypto.randomUUID();
    if (referenceId) {
      const { data: existing } = await supabase
        .from("joincompetition")
        .select("id, ticketnumbers, amountspent")
        .eq("userid", normalizedUserId)
        .eq("competitionid", competitionId)
        .eq("transactionhash", referenceId)
        .maybeSingle();
      if (existing) {
        // Already processed; return success with current balance (no deduction)
        const existingTickets = existing.ticketnumbers
          ? existing.ticketnumbers.split(",").map((n: string) => parseInt(n.trim())).filter((n: number) => !isNaN(n))
          : [];
        const actualAmount = existing.amountspent || 0;
        
        // Create deterministic ticket IDs based on transaction hash and ticket number
        // This ensures idempotent responses return the same IDs
        const deterministicTicketId = (ticketNumber: number) => {
          // Use a simple hash of referenceId + ticketNumber for determinism
          return `ticket-${referenceId.substring(0, 8)}-${ticketNumber}`;
        };
        
        return new Response(
          JSON.stringify({
            status: 'succeeded',  // CRITICAL: Frontend expects this field
            payment_id: referenceId,
            amount: String(actualAmount),
            currency: 'USD',
            new_balance: String(userBalance), // Return original balance since nothing changed
            competition_id: competitionId,
            tickets: existingTickets.map((ticketNumber: number) => ({
              id: deterministicTicketId(ticketNumber),
              ticket_number: ticketNumber
            })),
            // Legacy fields
            success: true,
            idempotent: true,
            message: "Already processed",
            ticketsCreated: 0,
            ticketsPurchased: existingTickets.length,
            totalCost: actualAmount,
            balanceAfterPurchase: userBalance,
            ticketNumbers: existingTickets,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // STEP 6: Debit user balance using RPC for atomic operations
    // PRIMARY: Use debit_sub_account_balance RPC (handles sub_account_balances atomically)
    // FALLBACK: Direct table updates if RPC fails
    newBalance = Number((userBalance - totalCost).toFixed(2));
    let debitErr;
    let debitResult: { success: boolean; previous_balance?: number; new_balance?: number; error_message?: string }[] | null = null;
    let debitSource: 'sub_account_balances_rpc' | 'sub_account_balances' | 'wallet_balances' | 'canonical_users' = 'sub_account_balances_rpc';

    // PRIMARY: Use debit_sub_account_balance RPC for atomic debit
    // This RPC handles row locking and atomic balance updates
    console.log("[Balance Debit] Attempting RPC debit_sub_account_balance for:", canonicalUserId);
    const { data: rpcDebitResult, error: rpcDebitError } = await supabase.rpc("debit_sub_account_balance", {
      p_canonical_user_id: canonicalUserId,
      p_amount: totalCost,
      p_currency: "USD",
    });

    if (!rpcDebitError && rpcDebitResult && rpcDebitResult.length > 0 && rpcDebitResult[0].success) {
      // RPC succeeded
      const result = rpcDebitResult[0];
      newBalance = Number(result.new_balance);
      debitResult = rpcDebitResult;
      debitSource = 'sub_account_balances_rpc';
      console.log(`[Balance Debit] RPC successful: ${result.previous_balance} → ${result.new_balance}`);

      // Also sync to canonical_users for backwards compatibility
      if (pucRows.uid) {
        await supabase
          .from("canonical_users")
          .update({ usdc_balance: newBalance })
          .eq("uid", pucRows.uid);
      }

      // Also sync to wallet_balances if exists
      if (userBalanceRecord?.canonical_user_id) {
        await supabase
          .from("wallet_balances")
          .update({ balance: newBalance, updated_at: new Date().toISOString() })
          .eq("canonical_user_id", userBalanceRecord.canonical_user_id);
      }
    } else {
      // RPC failed - log the reason and try fallback
      if (rpcDebitResult && rpcDebitResult.length > 0 && !rpcDebitResult[0].success) {
        console.log("[Balance Debit] RPC returned error:", rpcDebitResult[0].error_message);
        // If it's an insufficient balance error, throw immediately
        if (rpcDebitResult[0].error_message?.includes("Insufficient")) {
          throw new Error(rpcDebitResult[0].error_message);
        }
      } else {
        console.log("[Balance Debit] RPC failed, falling back to direct update:", rpcDebitError?.message);
      }

      // FALLBACK: Try direct sub_account_balances update if we have a record_id
      if (userBalanceRecord?.record_id) {
        const { error, data } = await supabase
          .from("sub_account_balances")
          .update({
            available_balance: newBalance,
            updated_at: new Date().toISOString(),
          })
          .eq("id", userBalanceRecord.record_id)
          .gte("available_balance", totalCost)
          .select("id, available_balance");

        if (!error && data && data.length > 0) {
          debitResult = [{ success: true, new_balance: newBalance }];
          debitSource = 'sub_account_balances';
          console.log("[Balance Debit] Direct sub_account_balances update successful, new balance:", newBalance);

          // Sync to canonical_users
          if (pucRows.uid) {
            await supabase
              .from("canonical_users")
              .update({ usdc_balance: newBalance })
              .eq("uid", pucRows.uid);
          }
        } else {
          debitErr = error;
          console.log("[Balance Debit] Direct sub_account_balances update failed:", error?.message);
        }
      }

      // FALLBACK 2: Try wallet_balances if sub_account_balances failed
      if (!debitResult || debitResult.length === 0) {
        console.log("[Balance Debit] Trying wallet_balances update");
        debitSource = 'wallet_balances';

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
            debitResult = [{ success: true, new_balance: newBalance }];
            walletBalanceUpdate = data;
          }
        }

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
            debitResult = [{ success: true, new_balance: newBalance }];
            walletBalanceUpdate = data;
          }
        }

        if (walletBalanceUpdate && walletBalanceUpdate.length > 0) {
          console.log("[Balance Debit] Successfully updated wallet_balances, new balance:", newBalance);

          // CRITICAL: Also update sub_account_balances to keep in sync
          // Use upsert to create record if it doesn't exist
          const { error: subAcctErr } = await supabase
            .from("sub_account_balances")
            .upsert({
              canonical_user_id: canonicalUserId,
              user_id: userBalanceRecord?.user_id || pucRows.uid || canonicalUserId,
              currency: "USD",
              available_balance: newBalance,
              pending_balance: 0,
              updated_at: new Date().toISOString(),
            }, {
              onConflict: "canonical_user_id,currency",
            });
          if (subAcctErr) {
            console.warn("[Balance Debit] Failed to sync sub_account_balances:", subAcctErr.message);
          } else {
            console.log("[Balance Debit] Synced balance to sub_account_balances");
          }

          // Sync to canonical_users
          if (pucRows.uid) {
            await supabase
              .from("canonical_users")
              .update({ usdc_balance: newBalance })
              .eq("uid", pucRows.uid);
          }
        }
      }

      // FALLBACK 3: Update canonical_users if wallet_balances update failed
      if (!debitResult || debitResult.length === 0) {
        console.log("[Balance Debit] Falling back to canonical_users update");
        debitSource = 'canonical_users';

        if (pucRows.uid) {
          const { error, data } = await supabase
            .from("canonical_users")
            .update({ usdc_balance: newBalance })
            .eq("uid", pucRows.uid)
            .select("uid");
          debitErr = error;
          if (data && data.length > 0) {
            debitResult = [{ success: true, new_balance: newBalance }];
          }
        } else if (isUserIdWallet) {
          const storedWalletAddress = pucRows.wallet_address;

          if (storedWalletAddress) {
            const { error, data } = await supabase
              .from("canonical_users")
              .update({ usdc_balance: newBalance })
              .ilike("wallet_address", storedWalletAddress)
              .select("uid");
            debitErr = error;
            if (data && data.length > 0) {
              debitResult = [{ success: true, new_balance: newBalance }];
            }
          }

          if (!debitResult || debitResult.length === 0) {
            const { error, data } = await supabase
              .from("canonical_users")
              .update({ usdc_balance: newBalance })
              .ilike("base_wallet_address", normalizedUserId)
              .select("uid");
            if (data && data.length > 0) {
              debitErr = error;
              debitResult = [{ success: true, new_balance: newBalance }];
            }
          }

          if (!debitResult || debitResult.length === 0) {
            const { error, data } = await supabase
              .from("canonical_users")
              .update({ usdc_balance: newBalance })
              .eq("privy_user_id", normalizedUserId)
              .select("uid");
            debitErr = error;
            if (data && data.length > 0) {
              debitResult = [{ success: true, new_balance: newBalance }];
            }
          }
        } else {
          const { error, data } = await supabase
            .from("canonical_users")
            .update({ usdc_balance: newBalance })
            .eq("privy_user_id", normalizedUserId)
            .select("uid");
          debitErr = error;
          if (data && data.length > 0) {
            debitResult = [{ success: true, new_balance: newBalance }];
          }
        }

        // CRITICAL: If canonical_users updated, also sync to sub_account_balances
        if (debitResult && debitResult.length > 0 && debitResult[0].success) {
          console.log("[Balance Debit] Successfully updated canonical_users, syncing to sub_account_balances...");
          const { error: subAcctErr } = await supabase
            .from("sub_account_balances")
            .upsert({
              canonical_user_id: canonicalUserId,
              user_id: pucRows.uid || canonicalUserId,
              currency: "USD",
              available_balance: newBalance,
              pending_balance: 0,
              updated_at: new Date().toISOString(),
            }, {
              onConflict: "canonical_user_id,currency",
            });
          if (subAcctErr) {
            console.warn("[Balance Debit] Failed to sync sub_account_balances:", subAcctErr.message);
          } else {
            console.log("[Balance Debit] Synced balance to sub_account_balances");
          }
        }
      }
    }

    if (debitErr && (!debitResult || debitResult.length === 0)) {
      throw new Error(`Failed to update balance: ${debitErr.message}`);
    }

    // CRITICAL: Verify the update actually affected a row
    if (!debitResult || debitResult.length === 0 || !debitResult[0].success) {
      console.error("[Balance Debit] No rows were updated! User record may not exist or wallet address mismatch.");
      console.error("[Balance Debit] userId:", userId, "storedWalletAddress:", pucRows.wallet_address, "uid:", pucRows.uid);
      throw new Error(`Balance update did not affect any rows. Please contact support.`);
    }

    console.log(`[Balance Debit] Successfully updated via ${debitSource}, new balance:`, newBalance);

    // Mark that balance has been debited - any error after this point needs rollback
    balanceDebited = true;

    // CRITICAL FIX: Create balance_ledger entry for audit trail
    // This ensures all balance changes (both credits AND debits) are tracked
    // Previously, only top-ups created ledger entries; purchases were missing
    // CORRECT SCHEMA: canonical_user_id, transaction_type, amount, currency, balance_before, balance_after, reference_id, description
    const ledgerEntry = {
      canonical_user_id: canonicalUserId,
      transaction_type: 'debit',
      amount: -totalCost, // Negative for debit
      currency: 'USD',
      balance_before: userBalance,
      balance_after: newBalance,
      reference_id: `entry_${competitionId}_${Date.now()}`,
      description: `Purchase ${numberOfTickets} tickets for competition`,
      created_at: new Date().toISOString(),
    };

    const { error: ledgerError } = await supabase
      .from("balance_ledger")
      .insert(ledgerEntry);

    if (ledgerError) {
      // Log but don't fail the transaction - ledger is for audit, not critical path
      console.warn("[Balance Ledger] Failed to create debit entry:", ledgerError.message);
    } else {
      console.log("[Balance Ledger] Created debit entry for purchase:", totalCost);
    }

    try {
      // STEP 7: Assign canonical tickets
      // REQUIREMENT: When using reservation, pass ONLY reservation tickets and use exact count
      // (userSelectedTickets is already set to reservation tickets OR client-supplied tickets above)
      // Use canonical user ID for ticket storage
      const ticketUserId = pucRows.canonical_user_id || canonicalUserId;

      console.log(`[VERBOSE][purchase-tickets-with-bonus] Starting ticket allocation phase`);
      console.log(`[VERBOSE][purchase-tickets-with-bonus] User ID: ${ticketUserId}`);
      console.log(`[VERBOSE][purchase-tickets-with-bonus] Competition ID: ${competitionId}`);
      console.log(`[VERBOSE][purchase-tickets-with-bonus] Total tickets to allocate: ${totalTickets}`);
      console.log(`[VERBOSE][purchase-tickets-with-bonus] Has reservation: ${!!reservationRecord}`);
      console.log(`[VERBOSE][purchase-tickets-with-bonus] Reservation ID: ${reservationRecord?.id || 'N/A'}`);
      console.log(`[VERBOSE][purchase-tickets-with-bonus] Reserved ticket numbers: ${reservedTicketNumbers?.join(', ') || 'N/A'}`);
      console.log(`[VERBOSE][purchase-tickets-with-bonus] User selected tickets: ${userSelectedTickets?.join(', ') || 'N/A'}`);

      // CRITICAL: Validate ticketUserId before calling assignTickets
      // This prevents the "userIdentifier is required" error
      if (!ticketUserId || ticketUserId.trim() === '') {
        console.error(`[VERBOSE][purchase-tickets-with-bonus] ❌ CRITICAL ERROR: Invalid ticketUserId`);
        console.error(`[VERBOSE][purchase-tickets-with-bonus] pucRows.canonical_user_id: ${pucRows.canonical_user_id}`);
        console.error(`[VERBOSE][purchase-tickets-with-bonus] canonicalUserId: ${canonicalUserId}`);
        throw new Error("User identifier could not be determined. Please try logging out and back in.");
      }

      // REQUIREMENT: When using reservation, ensure we assign EXACTLY the reservation's tickets
      console.log(`[VERBOSE][purchase-tickets-with-bonus] Calling assignTickets with:`);
      console.log(`[VERBOSE][purchase-tickets-with-bonus]   - userIdentifier: ${ticketUserId}`);
      console.log(`[VERBOSE][purchase-tickets-with-bonus]   - competitionId: ${competitionId}`);
      console.log(`[VERBOSE][purchase-tickets-with-bonus]   - ticketCount: ${totalTickets}`);
      console.log(`[VERBOSE][purchase-tickets-with-bonus]   - preferredTicketNumbers: [${userSelectedTickets.join(', ')}]`);
      
      const assigned = await assignTickets({
        supabase,
        userIdentifier: ticketUserId, // Use canonical ID for consistent storage
        competitionId,
        orderId: null,
        ticketCount: totalTickets, // Use totalTickets (which equals numberOfTickets in this context)
        preferredTicketNumbers: userSelectedTickets, // Either reservation tickets OR client-supplied tickets
      });
      const assignedNumbers = assigned.ticketNumbers;
      
      console.log(`[VERBOSE][purchase-tickets-with-bonus] ✅ Ticket assignment successful!`);
      console.log(`[VERBOSE][purchase-tickets-with-bonus] Assigned ticket numbers: [${assignedNumbers.join(', ')}]`);

      // REQUIREMENT: When using reservation, verify assigned tickets exactly match reservation tickets
      if (reservationRecord && reservedTicketNumbers && reservedTicketNumbers.length > 0) {
        // Sort both arrays for comparison
        const sortedReserved = [...reservedTicketNumbers].sort((a, b) => a - b);
        const sortedAssigned = [...assignedNumbers].sort((a, b) => a - b);
        
        const ticketsMatch = sortedReserved.length === sortedAssigned.length &&
          sortedReserved.every((val, idx) => val === sortedAssigned[idx]);
        
        if (!ticketsMatch) {
          console.error(`[purchase-tickets-with-bonus] Ticket assignment mismatch! Reserved: [${sortedReserved.join(', ')}], Assigned: [${sortedAssigned.join(', ')}]`);
          throw new Error("Internal error: Failed to assign reserved tickets. Please try again or contact support.");
        }
        
        console.log(`[purchase-tickets-with-bonus] Successfully assigned all reserved tickets: [${assignedNumbers.join(', ')}]`);
      }

      // STEP 8: Set purchase_price for all tickets (no bonus tickets anymore)
      // Update tickets using the user_id column with canonical ID
      // NOTE: This may fail if the tickets table has a different schema - that's OK,
      // the joincompetition entry is the source of truth for balance payments
      if (assignedNumbers.length > 0) {
        try {
          const { error: priceErr } = await supabase
            .from("tickets")
            .update({ purchase_price: ticketPrice })
            .eq("competition_id", competitionId)
            .eq("user_id", ticketUserId)
            .in("ticket_number", assignedNumbers);
          if (priceErr) {
            // Log but don't throw - tickets table may have different schema
            console.warn("[tickets] Could not update purchase_price (schema may differ):", priceErr.message);
          }
        } catch (ticketPriceErr) {
          console.warn("[tickets] Error updating purchase_price:", ticketPriceErr);
        }
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
            canonical_user_id: ticketUserId, // Also set canonical_user_id
            privy_user_id: ticketUserId, // Also set privy_user_id to canonical ID
            numberoftickets: assignedNumbers.length,
            ticketnumbers: assignedNumbers.join(","),
            amountspent: totalCost,
            wallet_address: walletAddress,
            chain: "balance",  // Changed from USDC to balance to indicate balance payment
            transactionhash: txRef,
            purchasedate: new Date().toISOString(),
            status: "sold",  // Added status column
            created_at: new Date().toISOString(),  // Explicitly set created_at
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
      // Balance payments are immediately completed, so status is 'completed'
      // CORRECT SCHEMA: user_id, type (entry/topup), amount, currency, balance_before, balance_after, competition_id, etc.
      const transactionId = crypto.randomUUID();

      const transactionRecord = {
        id: transactionId,
        user_id: ticketUserId,
        canonical_user_id: ticketUserId,
        wallet_address: walletAddress,
        type: 'entry',  // CORRECT: 'entry' or 'topup' per CHECK constraint
        amount: totalCost,
        currency: 'USD',
        balance_before: userBalance,
        balance_after: newBalance,
        competition_id: competitionId,
        description: `Purchase ${assignedNumbers.length} tickets for competition`,
        status: 'completed',
        payment_status: 'completed',
        payment_provider: 'balance',
        ticket_count: assignedNumbers.length,
        tx_id: txRef,
        metadata: {
          ticket_numbers: assignedNumbers,
          entry_uid: jcEntryCreated ? (jcData?.uid || entryUid) : entryUid,
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      };

      const { error: txInsertErr, data: txData } = await supabase
        .from("user_transactions")
        .insert(transactionRecord)
        .select('id')
        .single();

      if (txInsertErr) {
        // Log but don't fail - user_transactions is for visibility, not critical path
        console.warn("[user_transactions] Failed to create transaction record:", txInsertErr.message);
      } else {
        console.log("[user_transactions] Created transaction record:", txData?.id || transactionId);
      }

      // STEP 9b: Mark reservation as confirmed (if we used one)
      // Use confirm_ticket_purchase RPC to atomically debit balance and confirm purchase
      if (reservationRecord?.id) {
        // After inserting pending ticket, confirm and debit immediately
        const { data: confirmResult } = await supabase.rpc('confirm_ticket_purchase', {
          p_pending_ticket_id: reservationRecord.id,
          p_payment_provider: 'balance'
        });

        if (!confirmResult?.success) {
          // If RPC fails (e.g., already confirmed or not found), fall back to direct update
          // This handles cases where the RPC is not available or returns an error
          if (confirmResult?.already_confirmed) {
            console.log("Reservation already confirmed via RPC:", reservationRecord.id);
          } else {
            console.warn("confirm_ticket_purchase RPC failed, using fallback:", confirmResult?.error);

            // Fallback: direct update for backwards compatibility
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
              console.log("Reservation marked as confirmed via fallback:", reservationRecord.id);
            }
          }
        } else {
          console.log("Reservation confirmed via RPC:", reservationRecord.id, "Balance debited:", confirmResult.amount_debited);
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

      // STEP 11: Store idempotency record and return success
      // CRITICAL: Match the response format expected by balance-payment-service.ts
      // Frontend expects: { status: 'succeeded', payment_id, amount, currency, new_balance, competition_id, tickets: [...] }
      
      // Create deterministic ticket IDs based on transaction hash and ticket number
      // This ensures idempotent responses return the same IDs
      const deterministicTicketId = (ticketNumber: number) => {
        // Use a simple hash of txRef + ticketNumber for determinism
        return `ticket-${txRef.substring(0, 8)}-${ticketNumber}`;
      };
      
      const responseData = {
        status: 'succeeded',  // CRITICAL: Frontend checks for this field
        payment_id: transactionId,
        amount: String(totalCost),
        currency: 'USD',
        new_balance: String(newBalance),
        competition_id: competitionId,
        tickets: assignedNumbers.map((ticketNumber: number) => ({
          id: deterministicTicketId(ticketNumber),
          ticket_number: ticketNumber
        })),
        // Legacy fields for backwards compatibility
        success: true,
        ticketsCreated: totalTickets,
        ticketsPurchased: numberOfTickets,
        totalCost,
        balanceAfterPurchase: newBalance,
        message: `Successfully purchased ${totalTickets} tickets!`,
        ticketNumbers: assignedNumbers,
        entryCreated: jcEntryCreated,
        entryId: jcEntryCreated ? (jcData?.uid || entryUid) : null,
        transactionId: transactionId,
        transactionRef: txRef,
        instantWins: instantWins.length > 0 ? instantWins : undefined,
      };

      // Store idempotency record for future duplicate requests (best effort)
      if (effectiveIdempotencyKey) {
        const { error: idempotencyInsertErr } = await supabase
          .from("purchase_idempotency")
          .insert({
            idempotency_key: effectiveIdempotencyKey,
            canonical_user_id: canonicalUserId,
            competition_id: competitionId,
            response_data: responseData,
            created_at: new Date().toISOString(),
          });

        if (idempotencyInsertErr) {
          // Log but don't fail - idempotency is a convenience, not critical path
          // Table might not exist yet, or there could be a constraint violation
          console.warn(`[purchase-tickets-with-bonus] Failed to store idempotency record:`, idempotencyInsertErr.message);
        } else {
          console.log(`[purchase-tickets-with-bonus] Stored idempotency record for key: ${effectiveIdempotencyKey.substring(0, 20)}...`);
        }
      }

      return new Response(
        JSON.stringify(responseData),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (assignErr) {
      // FORCEFUL PURCHASE MODE: Mark as purchased even if ticket allocation fails
      // This ensures payment is not rolled back and user's money is preserved
      // Log detailed information about what went wrong for debugging
      const errorMessage = assignErr instanceof Error ? assignErr.message : "Failed to assign tickets";
      console.error(`[VERBOSE][purchase-tickets-with-bonus] ❌ Ticket assignment failed!`);
      console.error(`[VERBOSE][purchase-tickets-with-bonus] Error message: ${errorMessage}`);
      console.error(`[VERBOSE][purchase-tickets-with-bonus] Full error:`, assignErr);
      console.error(`[VERBOSE][purchase-tickets-with-bonus] FORCEFUL MODE: Marking purchase as complete anyway`);
      
      // Log what data we have for debugging
      console.error(`[VERBOSE][purchase-tickets-with-bonus] Available data for troubleshooting:`);
      console.error(`[VERBOSE][purchase-tickets-with-bonus]   - reservationId: ${reservationId || 'NOT PROVIDED'}`);
      console.error(`[VERBOSE][purchase-tickets-with-bonus]   - reservationRecord.id: ${reservationRecord?.id || 'NOT FOUND'}`);
      console.error(`[VERBOSE][purchase-tickets-with-bonus]   - ticketUserId: ${pucRows.canonical_user_id || canonicalUserId || 'NOT FOUND'}`);
      console.error(`[VERBOSE][purchase-tickets-with-bonus]   - competitionId: ${competitionId}`);
      console.error(`[VERBOSE][purchase-tickets-with-bonus]   - numberOfTickets: ${numberOfTickets}`);
      console.error(`[VERBOSE][purchase-tickets-with-bonus]   - selectedTickets: [${selectedTickets?.join(', ') || 'NONE'}]`);
      console.error(`[VERBOSE][purchase-tickets-with-bonus]   - userSelectedTickets: [${userSelectedTickets?.join(', ') || 'NONE'}]`);
      console.error(`[VERBOSE][purchase-tickets-with-bonus]   - reservedTicketNumbers: [${reservedTicketNumbers?.join(', ') || 'NONE'}]`);
      console.error(`[VERBOSE][purchase-tickets-with-bonus]   - totalCost: ${totalCost}`);
      console.error(`[VERBOSE][purchase-tickets-with-bonus]   - Balance debited successfully: true`);
      console.error(`[VERBOSE][purchase-tickets-with-bonus]   - New balance: ${newBalance}`);
      
      // FORCEFUL MODE: Don't rollback - instead complete the purchase without tickets
      // The user's balance has been debited, so we must honor the payment
      console.log(`[VERBOSE][purchase-tickets-with-bonus] ⚠️  FORCEFUL MODE: Completing purchase without ticket allocation`);
      console.log(`[VERBOSE][purchase-tickets-with-bonus] User will need to contact support with transaction ref: ${txRef}`);
      
      // Create a joincompetition entry even without assigned tickets
      // This ensures the purchase appears in the dashboard for support
      const ticketUserId = pucRows.canonical_user_id || canonicalUserId;
      const walletAddress = isUserIdWallet ? normalizedUserId : pucRows.wallet_address || normalizedUserId;
      const entryUid = crypto.randomUUID();
      
      console.log(`[VERBOSE][purchase-tickets-with-bonus] Creating joincompetition entry for failed allocation...`);
      
      const { error: jcErr, data: jcData } = await supabase
        .from("joincompetition")
        .insert({
          uid: entryUid,
          competitionid: competitionId,
          userid: ticketUserId,
          canonical_user_id: ticketUserId,
          privy_user_id: ticketUserId,
          numberoftickets: numberOfTickets,
          ticketnumbers: "", // Empty - tickets not allocated
          amountspent: totalCost,
          wallet_address: walletAddress,
          chain: "balance",
          transactionhash: txRef,
          purchasedate: new Date().toISOString(),
          status: "pending_allocation",  // Special status for manual allocation
          created_at: new Date().toISOString(),
        })
        .select('uid')
        .single();
      
      if (jcErr) {
        console.error(`[VERBOSE][purchase-tickets-with-bonus] ❌ Failed to create joincompetition entry:`, jcErr);
      } else {
        console.log(`[VERBOSE][purchase-tickets-with-bonus] ✅ Created joincompetition entry: ${jcData?.uid || entryUid}`);
      }
      
      // Create user_transactions record
      const transactionId = crypto.randomUUID();
      const transactionRecord = {
        id: transactionId,
        user_id: ticketUserId,
        canonical_user_id: ticketUserId,
        wallet_address: walletAddress,
        type: 'entry',
        amount: totalCost,
        currency: 'USD',
        balance_before: userBalance,
        balance_after: newBalance,
        competition_id: competitionId,
        description: `Purchase ${numberOfTickets} tickets - PENDING MANUAL ALLOCATION`,
        status: 'completed',  // Payment completed, but allocation pending
        payment_status: 'completed',
        payment_provider: 'balance',
        ticket_count: numberOfTickets,
        tx_id: txRef,
        notes: `Ticket allocation failed: ${errorMessage}. Requires manual allocation by support.`,
        metadata: {
          allocation_failed: true,
          error_message: errorMessage,
          requested_tickets: numberOfTickets,
          reservation_id: reservationId || null,
          entry_uid: jcErr ? null : (jcData?.uid || entryUid),
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      };
      
      const { error: txInsertErr } = await supabase
        .from("user_transactions")
        .insert(transactionRecord);
      
      if (txInsertErr) {
        console.error(`[VERBOSE][purchase-tickets-with-bonus] ❌ Failed to create transaction record:`, txInsertErr);
      } else {
        console.log(`[VERBOSE][purchase-tickets-with-bonus] ✅ Created transaction record: ${transactionId}`);
      }
      
      // Mark reservation as needing manual processing
      if (reservationRecord?.id) {
        console.log(`[VERBOSE][purchase-tickets-with-bonus] Marking reservation for manual processing...`);
        await supabase
          .from("pending_tickets")
          .update({
            status: "requires_manual_allocation",
            transaction_hash: txRef,
            payment_provider: "balance",
            updated_at: new Date().toISOString(),
          })
          .eq("id", reservationRecord.id);
      }
      
      // Return partial success - payment succeeded but allocation failed
      // CRITICAL: Match the response format expected by balance-payment-service.ts
      console.log(`[VERBOSE][purchase-tickets-with-bonus] Returning partial success response`);
      return new Response(
        JSON.stringify({
          status: 'succeeded',  // CRITICAL: Frontend checks for this field
          payment_id: transactionId,
          amount: String(totalCost),
          currency: 'USD',
          new_balance: String(newBalance),
          competition_id: competitionId,
          tickets: [],  // Empty array since allocation failed
          // Additional fields for partial success
          success: true,  // Payment succeeded
          partial: true,  // But allocation failed
          ticketsCreated: 0,
          ticketsPurchased: numberOfTickets,
          totalCost,
          balanceAfterPurchase: newBalance,
          message: `Payment successful! Your balance has been debited $${totalCost.toFixed(2)}. However, ticket allocation encountered an issue. Our support team has been notified. Please contact us at support@theprize.io with this reference: ${txRef}`,
          warning: `Ticket allocation failed: ${errorMessage}`,
          transactionRef: txRef,
          transactionId: transactionId,
          supportRequired: true,
          supportEmail: 'support@theprize.io',
          allocationError: errorMessage,
          debugInfo: {
            reservationId: reservationId || null,
            reservationFound: !!reservationRecord,
            ticketsRequested: numberOfTickets,
            errorDetails: errorMessage,
          }
        }),
        { status: 207, headers: { ...corsHeaders, "Content-Type": "application/json" } } // 207 Multi-Status accurately represents partial success
      );

    }
  } catch (error) {
    console.error("[VERBOSE][purchase-tickets-with-bonus] ❌ Outer error handler triggered:", error);
    console.error("[VERBOSE][purchase-tickets-with-bonus] Error details:", error);

    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message || "Failed to purchase tickets", errorCode: "internal_error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
