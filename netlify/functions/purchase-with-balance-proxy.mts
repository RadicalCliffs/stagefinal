import type { Context, Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { toPrizePid } from "./_shared/userId.mts";

export const config: Config = {
  path: "/api/purchase-with-balance",
};

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, apikey",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(data: object, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function errorResponse(
  code: string,
  message: string,
  status: number = 400
): Response {
  return jsonResponse({ success: false, error: { code, message } }, status);
}

/**
 * SAFEGUARD 1: Server-side retry + direct DB fallback
 * If the RPC fails, retry up to 2 times, then fall back to direct DB operations.
 */
async function callRpcWithRetry(
  supabase: ReturnType<typeof createClient>,
  params: {
    canonicalUserId: string;
    competitionId: string;
    ticketPrice: number;
    ticketCount: number | null;
    ticketNumbers: number[] | null;
    idempotencyKey: string | null;
  },
  requestId: string,
  maxRetries: number = 2
): Promise<{ data: any; error: any }> {
  let lastError: any = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(500 * Math.pow(2, attempt - 1), 2000);
      console.log(
        `[purchase-with-balance-proxy][${requestId}] RPC retry ${attempt}/${maxRetries} after ${delay}ms`
      );
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      const { data: rpcResult, error: rpcError } = await supabase.rpc(
        "purchase_tickets_with_balance",
        {
          p_user_identifier: params.canonicalUserId,
          p_competition_id: params.competitionId,
          p_ticket_price: params.ticketPrice,
          p_ticket_count: params.ticketCount,
          p_ticket_numbers: params.ticketNumbers,
          p_idempotency_key: params.idempotencyKey,
        }
      );

      if (!rpcError && rpcResult) {
        // If the RPC returned a result, check if it was a success
        if (rpcResult.success) {
          return { data: rpcResult, error: null };
        }

        // RPC returned {success: false} - check the error code
        const code = rpcResult.error_code || "";

        // Validation errors should be returned immediately (no retry)
        if (
          code === "INSUFFICIENT_BALANCE" ||
          code === "NO_BALANCE_RECORD" ||
          code === "VALIDATION_ERROR"
        ) {
          return { data: rpcResult, error: null };
        }

        // INTERNAL_ERROR means a trigger or constraint failed inside the RPC.
        // Retry and eventually fall through to direct DB fallback.
        lastError = {
          message: rpcResult.error || "RPC internal error",
          code: rpcResult.error_code,
        };
        console.warn(
          `[purchase-with-balance-proxy][${requestId}] RPC attempt ${attempt + 1} returned internal error:`,
          rpcResult.error
        );
        continue;
      }

      lastError = rpcError;
      console.warn(
        `[purchase-with-balance-proxy][${requestId}] RPC attempt ${attempt + 1} failed:`,
        rpcError?.message || "null result"
      );
    } catch (err) {
      lastError = err;
      console.warn(
        `[purchase-with-balance-proxy][${requestId}] RPC attempt ${attempt + 1} exception:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return { data: null, error: lastError };
}

/**
 * SAFEGUARD 2: Direct database fallback when RPC is completely unreachable.
 * Performs the same operations as the RPC but using individual queries.
 * This is the nuclear option - only used when the RPC fails completely.
 */
async function directDatabaseFallback(
  supabase: ReturnType<typeof createClient>,
  params: {
    canonicalUserId: string;
    competitionId: string;
    ticketPrice: number;
    ticketNumbers: number[];
    idempotencyKey: string;
  },
  requestId: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  const { canonicalUserId, competitionId, ticketNumbers, ticketPrice, idempotencyKey } = params;

  console.log(
    `[purchase-with-balance-proxy][${requestId}] FALLBACK: Direct DB operations for ${ticketNumbers.length} tickets`
  );

  try {
    // Step 1: Check for idempotent duplicate first
    const { data: existingEntry } = await supabase
      .from("joincompetition")
      .select("uid, ticketnumbers, amountspent")
      .eq("competitionid", competitionId)
      .eq("transactionhash", idempotencyKey)
      .limit(1)
      .maybeSingle();

    if (existingEntry) {
      console.log(
        `[purchase-with-balance-proxy][${requestId}] FALLBACK: Idempotent hit - already processed`
      );
      const existingTickets = existingEntry.ticketnumbers
        ? existingEntry.ticketnumbers.split(",").map(Number)
        : ticketNumbers;

      // Get current balance
      const { data: balRow } = await supabase
        .from("sub_account_balances")
        .select("available_balance")
        .eq("canonical_user_id", canonicalUserId)
        .eq("currency", "USD")
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
      .from("sub_account_balances")
      .select("available_balance, id")
      .eq("canonical_user_id", canonicalUserId)
      .eq("currency", "USD")
      .limit(1)
      .maybeSingle();

    if (balError || !balanceRow) {
      return { success: false, error: "User balance not found" };
    }

    const currentBalance = Number(balanceRow.available_balance);
    const totalCost = ticketPrice * ticketNumbers.length;

    if (currentBalance < totalCost) {
      return { success: false, error: "Insufficient balance" };
    }

    const newBalance = currentBalance - totalCost;

    // Step 3: Deduct balance
    const { error: updateErr } = await supabase
      .from("sub_account_balances")
      .update({
        available_balance: newBalance,
        updated_at: new Date().toISOString(),
      })
      .eq("canonical_user_id", canonicalUserId)
      .eq("currency", "USD");

    if (updateErr) {
      console.error(
        `[purchase-with-balance-proxy][${requestId}] FALLBACK: Balance update failed:`,
        updateErr.message
      );
      return { success: false, error: "Failed to deduct balance" };
    }

    // Step 4: Create or update competition entry
    // Check for existing entry first (handles joincompetition_unique_user_competition constraint)
    const entryId = crypto.randomUUID();
    const ticketNumbersStr = ticketNumbers.join(",");

    const { data: existingUserEntry } = await supabase
      .from("joincompetition")
      .select("uid, ticketnumbers, amountspent, numberoftickets")
      .eq("canonical_user_id", canonicalUserId)
      .eq("competitionid", competitionId)
      .limit(1)
      .maybeSingle();

    if (existingUserEntry) {
      // User already has an entry for this competition - UPDATE (append tickets)
      // DEDUPLICATE: Merge existing + new ticket numbers, removing duplicates
      console.log(
        `[purchase-with-balance-proxy][${requestId}] FALLBACK: Existing entry found, appending tickets with deduplication`
      );
      const existingTickets = existingUserEntry.ticketnumbers || "";
      const existingNums = existingTickets
        ? existingTickets.split(",").map(Number).filter((n: number) => !isNaN(n))
        : [];
      // Merge and deduplicate
      const mergedSet = new Set([...existingNums, ...ticketNumbers]);
      const mergedTickets = Array.from(mergedSet).sort((a, b) => a - b).join(",");
      const mergedCount = mergedSet.size;
      const mergedAmount = Number(existingUserEntry.amountspent || 0) + totalCost;

      const { error: updateErr2 } = await supabase
        .from("joincompetition")
        .update({
          ticketnumbers: mergedTickets,
          numberoftickets: mergedCount,
          amountspent: mergedAmount,
          updated_at: new Date().toISOString(),
        })
        .eq("canonical_user_id", canonicalUserId)
        .eq("competitionid", competitionId);

      if (updateErr2) {
        console.error(
          `[purchase-with-balance-proxy][${requestId}] FALLBACK: Entry update failed:`,
          updateErr2.message
        );
        // Refund the balance
        await supabase
          .from("sub_account_balances")
          .update({
            available_balance: currentBalance,
            updated_at: new Date().toISOString(),
          })
          .eq("canonical_user_id", canonicalUserId)
          .eq("currency", "USD");
        return { success: false, error: "Failed to update competition entry" };
      }
    } else {
      // No existing entry - INSERT new row
      const { error: entryErr } = await supabase
        .from("joincompetition")
        .insert({
          uid: entryId,
          userid: canonicalUserId,
          canonical_user_id: canonicalUserId,
          competitionid: competitionId,
          ticket_numbers: ticketNumbersStr,
          numberoftickets: ticketNumbers.length,
          amount_spent: totalCost,
          transactionhash: idempotencyKey,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (entryErr) {
        // Could be a race condition - try UPDATE as fallback
        if (entryErr.message?.includes("unique") || entryErr.message?.includes("duplicate")) {
          console.warn(
            `[purchase-with-balance-proxy][${requestId}] FALLBACK: Insert hit unique constraint, trying update`
          );
          const { data: raceEntry } = await supabase
            .from("joincompetition")
            .select("uid, ticketnumbers, amount_spent, numberoftickets")
            .eq("canonical_user_id", canonicalUserId)
            .eq("competitionid", competitionId)
            .limit(1)
            .maybeSingle();

          if (raceEntry) {
            const raceTickets = raceEntry.ticketnumbers || "";
            const raceExistingNums = raceTickets
              ? raceTickets.split(",").map(Number).filter((n: number) => !isNaN(n))
              : [];
            // Merge and deduplicate
            const raceMergedSet = new Set([...raceExistingNums, ...ticketNumbers]);
            const raceMerged = Array.from(raceMergedSet).sort((a, b) => a - b).join(",");

            const { error: raceUpdateErr } = await supabase
              .from("joincompetition")
              .update({
                ticket_numbers: raceMerged,
                numberoftickets: raceMergedSet.size,
                amount_spent: Number(raceEntry.amountspent || 0) + totalCost,
                updated_at: new Date().toISOString(),
              })
              .eq("canonical_user_id", canonicalUserId)
              .eq("competitionid", competitionId);

            if (raceUpdateErr) {
              console.error(
                `[purchase-with-balance-proxy][${requestId}] FALLBACK: Race condition update also failed:`,
                raceUpdateErr.message
              );
              await supabase
                .from("sub_account_balances")
                .update({
                  available_balance: currentBalance,
                  updated_at: new Date().toISOString(),
                })
                .eq("canonical_user_id", canonicalUserId)
                .eq("currency", "USD");
              return { success: false, error: "Failed to create competition entry" };
            }
          }
        } else {
          console.error(
            `[purchase-with-balance-proxy][${requestId}] FALLBACK: Entry insert failed:`,
            entryErr.message
          );
          // Refund the balance
          await supabase
            .from("sub_account_balances")
            .update({
              available_balance: currentBalance,
              updated_at: new Date().toISOString(),
            })
            .eq("canonical_user_id", canonicalUserId)
            .eq("currency", "USD");
          return { success: false, error: "Failed to create competition entry" };
        }
      }
    }

    // Step 5: Insert ticket records (non-blocking - entry is source of truth)
    try {
      const ticketRows = ticketNumbers.map((num) => ({
        competition_id: competitionId,
        ticket_number: num,
        user_id: canonicalUserId,
        canonical_user_id: canonicalUserId,
        status: "sold",
        tx_id: idempotencyKey,
        created_at: new Date().toISOString(),
      }));

      await supabase.from("tickets").insert(ticketRows);
    } catch (ticketErr) {
      console.warn(
        `[purchase-with-balance-proxy][${requestId}] FALLBACK: Ticket insert failed (non-blocking):`,
        ticketErr
      );
    }

    // Step 6: Insert balance ledger entry (non-blocking)
    try {
      await supabase.from("balance_ledger").insert({
        canonical_user_id: canonicalUserId,
        transaction_type: "debit",
        amount: -totalCost,
        currency: "USD",
        balance_before: currentBalance,
        balance_after: newBalance,
        reference_id: idempotencyKey,
        description: `Purchase ${ticketNumbers.length} tickets for competition (fallback)`,
        created_at: new Date().toISOString(),
      });
    } catch (ledgerErr) {
      console.warn(
        `[purchase-with-balance-proxy][${requestId}] FALLBACK: Ledger insert failed (non-blocking):`,
        ledgerErr
      );
    }

    console.log(
      `[purchase-with-balance-proxy][${requestId}] FALLBACK: Success! ${ticketNumbers.length} tickets, entry=${entryId}`
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
      `[purchase-with-balance-proxy][${requestId}] FALLBACK: Fatal error:`,
      err
    );
    return {
      success: false,
      error: err instanceof Error ? err.message : "Fallback failed",
    };
  }
}

export default async (req: Request, context: Context) => {
  const requestId = crypto.randomUUID().slice(0, 8);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Method not allowed", 405);
  }

  try {
    // Resolve env vars inside the handler (not at module scope)
    const supabaseUrl =
      Netlify.env.get("VITE_SUPABASE_URL") ||
      Netlify.env.get("SUPABASE_URL") ||
      "";
    const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    if (!supabaseUrl || !serviceRoleKey) {
      console.error(
        `[purchase-with-balance-proxy][${requestId}] Missing env vars: url=${!!supabaseUrl}, key=${!!serviceRoleKey}`
      );
      return errorResponse(
        "CONFIG_ERROR",
        "Service configuration error",
        500
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return errorResponse("INVALID_JSON", "Invalid JSON body", 400);
    }

    // Extract fields from the request body (support both camelCase and snake_case)
    const userId =
      (body.userId as string) ||
      (body.user_id as string) ||
      (body.userIdentifier as string) ||
      "";
    const competitionId =
      (body.competition_id as string) ||
      (body.competitionId as string) ||
      "";
    const ticketPrice = Number(
      body.ticketPrice ?? body.ticket_price ?? body.price ?? 0
    );
    const rawIdempotencyKey =
      (body.idempotency_key as string) ||
      (body.idempotencyKey as string) ||
      null;

    // CRITICAL: Ensure idempotency key is UUID format to avoid
    // "invalid input syntax for type uuid" errors in database triggers.
    // If the client sends a non-UUID key (e.g., "idem_..." or "web-..."),
    // generate a fresh UUID instead.
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const idempotencyKey = rawIdempotencyKey
      ? UUID_REGEX.test(rawIdempotencyKey)
        ? rawIdempotencyKey
        : crypto.randomUUID()
      : crypto.randomUUID(); // SAFEGUARD: Always generate a key if none provided

    if (rawIdempotencyKey && rawIdempotencyKey !== idempotencyKey) {
      console.warn(
        `[purchase-with-balance-proxy][${requestId}] Non-UUID idempotency key replaced: ${rawIdempotencyKey.substring(0, 10)}... -> ${idempotencyKey}`
      );
    }
    const reservationId =
      (body.reservation_id as string) ||
      (body.reservationId as string) ||
      null;

    // Extract ticket numbers from the tickets array or direct ticket_numbers
    let ticketNumbers: number[] | null = null;
    let ticketCount: number | null = null;

    if (Array.isArray(body.tickets) && body.tickets.length > 0) {
      // Client sends tickets as [{ticket_number: N}, ...]
      ticketNumbers = (body.tickets as Array<{ ticket_number?: number }>).map(
        (t) => Number(t.ticket_number ?? t)
      );
    } else if (Array.isArray(body.ticket_numbers)) {
      ticketNumbers = (body.ticket_numbers as number[]).map(Number);
    }

    if (!ticketNumbers || ticketNumbers.length === 0) {
      ticketCount = Number(
        body.numberOfTickets ?? body.number_of_tickets ?? body.ticket_count ?? 0
      );
      if (ticketCount <= 0) {
        return errorResponse(
          "VALIDATION_ERROR",
          "Must provide tickets or ticket count",
          400
        );
      }
    }

    console.log(
      `[purchase-with-balance-proxy][${requestId}] Request:`,
      JSON.stringify({
        hasUserId: !!userId,
        competitionId: competitionId.substring(0, 10) + "...",
        ticketCount: ticketNumbers?.length || ticketCount,
        hasReservation: !!reservationId,
        hasIdempotencyKey: !!idempotencyKey,
      })
    );

    // Validate required fields
    if (!userId) {
      return errorResponse("VALIDATION_ERROR", "userId is required", 400);
    }
    if (!competitionId) {
      return errorResponse(
        "VALIDATION_ERROR",
        "competition_id is required",
        400
      );
    }
    if (!ticketPrice || ticketPrice <= 0) {
      return errorResponse(
        "VALIDATION_ERROR",
        "ticketPrice must be positive",
        400
      );
    }

    // Convert userId to canonical format
    const canonicalUserId = toPrizePid(userId);

    // Create Supabase client with service role (needed for SECURITY DEFINER RPC)
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    console.log(
      `[purchase-with-balance-proxy][${requestId}] Calling purchase_tickets_with_balance RPC`
    );

    // SAFEGUARD 1: Call RPC with automatic retry (up to 2 retries)
    const { data: rpcResult, error: rpcError } = await callRpcWithRetry(
      supabase,
      {
        canonicalUserId,
        competitionId,
        ticketPrice,
        ticketCount,
        ticketNumbers,
        idempotencyKey,
      },
      requestId
    );

    // SAFEGUARD 2: If RPC completely failed, use direct database fallback
    let finalResult = rpcResult;
    if (rpcError || !rpcResult) {
      console.error(
        `[purchase-with-balance-proxy][${requestId}] RPC failed after retries, attempting direct DB fallback`
      );

      // For direct fallback, we need actual ticket numbers (not just a count)
      const fallbackTicketNumbers = ticketNumbers || [];
      if (fallbackTicketNumbers.length === 0 && ticketCount && ticketCount > 0) {
        // We can't do lucky dip in the fallback - need the RPC for that
        // But we can still try one more RPC call with a longer timeout
        console.warn(
          `[purchase-with-balance-proxy][${requestId}] Lucky dip not supported in fallback, need ticket numbers`
        );
        return errorResponse(
          "RPC_ERROR",
          rpcError?.message || "Purchase service temporarily unavailable. Please try again.",
          500
        );
      }

      const fallbackResult = await directDatabaseFallback(
        supabase,
        {
          canonicalUserId,
          competitionId,
          ticketPrice,
          ticketNumbers: fallbackTicketNumbers,
          idempotencyKey,
        },
        requestId
      );

      if (!fallbackResult.success) {
        return errorResponse(
          "PURCHASE_FAILED",
          fallbackResult.error || "Purchase failed after all attempts",
          500
        );
      }

      finalResult = fallbackResult.data;
    }

    if (!finalResult) {
      console.error(
        `[purchase-with-balance-proxy][${requestId}] No result from any attempt`
      );
      return errorResponse(
        "RPC_ERROR",
        "No response from purchase function",
        500
      );
    }

    console.log(
      `[purchase-with-balance-proxy][${requestId}] Result:`,
      JSON.stringify({
        success: finalResult.success,
        ticketCount: finalResult.ticket_count,
        idempotent: finalResult.idempotent,
        hasError: !!finalResult.error,
        fallback: !!finalResult.fallback,
      })
    );

    // The RPC returns {success, error, entry_id, ticket_numbers, ticket_count, total_cost, available_balance, ...}
    if (!finalResult.success) {
      const errorCode = finalResult.error_code || "PURCHASE_FAILED";
      const errorMessage = finalResult.error || "Purchase failed";

      // Map specific error codes to HTTP status codes
      let httpStatus = 400;
      if (errorCode === "INSUFFICIENT_BALANCE") httpStatus = 402;
      if (errorCode === "NO_BALANCE_RECORD") httpStatus = 404;

      return errorResponse(errorCode, errorMessage, httpStatus);
    }

    // If reservation was used, update its status (non-blocking)
    if (reservationId) {
      supabase
        .from("pending_tickets")
        .update({
          status: "confirmed",
          payment_provider: "balance",
          confirmed_at: new Date().toISOString(),
        })
        .eq("id", reservationId)
        .then(({ error }) => {
          if (error) {
            console.warn(
              `[purchase-with-balance-proxy][${requestId}] Failed to update reservation:`,
              error.message
            );
          }
        });
    }

    // Transform RPC result to match the format the client expects:
    // { status: 'ok', competition_id, tickets: [{ticket_number}], entry_id, total_cost, available_balance }
    const ticketNumbersResult: number[] = finalResult.ticket_numbers || [];
    const responseData = {
      status: "ok",
      success: true,
      competition_id: finalResult.competition_id || competitionId,
      tickets: ticketNumbersResult.map((num: number) => ({
        ticket_number: num,
      })),
      entry_id: finalResult.entry_id,
      total_cost: finalResult.total_cost,
      new_balance: finalResult.available_balance,
      available_balance: finalResult.available_balance,
      idempotent: finalResult.idempotent || false,
      message: `Successfully purchased ${ticketNumbersResult.length} tickets`,
    };

    console.log(
      `[purchase-with-balance-proxy][${requestId}] Success: ${ticketNumbersResult.length} tickets purchased`
    );

    return jsonResponse(responseData);
  } catch (error) {
    console.error(
      `[purchase-with-balance-proxy][${requestId}] Error:`,
      error
    );
    return errorResponse(
      "INTERNAL_ERROR",
      error instanceof Error ? error.message : "Internal server error",
      500
    );
  }
};
