import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { toPrizePid, isWalletAddress } from "../_shared/userId.ts";

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
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control, pragma, expires',
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
 * Payments Auto-Heal Function
 *
 * This function identifies and fixes orphaned payments where:
 * 1. Payment completed successfully (status = 'finished' or 'completed')
 * 2. But tickets were never allocated (no joincompetition entry exists)
 *
 * This handles edge cases where:
 * - Network failures prevented ticket confirmation callback
 * - Webhook failed after payment succeeded
 * - Client disconnected during ticket allocation
 *
 * Run via: POST /functions/v1/payments-auto-heal
 * Can be scheduled as a cron job or triggered manually by admin
 */

interface HealResult {
  transactionId: string;
  userId: string;
  competitionId: string;
  ticketCount: number;
  status: "healed" | "skipped" | "failed";
  reason?: string;
  ticketNumbers?: number[];
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return handleCorsOptions(req);
  }

  const corsHeaders = buildCorsHeaders(req.headers.get("origin"));
  const requestId = crypto.randomUUID().slice(0, 8);
  console.log(`[auto-heal][${requestId}] Starting payment auto-heal`);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Parse optional request body for filtering
    let body: Record<string, unknown> = {};
    try {
      if (req.method === "POST") {
        body = await req.json();
      }
    } catch {
      // No body is fine
    }

    const dryRun = body.dryRun === true;
    const limitTransactions = Number(body.limit) || 100;
    const specificTransactionId = body.transactionId as string | undefined;
    const specificUserId = body.userId as string | undefined;

    console.log(`[auto-heal][${requestId}] Mode: ${dryRun ? "DRY RUN" : "LIVE"}, limit: ${limitTransactions}`);

    // Find completed transactions that might need healing
    // These are transactions where:
    // 1. Status is 'finished', 'completed', or 'confirmed' (payment succeeded)
    // 2. It's an 'entry' type transaction (competition purchase, not top-up)
    // 3. Has a competition_id
    let query = supabase
      .from("user_transactions")
      .select("*")
      .in("status", ["finished", "completed", "confirmed"])
      .eq("type", "entry")
      .not("competition_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(limitTransactions);

    if (specificTransactionId) {
      query = query.eq("id", specificTransactionId);
    }
    if (specificUserId) {
      query = query.eq("user_privy_id", specificUserId);
    }

    const { data: transactions, error: txError } = await query;

    if (txError) {
      console.error(`[auto-heal][${requestId}] Error fetching transactions:`, txError);
      throw new Error(`Failed to fetch transactions: ${txError.message}`);
    }

    if (!transactions || transactions.length === 0) {
      console.log(`[auto-heal][${requestId}] No transactions found to check`);
      return new Response(
        JSON.stringify({
          success: true,
          message: "No transactions to heal",
          checked: 0,
          healed: 0,
          results: [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[auto-heal][${requestId}] Found ${transactions.length} transactions to check`);

    const results: HealResult[] = [];

    for (const tx of transactions) {
      const rawUserId = tx.user_privy_id || tx.user_id;
      const canonicalUserId = toPrizePid(rawUserId);
      const competitionId = tx.competition_id;
      const ticketCount = tx.ticket_count || 1;
      const txHash = tx.tx_id || tx.id;

      console.log(`[auto-heal][${requestId}] Checking tx ${tx.id} for user ${rawUserId} (canonical: ${canonicalUserId})`);

      // Check if joincompetition entry already exists for this transaction
      // Search with both canonical and raw user ID for backward compatibility
      const { data: existingEntry, error: entryError } = await supabase
        .from("joincompetition")
        .select("uid, ticketnumbers")
        .or(`transactionhash.eq.${txHash},transactionhash.eq.${tx.id}`)
        .eq("competitionid", competitionId)
        .or(`userid.eq.${canonicalUserId},userid.eq.${rawUserId}`)
        .maybeSingle();

      if (entryError) {
        console.error(`[auto-heal][${requestId}] Error checking entry for tx ${tx.id}:`, entryError);
        results.push({
          transactionId: tx.id,
          userId: canonicalUserId,
          competitionId,
          ticketCount,
          status: "failed",
          reason: `Error checking entry: ${entryError.message}`,
        });
        continue;
      }

      if (existingEntry) {
        console.log(`[auto-heal][${requestId}] tx ${tx.id} already has entry ${existingEntry.uid}`);
        results.push({
          transactionId: tx.id,
          userId: canonicalUserId,
          competitionId,
          ticketCount,
          status: "skipped",
          reason: "Entry already exists",
          ticketNumbers: existingEntry.ticketnumbers
            ?.split(",")
            .map((n: string) => parseInt(n.trim()))
            .filter((n: number) => !isNaN(n)),
        });
        continue;
      }

      // Also check tickets table for this order
      // Check with both canonical and raw user ID for backward compatibility
      const { data: existingTickets, error: ticketsError } = await supabase
        .from("tickets")
        .select("ticket_number")
        .eq("competition_id", competitionId)
        .or(`user_id.eq.${canonicalUserId},user_id.eq.${rawUserId}`)
        .or(`order_id.eq.${tx.id},order_id.eq.${txHash}`);

      if (!ticketsError && existingTickets && existingTickets.length > 0) {
        console.log(
          `[auto-heal][${requestId}] tx ${tx.id} has ${existingTickets.length} tickets but no joincompetition entry`
        );

        // Tickets exist but joincompetition is missing - create the entry
        if (!dryRun) {
          const ticketNumbers = existingTickets.map((t: any) => Number(t.ticket_number));
          const { data: compPrice } = await supabase
            .from("competitions")
            .select("ticket_price")
            .eq("id", competitionId)
            .maybeSingle();

          const ticketPrice = Number(compPrice?.ticket_price) || 1;

          // Note: privy_user_id column may not exist in all environments
          // The userid field stores the canonical user identifier
          const { error: jcError } = await supabase.from("joincompetition").insert({
            uid: crypto.randomUUID(),
            competitionid: competitionId,
            userid: canonicalUserId,  // Use canonical ID
            numberoftickets: ticketNumbers.length,
            ticketnumbers: ticketNumbers.join(","),
            amountspent: ticketPrice * ticketNumbers.length,
            walletaddress: tx.wallet_address || (isWalletAddress(rawUserId) ? rawUserId.toLowerCase() : rawUserId),
            chain: tx.payment_provider || "USDC",
            transactionhash: txHash,
            purchasedate: tx.completed_at || tx.created_at || new Date().toISOString(),
          });

          if (jcError) {
            console.error(`[auto-heal][${requestId}] Failed to create joincompetition for tx ${tx.id}:`, jcError);
            results.push({
              transactionId: tx.id,
              userId: canonicalUserId,
              competitionId,
              ticketCount: ticketNumbers.length,
              status: "failed",
              reason: `Failed to create joincompetition: ${jcError.message}`,
            });
            continue;
          }

          console.log(`[auto-heal][${requestId}] Created joincompetition entry for tx ${tx.id}`);
        }

        results.push({
          transactionId: tx.id,
          userId: canonicalUserId,
          competitionId,
          ticketCount: existingTickets.length,
          status: dryRun ? "skipped" : "healed",
          reason: dryRun ? "DRY RUN: Would create joincompetition from existing tickets" : "Created joincompetition from existing tickets",
          ticketNumbers: existingTickets.map((t: any) => Number(t.ticket_number)),
        });
        continue;
      }

      // No entry AND no tickets - need to allocate tickets
      console.log(`[auto-heal][${requestId}] tx ${tx.id} needs full ticket allocation`);

      if (dryRun) {
        results.push({
          transactionId: tx.id,
          userId: canonicalUserId,
          competitionId,
          ticketCount,
          status: "skipped",
          reason: "DRY RUN: Would allocate tickets and create entry",
        });
        continue;
      }

      // Check if competition is still active
      const { data: competition, error: compError } = await supabase
        .from("competitions")
        .select("status, total_tickets, ticket_price")
        .eq("id", competitionId)
        .maybeSingle();

      if (compError || !competition) {
        console.error(`[auto-heal][${requestId}] Competition ${competitionId} not found for tx ${tx.id}`);
        results.push({
          transactionId: tx.id,
          userId: canonicalUserId,
          competitionId,
          ticketCount,
          status: "failed",
          reason: "Competition not found",
        });
        continue;
      }

      // Check for reserved tickets in pending_tickets
      // Check with both canonical and raw user ID for backward compatibility
      let preferredTicketNumbers: number[] | undefined;
      const { data: pendingTicket } = await supabase
        .from("pending_tickets")
        .select("ticket_numbers, id")
        .or(`session_id.eq.${tx.id},user_id.eq.${canonicalUserId},user_id.eq.${rawUserId}`)
        .eq("competition_id", competitionId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (pendingTicket?.ticket_numbers && Array.isArray(pendingTicket.ticket_numbers)) {
        preferredTicketNumbers = pendingTicket.ticket_numbers
          .map((n: any) => Number(n))
          .filter((n: number) => Number.isFinite(n));
        console.log(`[auto-heal][${requestId}] Found ${preferredTicketNumbers.length} reserved tickets for tx ${tx.id}`);
      }

      try {
        // Allocate tickets using the shared helper
        // Use canonical ID for ticket assignment
        const assigned = await assignTickets({
          supabase,
          userIdentifier: canonicalUserId,
          competitionId,
          orderId: tx.id,
          ticketCount: preferredTicketNumbers?.length || ticketCount,
          preferredTicketNumbers,
        });

        const ticketNumbers = assigned.ticketNumbers;
        const ticketPrice = Number(competition.ticket_price) || 1;

        // Create joincompetition entry
        // Note: privy_user_id column may not exist in all environments
        // The userid field stores the canonical user identifier
        const { error: jcError } = await supabase.from("joincompetition").insert({
          uid: crypto.randomUUID(),
          competitionid: competitionId,
          userid: canonicalUserId,  // Use canonical ID
          numberoftickets: ticketNumbers.length,
          ticketnumbers: ticketNumbers.join(","),
          amountspent: ticketPrice * ticketNumbers.length,
          walletaddress: tx.wallet_address || (isWalletAddress(rawUserId) ? rawUserId.toLowerCase() : rawUserId),
          chain: tx.payment_provider || "USDC",
          transactionhash: txHash,
          purchasedate: tx.completed_at || tx.created_at || new Date().toISOString(),
        });

        if (jcError) {
          console.error(`[auto-heal][${requestId}] Failed to create joincompetition for tx ${tx.id}:`, jcError);
          results.push({
            transactionId: tx.id,
            userId: canonicalUserId,
            competitionId,
            ticketCount: ticketNumbers.length,
            status: "failed",
            reason: `Tickets allocated but joincompetition failed: ${jcError.message}`,
            ticketNumbers,
          });
          continue;
        }

        // Mark pending ticket as confirmed if it exists
        if (pendingTicket?.id) {
          await supabase
            .from("pending_tickets")
            .update({
              status: "confirmed",
              transaction_hash: txHash,
              confirmed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", pendingTicket.id);
        }

        // Update transaction notes
        await supabase
          .from("user_transactions")
          .update({
            notes: `Auto-healed at ${new Date().toISOString()}. Tickets: ${ticketNumbers.join(",")}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", tx.id);

        console.log(`[auto-heal][${requestId}] Successfully healed tx ${tx.id} with ${ticketNumbers.length} tickets`);

        results.push({
          transactionId: tx.id,
          userId: canonicalUserId,
          competitionId,
          ticketCount: ticketNumbers.length,
          status: "healed",
          reason: "Allocated tickets and created entry",
          ticketNumbers,
        });
      } catch (allocError) {
        console.error(`[auto-heal][${requestId}] Failed to allocate tickets for tx ${tx.id}:`, allocError);
        results.push({
          transactionId: tx.id,
          userId: canonicalUserId,
          competitionId,
          ticketCount,
          status: "failed",
          reason: `Ticket allocation failed: ${allocError instanceof Error ? allocError.message : "Unknown error"}`,
        });
      }
    }

    const healed = results.filter((r) => r.status === "healed").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const failed = results.filter((r) => r.status === "failed").length;

    console.log(`[auto-heal][${requestId}] Complete. Healed: ${healed}, Skipped: ${skipped}, Failed: ${failed}`);

    return new Response(
      JSON.stringify({
        success: true,
        dryRun,
        checked: transactions.length,
        healed,
        skipped,
        failed,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error(`[auto-heal][${requestId}] Fatal error:`, error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
