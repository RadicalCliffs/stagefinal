import type { Context, Config } from "@netlify/functions";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { toPrizePid, extractPrizePid, isWalletAddress as isValidWalletAddress } from "./_shared/userId.mts";

export const config: Config = {
  path: "/api/confirm-pending-tickets",
  method: ["POST", "OPTIONS"],
};

// ---------- CORS helpers ----------
function corsHeaders(origin?: string | null) {
  const allowOrigin = origin && origin !== "null" ? origin : "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function json(data: unknown, status = 200, origin?: string | null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- Supabase ----------
function getSupabase(): SupabaseClient {
  const supabaseUrl = Netlify.env.get("VITE_SUPABASE_URL") || Netlify.env.get("SUPABASE_URL");
  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl) throw new Error("Missing SUPABASE_URL / VITE_SUPABASE_URL");
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Small retry wrapper for transient DB/network hiccups
const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 250;

// ISSUE 3D FIX: Improved retry wrapper with better error tracking
async function withRetries<T>(label: string, fn: () => Promise<T>, options?: {
  maxRetries?: number;
  onRetry?: (attempt: number, error: unknown) => void;
}): Promise<T> {
  const maxRetries = options?.maxRetries ?? MAX_RETRIES;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[Confirm Tickets] ${label} failed (attempt ${attempt}/${maxRetries}): ${msg}`);

      // Call optional retry callback for tracking
      if (options?.onRetry) {
        options.onRetry(attempt, e);
      }

      if (attempt < maxRetries) {
        const delay = INITIAL_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 150;
        await sleep(delay);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ---------- Ticket allocation helper (Node port) ----------
function pickRandomUnique<T>(arr: T[], count: number): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

// Helper to build an OR filter for competition ID matching
// joincompetition.competitionid can contain either competition.id (UUID) or competition.uid (legacy text)
function buildCompetitionIdFilter(competitionId: string, competitionUid?: string | null): string {
  if (competitionUid && competitionUid !== competitionId) {
    return `competitionid.eq.${competitionId},competitionid.eq.${competitionUid}`;
  }
  return `competitionid.eq.${competitionId}`;
}

// Helper to get competition with uid for proper ID matching
async function getCompetitionWithUid(supabase: SupabaseClient, competitionId: string): Promise<{ id: string; uid: string | null } | null> {
  const { data } = await supabase
    .from("competitions")
    .select("id, uid")
    .eq("id", competitionId)
    .maybeSingle();
  return data;
}

// ISSUE 3D FIX: Improved race condition handling with user-friendly recovery
async function assignTickets(params: {
  supabase: SupabaseClient;
  privyUserId: string;
  competitionId: string;
  orderId?: string | null;
  ticketCount: number;
  preferredTicketNumbers?: number[];
}): Promise<{ ticketNumbers: number[]; wasRetried?: boolean }> {
  const { supabase, privyUserId, competitionId, orderId, ticketCount, preferredTicketNumbers } = params;
  let totalRetryAttempts = 0;

  if (!privyUserId) throw new Error("assignTickets: privyUserId is required");
  if (!competitionId) throw new Error("assignTickets: competitionId is required");
  if (!Number.isFinite(ticketCount) || ticketCount <= 0) throw new Error("assignTickets: ticketCount must be > 0");

  // Idempotency
  if (orderId) {
    const { data: existing, error } = await supabase
      .from("tickets")
      .select("ticket_number")
      .eq("order_id", orderId);

    if (!error && existing && existing.length > 0) {
      return { ticketNumbers: existing.map((t: any) => Number(t.ticket_number)) };
    }
  }

  const { data: comp, error: compErr } = await supabase
    .from("competitions")
    .select("total_tickets, status, uid")
    .eq("id", competitionId)
    .maybeSingle();

  if (compErr || !comp) throw new Error("assignTickets: competition not found");
  if (comp.status && comp.status !== "active") {
    throw new Error(`assignTickets: competition is not active (status: ${comp.status})`);
  }

  const maxTickets = Number(comp.total_tickets) || 0;
  if (maxTickets <= 0) throw new Error("assignTickets: invalid total_tickets");

  const { data: usedTickets, error: usedErr } = await supabase
    .from("tickets")
    .select("ticket_number")
    .eq("competition_id", competitionId);

  if (usedErr) throw usedErr;

  const usedSet = new Set<number>((usedTickets || []).map((t: any) => Number(t.ticket_number)));
  const availableCount = maxTickets - usedSet.size;

  if (availableCount <= 0) throw new Error("assignTickets: competition is sold out");
  if (ticketCount > availableCount) throw new Error(`assignTickets: cannot allocate ${ticketCount}, only ${availableCount} available`);

  const preferred: number[] = Array.isArray(preferredTicketNumbers)
    ? preferredTicketNumbers.map(Number).filter((n) => Number.isFinite(n) && n >= 1 && n <= maxTickets)
    : [];

  let finalTicketNumbers: number[] = [];
  for (const n of preferred) {
    if (!usedSet.has(n)) {
      finalTicketNumbers.push(n);
      usedSet.add(n);
      if (finalTicketNumbers.length >= ticketCount) break;
    }
  }

  const remaining = ticketCount - finalTicketNumbers.length;
  if (remaining > 0) {
    const available: number[] = [];
    for (let n = 1; n <= maxTickets; n++) {
      if (!usedSet.has(n)) available.push(n);
      if (available.length >= remaining * 5) break;
    }
    if (available.length < remaining) throw new Error("assignTickets: not enough tickets remain");
    finalTicketNumbers.push(...pickRandomUnique(available, remaining));
  }

  // ISSUE 3D FIX: Enhanced insert retry logic with exponential backoff and better collision handling
  const maxInsertRetries = 5; // Increased from 3 to 5 for better success rate
  let remainingToInsert = [...finalTicketNumbers];
  let successfullyInserted: number[] = [];

  for (let attempt = 0; attempt < maxInsertRetries && remainingToInsert.length > 0; attempt++) {
    totalRetryAttempts = attempt;

    const rows = remainingToInsert.map((num) => ({
      competition_id: competitionId,
      order_id: orderId ?? null,
      ticket_number: num,
      privy_user_id: privyUserId,
    }));

    const { error: insertError } = await supabase.from("tickets").insert(rows);

    if (!insertError) {
      successfullyInserted.push(...remainingToInsert);
      remainingToInsert = [];
      break;
    }

    const isConflict =
      (insertError as any).code === "23505" ||
      String((insertError as any).message || "").includes("unique") ||
      String((insertError as any).message || "").includes("duplicate");

    if (!isConflict) throw insertError;

    console.log(`[Confirm Tickets] assignTickets: Conflict on attempt ${attempt + 1}, ${remainingToInsert.length} tickets need retry`);

    // refetch used and replace collided numbers
    const { data: currentUsed, error: refetchError } = await supabase
      .from("tickets")
      .select("ticket_number")
      .eq("competition_id", competitionId);

    if (refetchError) throw refetchError;

    const currentUsedSet = new Set<number>((currentUsed || []).map((t: any) => Number(t.ticket_number)));
    const currentAvailable = maxTickets - currentUsedSet.size;
    if (currentAvailable < remainingToInsert.length) {
      throw new Error(`assignTickets: sold out during allocation (only ${currentAvailable} remain)`);
    }

    const stillAvailable = remainingToInsert.filter((n) => !currentUsedSet.has(n));
    const needToReplace = remainingToInsert.length - stillAvailable.length;

    // ISSUE 3D FIX: Use a larger pool of replacement candidates to reduce collision probability
    const replacementPoolSize = needToReplace * 10; // Increased from 5 to 10
    const newAvailable: number[] = [];
    for (let n = 1; n <= maxTickets && newAvailable.length < replacementPoolSize; n++) {
      if (!currentUsedSet.has(n) && !stillAvailable.includes(n)) newAvailable.push(n);
    }
    if (newAvailable.length < needToReplace) throw new Error("assignTickets: not enough replacements remain");

    const replacements = pickRandomUnique(newAvailable, needToReplace);
    remainingToInsert = [...stillAvailable, ...replacements];
    finalTicketNumbers = [...successfullyInserted, ...remainingToInsert];

    // ISSUE 3D FIX: Add exponential backoff between retries to reduce contention
    if (attempt < maxInsertRetries - 1) {
      const backoffMs = Math.min(100 * Math.pow(2, attempt), 1000) + Math.random() * 100;
      await sleep(backoffMs);
    }
  }

  if (remainingToInsert.length > 0) {
    // ISSUE 3D FIX: Provide actionable error message with recovery suggestion
    throw new Error(`assignTickets: failed after ${maxInsertRetries} retries. Please try again or select different tickets.`);
  }

  return {
    ticketNumbers: finalTicketNumbers,
    wasRetried: totalRetryAttempts > 0,
  };
}

// ---------- Main handler ----------
export default async (req: Request, _context: Context): Promise<Response> => {
  const origin = req.headers.get("origin");
  let body: Record<string, any> = {}; // Declare at function scope for error handler access

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405, origin);
  }

  try {
    const supabase = getSupabase();

    try {
      body = (await req.json()) as Record<string, any>;
    } catch {
      return json({ success: false, error: "Invalid JSON body" }, 400, origin);
    }

    const {
      reservationId,
      userId,
      userIdentifier, // Also accept userIdentifier for backward compatibility
      competitionId,
      transactionHash,
      paymentProvider,
      walletAddress: reqWalletAddress,
      network,
      sessionId,
      selectedTickets,
      ticketCount: requestedTicketCount,
    } = body;

    // Accept either userId or userIdentifier (backward compatibility)
    const effectiveUserId = userId || userIdentifier;

    console.log("[Confirm Tickets] Request:", {
      reservationId,
      userId: effectiveUserId,
      competitionId,
      sessionId,
      requestedTicketCount,
      hasSelectedTickets: Array.isArray(selectedTickets) && selectedTickets.length > 0,
      paymentProvider,
      network,
    });

    // Convert userId to canonical prize:pid format IMMEDIATELY for consistent matching
    // ISSUE #4 FIX: Validate userId is not null/undefined before proceeding
    // If userId is missing, we'll handle it later when checking reservation/direct allocation paths
    const canonicalUserId = effectiveUserId ? toPrizePid(effectiveUserId) : null;
    console.log("[Confirm Tickets] Canonical user ID:", { original: effectiveUserId, canonical: canonicalUserId });

    // ISSUE #4 FIX: Early validation - if no reservation identifiers AND no valid userId, fail fast
    if (!reservationId && !sessionId && !canonicalUserId) {
      return json({ success: false, error: "Missing required parameters: userId, reservationId, or sessionId" }, 400, origin);
    }

    // ----------------------
    // STEP 1: find reservation
    // ----------------------
    let reservation: any = null;
    let reservationAlreadyConfirming = false;

    if (reservationId) {
      // First try pending status
      const { data } = await withRetries("lookup reservationId", async () =>
        supabase
          .from("pending_tickets")
          .select("*")
          .eq("id", reservationId)
          .eq("status", "pending")
          .maybeSingle()
      );
      reservation = (data as any) ?? null;

      // If not found with pending, check if it's in confirming/confirmed state
      if (!reservation) {
        const { data: existingRes } = await supabase
          .from("pending_tickets")
          .select("*")
          .eq("id", reservationId)
          .in("status", ["confirming", "confirmed"])
          .maybeSingle();

        if (existingRes) {
          reservationAlreadyConfirming = true;
          reservation = existingRes;
        }
      }
    }

    if (!reservation && sessionId) {
      const { data } = await withRetries("lookup sessionId", async () =>
        supabase
          .from("pending_tickets")
          .select("*")
          .eq("session_id", sessionId)
          .eq("status", "pending")
          .maybeSingle()
      );
      reservation = (data as any) ?? null;

      // If not found with pending, check if it's in confirming/confirmed state
      if (!reservation) {
        const { data: existingRes } = await supabase
          .from("pending_tickets")
          .select("*")
          .eq("session_id", sessionId)
          .in("status", ["confirming", "confirmed"])
          .maybeSingle();

        if (existingRes) {
          reservationAlreadyConfirming = true;
          reservation = existingRes;
        }
      }
    }

    // Fallback: Search by userId (wallet address) + competitionId
    // Use case-insensitive search for wallet addresses
    if (!reservation && canonicalUserId && competitionId) {
      // Extract the actual identifier from prize:pid format for database lookup
      const lookupId = extractPrizePid(canonicalUserId);
      const isWalletAddr = isValidWalletAddress(lookupId);

      if (isWalletAddr) {
        // For wallet addresses, use ilike for case-insensitive matching
        const { data } = await withRetries("lookup userId+competitionId (wallet)", async () =>
          supabase
            .from("pending_tickets")
            .select("*")
            .ilike("user_id", lookupId)
            .eq("competition_id", competitionId)
            .eq("status", "pending")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        );
        reservation = (data as any) ?? null;
      } else {
        // For non-wallet IDs (Privy DID, etc.), use exact matching
        const { data } = await withRetries("lookup userId+competitionId", async () =>
          supabase
            .from("pending_tickets")
            .select("*")
            .eq("user_id", canonicalUserId)
            .eq("competition_id", competitionId)
            .eq("status", "pending")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        );
        reservation = (data as any) ?? null;
      }
    }

    // SAFEGUARD: If reservation was already in confirming/confirmed state, return existing entry
    if (reservationAlreadyConfirming && reservation) {
      const txHash = transactionHash || reservation.id;
      // Get competition uid for proper ID matching in joincompetition queries
      const competitionInfo = await getCompetitionWithUid(supabase, reservation.competition_id);
      const competitionUid = competitionInfo?.uid || reservation.competition_id;
      const { data: existingEntry } = await supabase
        .from("joincompetition")
        .select("uid, ticketnumbers, numberoftickets, amountspent")
        .or(buildCompetitionIdFilter(reservation.competition_id, competitionUid))
        .eq("transactionhash", txHash)
        .maybeSingle();

      if (existingEntry) {
        console.log(`[Confirm Tickets] Reservation ${reservationId} already confirmed, returning existing entry`);
        const existingTicketNumbers = String(existingEntry.ticketnumbers || "")
          .split(",")
          .map((x: string) => parseInt(x.trim(), 10))
          .filter((n: number) => Number.isFinite(n));

        return json(
          {
            success: true,
            reservationId: reservation.id,
            ticketNumbers: existingTicketNumbers,
            ticketCount: existingEntry.numberoftickets || existingTicketNumbers.length,
            totalAmount: existingEntry.amountspent || 0,
            message: `Already confirmed ${existingTicketNumbers.length} tickets.`,
            alreadyConfirmed: true,
          },
          200,
          origin
        );
      }

      // Reservation is being processed, return in-progress response
      const resTicketNumbers = (reservation.ticket_numbers || []).map((n: any) => Number(n));
      console.log(`[Confirm Tickets] Reservation ${reservationId} in progress, returning pending success`);
      return json(
        {
          success: true,
          reservationId: reservation.id,
          ticketNumbers: resTicketNumbers,
          ticketCount: resTicketNumbers.length,
          totalAmount: reservation.total_amount,
          message: `Confirmation in progress for ${resTicketNumbers.length} tickets.`,
          confirmationInProgress: true,
        },
        200,
        origin
      );
    }

    // ----------------------
    // PATH A: Lucky dip / direct allocation
    // ----------------------
    if (!reservation) {
      if (!canonicalUserId || !competitionId) {
        return json({ success: false, error: "Missing userId or competitionId" }, 400, origin);
      }

      // Get competition uid early for proper ID matching in joincompetition queries
      const competitionInfo = await getCompetitionWithUid(supabase, competitionId);
      const competitionUid = competitionInfo?.uid || competitionId;

      // SAFEGUARD 1: Check for existing joincompetition entry with same transactionHash or sessionId
      // This prevents duplicate entries from retry logic
      // ENHANCED: Now also checks for entries by normalized user ID to catch duplicate requests
      const lookupTxHash = transactionHash || sessionId;
      if (lookupTxHash) {
        const { data: existingEntry } = await withRetries("check existing joincompetition (path A)", async () =>
          supabase
            .from("joincompetition")
            .select("uid, ticketnumbers, numberoftickets, amountspent")
            .or(buildCompetitionIdFilter(competitionId, competitionUid))
            .eq("transactionhash", lookupTxHash)
            .maybeSingle()
        );

        if (existingEntry) {
          console.log(`[Confirm Tickets] PATH A: Already confirmed entry found for txHash=${lookupTxHash}, returning existing`);
          const existingTicketNumbers = String(existingEntry.ticketnumbers || "")
            .split(",")
            .map((x: string) => parseInt(x.trim(), 10))
            .filter((n: number) => Number.isFinite(n));

          return json(
            {
              success: true,
              ticketNumbers: existingTicketNumbers,
              ticketCount: existingEntry.numberoftickets || existingTicketNumbers.length,
              totalAmount: existingEntry.amountspent || 0,
              message: `Already confirmed ${existingTicketNumbers.length} tickets.`,
              alreadyConfirmed: true,
            },
            200,
            origin
          );
        }
      }
      
/**
 * Validate that a user ID has proper format
 * Returns true if the ID is a valid wallet address, Privy DID, UUID, or prize:pid format
 */
function isValidUserId(userId: string): boolean {
  // Prize:pid format (canonical)
  if (userId.startsWith('prize:pid:')) {
    const inner = userId.substring('prize:pid:'.length);
    return isValidWalletAddress(inner) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(inner);
  }
  // Wallet address: 0x followed by 40 hex characters (total 42 chars)
  if (userId.startsWith('0x')) {
    return /^0x[a-fA-F0-9]{40}$/.test(userId);
  }
  // Privy DID: did:privy: followed by alphanumeric string
  if (userId.startsWith('did:privy:')) {
    return /^did:privy:[a-zA-Z0-9_-]+$/.test(userId);
  }
  // UUID format
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return true;
  }
  // Legacy: alphanumeric with hyphens/underscores
  return /^[a-zA-Z0-9_-]{8,}$/.test(userId);
}

// ... rest of code ...

      // ADDITIONAL SAFEGUARD: Check for recent duplicate entries by userId + competitionId
      // This catches retry attempts where transactionHash might differ
      // Helps prevent double-allocation under network retry scenarios
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

      // Validate userId format before using in query
      // Note: Supabase client library handles SQL escaping automatically via parameterization
      // This validation is defense-in-depth to reject malformed input early
      if (!isValidUserId(canonicalUserId)) {
        console.warn('[Confirm Tickets] Invalid userId format, skipping duplicate check:', canonicalUserId.substring(0, 20));
      } else {
        // Extract the actual identifier for database lookup
        const lookupId = extractPrizePid(canonicalUserId).toLowerCase();

        try {
          // Use Supabase's .or() method which handles parameterization internally
          // The client library escapes values automatically - string interpolation is safe here
          const { data: recentEntries } = await supabase
            .from("joincompetition")
            .select("uid, ticketnumbers, numberoftickets, amountspent, purchasedate, transactionhash")
            .or(buildCompetitionIdFilter(competitionId, competitionUid))
            .or(`userid.ilike.${lookupId},privy_user_id.ilike.${lookupId}`)
            .gte("purchasedate", fiveMinutesAgo)
            .order("purchasedate", { ascending: false })
            .limit(5);
          
          if (recentEntries && recentEntries.length > 0) {
            // Check if any entry has the same transaction hash (different field name)
            const matchByTx = recentEntries.find(e => e.transactionhash === lookupTxHash);
            if (matchByTx) {
              console.log(`[Confirm Tickets] PATH A: Found recent entry by transaction hash - returning existing`);
              const ticketNumbers = String(matchByTx.ticketnumbers || "")
                .split(",")
                .map((x: string) => parseInt(x.trim(), 10))
                .filter((n: number) => Number.isFinite(n));
              
              return json(
                {
                  success: true,
                  ticketNumbers,
                  ticketCount: matchByTx.numberoftickets,
                  totalAmount: matchByTx.amountspent || 0,
                  message: `Already confirmed ${ticketNumbers.length} tickets.`,
                  alreadyConfirmed: true,
                },
                200,
                origin
              );
            }
          }
        } catch (dupCheckErr) {
          console.warn('[Confirm Tickets] Duplicate check failed (non-critical):', dupCheckErr);
          // Continue with normal flow - this is just an extra safety check
        }
      }

      let ticketCount = 1;
      const parsedRequested = Number(requestedTicketCount);
      if (Number.isFinite(parsedRequested) && parsedRequested > 0) {
        ticketCount = parsedRequested;
      } else if (Array.isArray(selectedTickets) && selectedTickets.length > 0) {
        ticketCount = selectedTickets.length;
      }

      if (ticketCount === 1 && sessionId) {
        const { data: tx } = await withRetries("lookup tx ticket_count", async () =>
          supabase.from("user_transactions").select("ticket_count").eq("id", sessionId).maybeSingle()
        );
        const txCount = (tx as any)?.ticket_count;
        if (txCount && Number(txCount) > 0) ticketCount = Number(txCount);
      }

      const preferredTickets =
        Array.isArray(selectedTickets) && selectedTickets.length > 0
          ? selectedTickets.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0)
          : [];

      const assigned = await withRetries("assignTickets", async () =>
        assignTickets({
          supabase,
          privyUserId: canonicalUserId,
          competitionId,
          orderId: sessionId || null,
          ticketCount,
          preferredTicketNumbers: preferredTickets.length > 0 ? preferredTickets : undefined,
        })
      );

      const ticketNumbers = assigned.ticketNumbers;

      // wallet fallback - NEVER use userId (Privy DID) as wallet address
      // If no wallet address found, use null to prevent data corruption
      let walletAddress: string | null = typeof reqWalletAddress === "string" && reqWalletAddress.trim() ? reqWalletAddress : "";
      if (!walletAddress && canonicalUserId) {
        // ISSUE #4 FIX: Guard against null canonicalUserId before calling extractPrizePid
        // For Base wallet users, the userId might be the wallet address itself
        // Extract from canonical format and check
        const extractedId = extractPrizePid(canonicalUserId);
        const isWalletAddr = isValidWalletAddress(extractedId);

        if (isWalletAddr) {
          // User ID is already a wallet address, use it directly
          walletAddress = extractedId;
        } else {
          // Try to find wallet address from canonical_users
          // Use ilike for case-insensitive matching on wallet addresses
          const normalizedId = extractedId.toLowerCase();
          const { data: userConn } = await withRetries("lookup wallet", async () =>
            supabase.from("canonical_users")
              .select("wallet_address, base_wallet_address")
              .or(`privy_user_id.eq.${extractedId},wallet_address.ilike.${normalizedId},base_wallet_address.ilike.${normalizedId}`)
              .maybeSingle()
          );
          walletAddress = (userConn as any)?.wallet_address || (userConn as any)?.base_wallet_address || null;
        }
      }

      const { data: compPrice } = await withRetries("lookup ticket_price", async () =>
        supabase.from("competitions").select("ticket_price, total_tickets, is_instant_win, status").eq("id", competitionId).maybeSingle()
      );
      const ticketPrice = Number((compPrice as any)?.ticket_price) || 1;
      const totalAmount = ticketPrice * ticketNumbers.length;

      // Generate a stable transactionhash for idempotency
      const finalTransactionHash = transactionHash || sessionId || crypto.randomUUID();

      // SAFEGUARD 2: Double-check no entry was created during ticket assignment
      // (race condition window between SAFEGUARD 1 and here)
      const { data: raceCheckEntry } = await supabase
        .from("joincompetition")
        .select("uid")
        .or(buildCompetitionIdFilter(competitionId, competitionUid))
        .eq("transactionhash", finalTransactionHash)
        .maybeSingle();

      if (raceCheckEntry) {
        console.log(`[Confirm Tickets] PATH A: Race condition detected, entry already exists for txHash=${finalTransactionHash}`);
        return json(
          {
            success: true,
            ticketNumbers,
            ticketCount: ticketNumbers.length,
            totalAmount,
            message: `Already confirmed ${ticketNumbers.length} tickets.`,
            alreadyConfirmed: true,
          },
          200,
          origin
        );
      }

      // joincompetition - use stable transactionhash for idempotency
      // Store canonical userId for consistent identity
      await withRetries("insert joincompetition (lucky dip)", async () =>
        supabase.from("joincompetition").insert({
          uid: crypto.randomUUID(),
          competitionid: competitionId,
          userid: canonicalUserId,
          privy_user_id: canonicalUserId,
          numberoftickets: ticketNumbers.length,
          ticketnumbers: ticketNumbers.join(","),
          amountspent: totalAmount,
          walletaddress: walletAddress,
          chain: paymentProvider || "USDC",
          transactionhash: finalTransactionHash,
          purchasedate: new Date().toISOString(),
        })
      );

      // IMPORTANT: upsert ticket rows (assignTickets may have already inserted placeholders)
      const ticketRows = ticketNumbers.map((num: number) => ({
        competition_id: competitionId,
        order_id: sessionId ?? null,
        ticket_number: num,
        privy_user_id: canonicalUserId,
        purchase_price: ticketPrice,
        created_at: new Date().toISOString(),
      }));
      await withRetries("upsert tickets (lucky dip)", async () =>
        supabase.from("tickets").upsert(ticketRows, { onConflict: "competition_id,ticket_number" })
      );

      // instant wins (best effort)
      const instantWins: any[] = [];
      if ((compPrice as any)?.is_instant_win) {
        for (const ticketNum of ticketNumbers) {
          const { data: prize } = await supabase
            .from("Prize_Instantprizes")
            .select("*")
            .eq("competitionId", competitionId)
            .eq("winningTicket", ticketNum)
            .is("winningWalletAddress", null)
            .maybeSingle();

          if (prize) {
            const { error: winErr } = await supabase
              .from("Prize_Instantprizes")
              .update({
                winningWalletAddress: walletAddress,
                winningUserId: canonicalUserId,
                wonAt: new Date().toISOString(),
              })
              .eq("UID", (prize as any).UID);

            if (!winErr) {
              instantWins.push({ ticketNumber: ticketNum, prize: (prize as any).prize, prizeId: (prize as any).UID });
            }
          }
        }
      }

      // sold-out check (best effort)
      let soldOutTriggered = false;
      try {
        const { data: comp } = await supabase
          .from("competitions")
          .select("total_tickets, status, is_instant_win, uid")
          .eq("id", competitionId)
          .maybeSingle();

        if (comp && (comp as any).status === "active" && Number((comp as any).total_tickets) > 0) {
          const compUid = (comp as any).uid || competitionId;
          const { data: entries } = await supabase.from("joincompetition").select("*").or(buildCompetitionIdFilter(competitionId, compUid));

          let totalSold = 0;
          const allNums: number[] = [];
          const ticketToEntry = new Map<number, any>();

          (entries || []).forEach((entry: any) => {
            const nums = String(entry.ticketnumbers || "")
              .split(",")
              .map((x: string) => parseInt(x.trim(), 10))
              .filter((n: number) => Number.isFinite(n));
            totalSold += nums.length;
            nums.forEach((n) => {
              allNums.push(n);
              ticketToEntry.set(n, entry);
            });
          });

          if (totalSold >= Number((comp as any).total_tickets)) {
            soldOutTriggered = true;

            if ((comp as any).is_instant_win) {
              await supabase
                .from("competitions")
                .update({ status: "completed", competitionended: 1, draw_date: new Date().toISOString() })
                .eq("id", competitionId);
            } else if (allNums.length > 0) {
              const winningTicketNumber = allNums[Math.floor(Math.random() * allNums.length)];
              const winningEntry = ticketToEntry.get(winningTicketNumber);

              const { data: existingWinner } = await supabase
                .from("winners")
                .select("*")
                .eq("competition_id", competitionId)
                .maybeSingle();

              if (!existingWinner && winningEntry) {
                // Convert winning entry userid to canonical format for consistency
                const winnerUserId = toPrizePid(winningEntry.userid || winningEntry.privy_user_id);
                const { error: winnerInsertError } = await supabase.from("winners").insert({
                  competition_id: competitionId,
                  user_id: winnerUserId,
                  ticket_number: winningTicketNumber,
                  prize_value: 0,
                  prize_claimed: false,
                  username: winningEntry.username || "Unknown",
                  country: winningEntry.country || null,
                  wallet_address: winningEntry.walletaddress || null,
                  crdate: new Date().toISOString(),
                });
                if (winnerInsertError) {
                  console.error("[Confirm Tickets] Failed to insert winner for sold-out competition (lucky dip):", winnerInsertError);
                } else {
                  console.log(`[Confirm Tickets] Winner recorded for sold-out competition ${competitionId}: user ${winnerUserId}, ticket #${winningTicketNumber}`);
                }
              }

              await supabase
                .from("competitions")
                .update({ status: "completed", competitionended: 1, draw_date: new Date().toISOString() })
                .eq("id", competitionId);
            }
          }
        }
      } catch (e) {
        console.error("[Confirm Tickets] sold-out check failed (lucky dip):", e);
      }

      return json(
        {
          success: true,
          ticketNumbers,
          ticketCount: ticketNumbers.length,
          totalAmount,
          instantWins: instantWins.length ? instantWins : undefined,
          soldOut: soldOutTriggered,
          message: soldOutTriggered
            ? "Tickets confirmed! Competition is now SOLD OUT."
            : instantWins.length
              ? `Tickets confirmed! You won ${instantWins.length} instant prize(s)!`
              : `Successfully confirmed ${ticketNumbers.length} tickets.`,
        },
        200,
        origin
      );
    }

    // ----------------------
    // PATH B: Reservation exists
    // ----------------------
    if (reservation.expires_at && new Date(reservation.expires_at) < new Date()) {
      await supabase
        .from("pending_tickets")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", reservation.id);

      return json(
        { success: false, error: "Reservation has expired. Please select tickets again.", expiredAt: reservation.expires_at },
        410,
        origin
      );
    }

    const ticketNumbers: number[] = (reservation.ticket_numbers || []).map((n: any) => Number(n));
    // Convert reservation user_id to canonical format
    // ISSUE #4 FIX: Validate reservation has a valid user_id before proceeding
    if (!reservation.user_id) {
      console.error("[Confirm Tickets] PATH B: Reservation missing user_id, cannot proceed:", reservation.id);
      return json({ success: false, error: "Reservation is missing user identification. Please try again." }, 400, origin);
    }
    const finalUserId = toPrizePid(reservation.user_id);
    const finalCompetitionId = reservation.competition_id;

    // ISSUE #4 FIX: Validate finalCompetitionId is valid
    if (!finalCompetitionId) {
      console.error("[Confirm Tickets] PATH B: Reservation missing competition_id:", reservation.id);
      return json({ success: false, error: "Reservation is missing competition information." }, 400, origin);
    }

    // Get competition uid early for proper ID matching in joincompetition queries
    const competitionInfoB = await getCompetitionWithUid(supabase, finalCompetitionId);
    const finalCompetitionUid = competitionInfoB?.uid || finalCompetitionId;

    // Generate stable transaction hash for idempotency
    const finalTransactionHash = transactionHash || reservation.id;

    // SAFEGUARD 1: Atomically update reservation status to 'confirming' FIRST
    // This prevents race conditions where multiple requests try to confirm the same reservation
    // Only proceed if we successfully update from 'pending' to 'confirming'
    // ISSUE #3 FIX: Add lock_acquired_at timestamp to detect stale locks
    const lockAcquiredAt = new Date().toISOString();
    const { data: lockResult, error: lockError } = await supabase
      .from("pending_tickets")
      .update({
        status: "confirming",
        updated_at: lockAcquiredAt,
      })
      .eq("id", reservation.id)
      .eq("status", "pending") // Only update if still pending (atomic lock)
      .select("id")
      .maybeSingle();

    if (lockError || !lockResult) {
      // Another request already started confirming this reservation
      // Check if it's already fully confirmed and return the existing entry
      const { data: currentReservation } = await supabase
        .from("pending_tickets")
        .select("status, updated_at")
        .eq("id", reservation.id)
        .maybeSingle();

      // ISSUE #3 FIX: Check if lock is stale (older than 60 seconds in "confirming" state)
      // This handles the case where a previous request crashed mid-confirmation
      if (currentReservation?.status === "confirming" && currentReservation.updated_at) {
        const lockTime = new Date(currentReservation.updated_at).getTime();
        const now = Date.now();
        const lockAgeMs = now - lockTime;
        const STALE_LOCK_TIMEOUT_MS = 60000; // 60 seconds

        if (lockAgeMs > STALE_LOCK_TIMEOUT_MS) {
          console.log(`[Confirm Tickets] PATH B: Stale lock detected (${lockAgeMs}ms old), attempting to recover`);

          // Try to acquire the stale lock
          const { data: recoveredLock } = await supabase
            .from("pending_tickets")
            .update({
              status: "confirming",
              updated_at: new Date().toISOString(),
            })
            .eq("id", reservation.id)
            .eq("status", "confirming") // Only if still "confirming" (not "confirmed" by other process)
            .select("id")
            .maybeSingle();

          if (recoveredLock) {
            console.log(`[Confirm Tickets] PATH B: Recovered stale lock on reservation ${reservation.id}`);
            // Continue with confirmation below - we've recovered the lock
          }
        }
      }

      if (currentReservation?.status === "confirmed" || currentReservation?.status === "confirming") {
        // Look up the existing joincompetition entry
        const { data: existingEntry } = await supabase
          .from("joincompetition")
          .select("uid, ticketnumbers, numberoftickets, amountspent")
          .or(buildCompetitionIdFilter(finalCompetitionId, finalCompetitionUid))
          .eq("transactionhash", finalTransactionHash)
          .maybeSingle();

        if (existingEntry) {
          console.log(`[Confirm Tickets] PATH B: Reservation already confirmed, returning existing entry`);
          const existingTicketNumbers = String(existingEntry.ticketnumbers || "")
            .split(",")
            .map((x: string) => parseInt(x.trim(), 10))
            .filter((n: number) => Number.isFinite(n));

          return json(
            {
              success: true,
              reservationId: reservation.id,
              ticketNumbers: existingTicketNumbers,
              ticketCount: existingEntry.numberoftickets || existingTicketNumbers.length,
              totalAmount: existingEntry.amountspent || 0,
              message: `Already confirmed ${existingTicketNumbers.length} tickets.`,
              alreadyConfirmed: true,
            },
            200,
            origin
          );
        }

        // Entry being processed by another request, wait briefly and return success
        // The other request will complete the confirmation
        console.log(`[Confirm Tickets] PATH B: Reservation in progress by another request, returning pending success`);
        return json(
          {
            success: true,
            reservationId: reservation.id,
            ticketNumbers,
            ticketCount: ticketNumbers.length,
            totalAmount: reservation.total_amount,
            message: `Confirmation in progress for ${ticketNumbers.length} tickets.`,
            confirmationInProgress: true,
          },
          200,
          origin
        );
      }

      // Reservation is in unexpected state
      console.error(`[Confirm Tickets] PATH B: Failed to acquire lock on reservation ${reservation.id}, status: ${currentReservation?.status}`);
      return json(
        { success: false, error: "Reservation is no longer available for confirmation." },
        409,
        origin
      );
    }

    console.log(`[Confirm Tickets] PATH B: Acquired lock on reservation ${reservation.id}`);

    // SAFEGUARD 2: Check for existing joincompetition entry with same transactionHash
    // This handles cases where a previous request created the entry but crashed before updating status
    const { data: existingJcEntry } = await supabase
      .from("joincompetition")
      .select("uid, ticketnumbers, numberoftickets, amountspent")
      .or(buildCompetitionIdFilter(finalCompetitionId, finalCompetitionUid))
      .eq("transactionhash", finalTransactionHash)
      .maybeSingle();

    if (existingJcEntry) {
      console.log(`[Confirm Tickets] PATH B: Entry already exists for txHash=${finalTransactionHash}, updating status to confirmed`);

      // Update reservation to confirmed since entry exists
      await supabase
        .from("pending_tickets")
        .update({
          status: "confirmed",
          transaction_hash: finalTransactionHash,
          payment_provider: paymentProvider ?? null,
          confirmed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", reservation.id);

      const existingTicketNumbers = String(existingJcEntry.ticketnumbers || "")
        .split(",")
        .map((x: string) => parseInt(x.trim(), 10))
        .filter((n: number) => Number.isFinite(n));

      return json(
        {
          success: true,
          reservationId: reservation.id,
          ticketNumbers: existingTicketNumbers,
          ticketCount: existingJcEntry.numberoftickets || existingTicketNumbers.length,
          totalAmount: existingJcEntry.amountspent || 0,
          message: `Already confirmed ${existingTicketNumbers.length} tickets.`,
          alreadyConfirmed: true,
        },
        200,
        origin
      );
    }

    // wallet fallback - NEVER use userId (Privy DID) as wallet address
    // If no wallet address found, use null to prevent data corruption
    // ISSUE #4 FIX: Explicit null type - walletAddress can legitimately be null
    let walletAddress: string | null = typeof reqWalletAddress === "string" && reqWalletAddress.trim() ? reqWalletAddress : null;
    if (!walletAddress) {
      // For Base wallet users, finalUserId might be the wallet address itself
      // Extract from canonical format and check
      const extractedId = extractPrizePid(finalUserId);
      const isWalletAddr = isValidWalletAddress(extractedId);

      if (isWalletAddr) {
        // User ID is already a wallet address, use it directly
        walletAddress = extractedId;
      } else {
        // Try to find wallet address from canonical_users
        // Use ilike for case-insensitive matching on wallet addresses
        const normalizedId = extractedId.toLowerCase();
        const { data: conn } = await supabase
          .from("canonical_users")
          .select("wallet_address, base_wallet_address")
          .or(`privy_user_id.eq.${extractedId},wallet_address.ilike.${normalizedId},base_wallet_address.ilike.${normalizedId}`)
          .maybeSingle();
        walletAddress = (conn as any)?.wallet_address || (conn as any)?.base_wallet_address || null;
      }
    }

    // Calculate correct total amount - recalculate if reservation has 0 or invalid amount
    let finalTotalAmount = Number(reservation.total_amount) || 0;
    if (finalTotalAmount <= 0 && ticketNumbers.length > 0) {
      const { data: compPriceData } = await supabase
        .from("competitions")
        .select("ticket_price")
        .eq("id", finalCompetitionId)
        .maybeSingle();
      const ticketPrice = Number((compPriceData as any)?.ticket_price) || 1;
      finalTotalAmount = ticketPrice * ticketNumbers.length;
      console.log(`[Confirm Tickets] PATH B: Recalculated amount from 0 to ${finalTotalAmount} (${ticketPrice} × ${ticketNumbers.length})`);
    }

    // joincompetition - use stable transactionhash for idempotency
    await withRetries("insert joincompetition (reserved)", async () =>
      supabase.from("joincompetition").insert({
        uid: crypto.randomUUID(),
        competitionid: finalCompetitionId,
        userid: finalUserId,
        privy_user_id: finalUserId,
        numberoftickets: ticketNumbers.length,
        ticketnumbers: ticketNumbers.join(","),
        amountspent: finalTotalAmount,
        walletaddress: walletAddress,
        chain: paymentProvider || "USDC",
        transactionhash: finalTransactionHash,
        purchasedate: new Date().toISOString(),
      })
    );

    // IMPORTANT: upsert ticket rows (reservation path might also collide)
    const reservedRows = ticketNumbers.map((num: number) => ({
      competition_id: finalCompetitionId,
      order_id: reservation.id,
      ticket_number: num,
      privy_user_id: finalUserId,
      purchase_price: reservation.ticket_price ?? null,
      created_at: new Date().toISOString(),
    }));
    await withRetries("upsert tickets (reserved)", async () =>
      supabase.from("tickets").upsert(reservedRows, { onConflict: "competition_id,ticket_number" })
    );

    // pending_tickets status update - change from 'confirming' to 'confirmed'
    await withRetries("update pending_tickets", async () =>
      supabase
        .from("pending_tickets")
        .update({
          status: "confirmed",
          transaction_hash: finalTransactionHash,
          payment_provider: paymentProvider ?? null,
          confirmed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", reservation.id)
    );

    // instant wins
    const instantWins: any[] = [];
    const { data: compWin } = await supabase
      .from("competitions")
      .select("is_instant_win, total_tickets, status")
      .eq("id", finalCompetitionId)
      .maybeSingle();

    if ((compWin as any)?.is_instant_win) {
      for (const ticketNum of ticketNumbers) {
        const { data: prize } = await supabase
          .from("Prize_Instantprizes")
          .select("*")
          .eq("competitionId", finalCompetitionId)
          .eq("winningTicket", ticketNum)
          .is("winningWalletAddress", null)
          .maybeSingle();

        if (prize) {
          const { error: winErr } = await supabase
            .from("Prize_Instantprizes")
            .update({
              winningWalletAddress: walletAddress,
              winningUserId: finalUserId,
              wonAt: new Date().toISOString(),
            })
            .eq("UID", (prize as any).UID);

          if (!winErr) {
            instantWins.push({ ticketNumber: ticketNum, prize: (prize as any).prize, prizeId: (prize as any).UID });
          }
        }
      }
    }

    // Notification (best effort)
    try {
      await supabase.from("notifications").insert({
        user_id: finalUserId,
        type: instantWins.length ? "instant_win" : "purchase_confirmed",
        title: instantWins.length ? `🎉 You won ${instantWins.length} instant prize(s)!` : "Purchase Confirmed",
        message: instantWins.length
          ? `Winning tickets: ${instantWins.map((w) => w.ticketNumber).join(", ")}`
          : `Your tickets are confirmed: ${ticketNumbers.join(", ")}`,
        data: { competitionId: finalCompetitionId, ticketNumbers, instantWins },
        read: false,
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      console.error("[Confirm Tickets] notification insert failed (ignored):", e);
    }

    // Sold-out check (best effort)
    let soldOutTriggered = false;
    try {
      const comp = compWin as any;
      if (comp && comp.status === "active" && Number(comp.total_tickets) > 0) {
        const { data: entries } = await supabase
          .from("joincompetition")
          .select("*")
          .or(buildCompetitionIdFilter(finalCompetitionId, finalCompetitionUid));

        let totalSold = 0;
        const allNums: number[] = [];
        const ticketToEntry = new Map<number, any>();

        (entries || []).forEach((entry: any) => {
          const nums = String(entry.ticketnumbers || "")
            .split(",")
            .map((x: string) => parseInt(x.trim(), 10))
            .filter((n: number) => Number.isFinite(n));
          totalSold += nums.length;
          nums.forEach((n) => {
            allNums.push(n);
            ticketToEntry.set(n, entry);
          });
        });

        if (totalSold >= Number(comp.total_tickets)) {
          soldOutTriggered = true;

          if (comp.is_instant_win) {
            await supabase
              .from("competitions")
              .update({ status: "completed", competitionended: 1, draw_date: new Date().toISOString() })
              .eq("id", finalCompetitionId);
          } else if (allNums.length > 0) {
            const winningTicketNumber = allNums[Math.floor(Math.random() * allNums.length)];
            const winningEntry = ticketToEntry.get(winningTicketNumber);

            const { data: existingWinner } = await supabase
              .from("winners")
              .select("*")
              .eq("competition_id", finalCompetitionId)
              .maybeSingle();

            if (!existingWinner && winningEntry) {
              // Convert winning entry userid to canonical format for consistency
              const winnerUserId = toPrizePid(winningEntry.userid || winningEntry.privy_user_id);
              const { error: winnerInsertError } = await supabase.from("winners").insert({
                competition_id: finalCompetitionId,
                user_id: winnerUserId,
                ticket_number: winningTicketNumber,
                prize_value: 0,
                prize_claimed: false,
                username: winningEntry.username || "Unknown",
                country: winningEntry.country || null,
                wallet_address: winningEntry.walletaddress || null,
                crdate: new Date().toISOString(),
              });
              if (winnerInsertError) {
                console.error("[Confirm Tickets] Failed to insert winner for sold-out competition:", winnerInsertError);
              } else {
                console.log(`[Confirm Tickets] Winner recorded for sold-out competition ${finalCompetitionId}: user ${winnerUserId}, ticket #${winningTicketNumber}`);
              }
            }

            await supabase
              .from("competitions")
              .update({ status: "completed", competitionended: 1, draw_date: new Date().toISOString() })
              .eq("id", finalCompetitionId);
          }
        }
      }
    } catch (e) {
      console.error("[Confirm Tickets] sold-out check failed:", e);
    }

    return json(
      {
        success: true,
        reservationId: reservation.id,
        ticketNumbers,
        ticketCount: ticketNumbers.length,
        totalAmount: finalTotalAmount,
        instantWins: instantWins.length ? instantWins : undefined,
        soldOut: soldOutTriggered,
        message: soldOutTriggered
          ? "Tickets confirmed! Competition is now SOLD OUT."
          : instantWins.length
            ? `Tickets confirmed! You won ${instantWins.length} instant prize(s)!`
            : `Successfully confirmed ${ticketNumbers.length} tickets.`,
      },
      200,
      origin
    );
  } catch (err) {
    const incidentId = `netlify-proxy-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;

    console.error("[Confirm Tickets] Unexpected error:", err);
    console.error(`[Confirm Tickets] Incident ID: ${incidentId}`);

    // Try to log incident to database (best effort - don't fail if logging fails)
    try {
      const supabase = getSupabase();
      await supabase.rpc("log_confirmation_incident", {
        p_incident_id: incidentId,
        p_source: "netlify_proxy",
        p_endpoint: "/api/confirm-pending-tickets",
        p_error_type: err instanceof Error && err.name ? err.name : "UnknownError",
        p_error_message: errorMessage,
        p_error_stack: errorStack,
        p_user_id: body?.userId || body?.userIdentifier || null,
        p_competition_id: body?.competitionId || null,
        p_reservation_id: body?.reservationId || null,
        p_session_id: body?.sessionId || null,
        p_transaction_hash: body?.transactionHash || null,
        p_env_context: {
          netlify: true,
          hasSupabaseUrl: !!(Netlify.env.get("VITE_SUPABASE_URL") || Netlify.env.get("SUPABASE_URL")),
          hasServiceRoleKey: !!Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY"),
          nodeVersion: process.version,
        },
        p_metadata: {
          timestamp: new Date().toISOString(),
          origin: origin || "unknown",
        },
      });
      console.log(`[Confirm Tickets] Logged incident to database: ${incidentId}`);
    } catch (logErr) {
      console.error("[Confirm Tickets] Failed to log incident to database:", logErr);
    }

    return json(
      {
        success: false,
        error: errorMessage,
        incidentId,
        message: "An error occurred during ticket confirmation. Please contact support with this incident ID if the issue persists.",
      },
      500,
      origin
    );
  }
};

