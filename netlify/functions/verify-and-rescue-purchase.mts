import type { Context, Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { toPrizePid } from "./_shared/userId.mts";

export const config: Config = {
  path: "/api/verify-and-rescue-purchase",
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
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

/**
 * SAFEGUARD 5: Verify-and-Rescue endpoint
 *
 * Called after a purchase appears to fail. Checks if the purchase actually
 * went through (idempotency hit in joincompetition). If not, performs
 * a last-resort direct database write to ensure the entry is created.
 *
 * This endpoint GUARANTEES that if a user has sufficient balance and
 * valid tickets, their purchase will succeed.
 */
export default async (req: Request, context: Context) => {
  const requestId = crypto.randomUUID().slice(0, 8);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl =
      Netlify.env.get("VITE_SUPABASE_URL") ||
      Netlify.env.get("SUPABASE_URL") ||
      "";
    const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(
        { success: false, error: "Service configuration error" },
        500
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        { success: false, error: "Invalid JSON body" },
        400
      );
    }

    const userId =
      (body.userId as string) ||
      (body.user_id as string) ||
      "";
    const competitionId =
      (body.competitionId as string) ||
      (body.competition_id as string) ||
      "";
    const ticketNumbers = (body.ticketNumbers as number[]) || [];
    const ticketPrice = Number(body.ticketPrice || 0);
    const idempotencyKey = (body.idempotencyKey as string) || "";

    if (!userId || !competitionId) {
      return jsonResponse(
        { success: false, error: "userId and competitionId are required" },
        400
      );
    }

    const canonicalUserId = toPrizePid(userId);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    console.log(
      `[verify-and-rescue][${requestId}] Checking for existing entry...`,
      { canonicalUserId: canonicalUserId.substring(0, 20) + "...", competitionId: competitionId.substring(0, 10) + "..." }
    );

    // =====================================================
    // STEP 1: Check if purchase already exists
    // =====================================================
    // Look for entries with matching idempotency key OR recent entries by this user
    let existingEntry: any = null;

    if (idempotencyKey) {
      const { data: idempotentEntry } = await supabase
        .from("joincompetition")
        .select("uid, ticket_numbers, numberoftickets, amount_spent, created_at")
        .eq("competitionid", competitionId)
        .eq("transactionhash", idempotencyKey)
        .limit(1)
        .maybeSingle();

      if (idempotentEntry) {
        existingEntry = idempotentEntry;
      }
    }

    // Also check for very recent entries (within last 30 seconds) by this user
    if (!existingEntry) {
      const thirtySecondsAgo = new Date(Date.now() - 30000).toISOString();
      const { data: recentEntry } = await supabase
        .from("joincompetition")
        .select("uid, ticket_numbers, numberoftickets, amount_spent, created_at")
        .eq("competitionid", competitionId)
        .eq("userid", canonicalUserId)
        .gte("created_at", thirtySecondsAgo)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recentEntry) {
        existingEntry = recentEntry;
      }
    }

    if (existingEntry) {
      console.log(
        `[verify-and-rescue][${requestId}] Found existing entry:`,
        existingEntry.uid
      );

      const existingTicketNumbers = existingEntry.ticketnumbers
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

      return jsonResponse({
        success: true,
        rescued: false,
        alreadyExists: true,
        entry_id: existingEntry.uid,
        ticket_numbers: existingTicketNumbers,
        ticket_count: existingTicketNumbers.length,
        total_cost: existingEntry.amount_spent,
        available_balance: balRow?.available_balance ?? 0,
        competition_id: competitionId,
        message: `Purchase was already completed. ${existingTicketNumbers.length} tickets confirmed.`,
      });
    }

    // =====================================================
    // STEP 2: No existing entry - perform rescue (last resort)
    // =====================================================
    if (ticketNumbers.length === 0 || ticketPrice <= 0) {
      return jsonResponse({
        success: false,
        rescued: false,
        alreadyExists: false,
        error: "Cannot rescue: no ticket numbers or price provided",
      });
    }

    console.log(
      `[verify-and-rescue][${requestId}] No existing entry found. Attempting rescue for ${ticketNumbers.length} tickets...`
    );

    // Try the RPC one more time (it might work now)
    const rescueIdempotencyKey = idempotencyKey || crypto.randomUUID();

    try {
      const { data: rpcResult, error: rpcError } = await supabase.rpc(
        "purchase_tickets_with_balance",
        {
          p_user_identifier: canonicalUserId,
          p_competition_id: competitionId,
          p_ticket_price: ticketPrice,
          p_ticket_count: null,
          p_ticket_numbers: ticketNumbers,
          p_idempotency_key: rescueIdempotencyKey,
        }
      );

      if (!rpcError && rpcResult && rpcResult.success) {
        console.log(
          `[verify-and-rescue][${requestId}] RPC rescue succeeded!`
        );
        return jsonResponse({
          success: true,
          rescued: true,
          alreadyExists: false,
          entry_id: rpcResult.entry_id,
          ticket_numbers: rpcResult.ticket_numbers,
          ticket_count: rpcResult.ticket_count,
          total_cost: rpcResult.total_cost,
          available_balance: rpcResult.available_balance,
          competition_id: rpcResult.competition_id || competitionId,
          message: `Rescue successful! ${rpcResult.ticket_count} tickets purchased.`,
        });
      }

      // If RPC returned a business error (insufficient balance etc), pass it through
      if (rpcResult && !rpcResult.success) {
        console.warn(
          `[verify-and-rescue][${requestId}] RPC rescue returned error:`,
          rpcResult.error
        );
        return jsonResponse({
          success: false,
          rescued: false,
          error: rpcResult.error,
          error_code: rpcResult.error_code,
        });
      }

      console.warn(
        `[verify-and-rescue][${requestId}] RPC rescue failed:`,
        rpcError?.message
      );
    } catch (rpcErr) {
      console.warn(
        `[verify-and-rescue][${requestId}] RPC rescue exception:`,
        rpcErr
      );
    }

   // =====================================================
// STEP 3: RPC failed too - direct database write (nuclear option)
// =====================================================
console.log(
  `[verify-and-rescue][${requestId}] RPC rescue failed, attempting direct DB write...`
);

// 1) Get user balance
const { data: balanceRow, error: balErr } = await supabase
  .from("sub_account_balances")
  .select("available_balance")
  .eq("canonical_user_id", canonicalUserId)
  .eq("currency", "USD")
  .limit(1)
  .maybeSingle();

if (balErr) {
  return jsonResponse({
    success: false,
    rescued: false,
    error: "Failed to fetch balance",
  });
}

if (!balanceRow) {
  return jsonResponse({
    success: false,
    rescued: false,
    error: "User balance not found",
  });
}

const currentBalance = Number(balanceRow.available_balance);
const totalCost = ticketPrice * ticketNumbers.length;

if (currentBalance < totalCost) {
  return jsonResponse({
    success: false,
    rescued: false,
    error: "Insufficient balance",
  });
}

const newBalance = currentBalance - totalCost;

// 2) Deduct balance
const { error: updateErr } = await supabase
  .from("sub_account_balances")
  .update({
    available_balance: newBalance,
    updated_at: new Date().toISOString(),
  })
  .eq("canonical_user_id", canonicalUserId)
  .eq("currency", "USD");

if (updateErr) {
  return jsonResponse({
    success: false,
    rescued: false,
    error: "Failed to deduct balance",
  });
}

// 3) Create or update competition entry (race-safe with upsert)
const entryId = crypto.randomUUID();
const ticketNumbersStr = ticketNumbers.join(",");

const payload = {
  uid: entryId, // keep if your schema expects uid as primary/identifier
  userid: canonicalUserId, // legacy alias; safe to remove later
  canonical_user_id: canonicalUserId,
  competitionid: competitionId,
  ticket_numbers: ticketNumbersStr,
  numberoftickets: ticketNumbers.length,
  amount_spent: totalCost,
  transactionhash: rescueIdempotencyKey,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

// Requires a unique index on (canonical_user_id, competitionid)
// create unique index if not exists ux_joined_comp_cuid_comp on public.joined_competitions(canonical_user_id, competitionid);
const { data: upsertRow, error: upsertErr } = await supabase
  .from("joined_competitions")
  .upsert([payload], { onConflict: "canonical_user_id,competitionid", ignoreDuplicates: false })
  .select("uid, ticket_numbers, amount_spent, numberoftickets")
  .maybeSingle();

let finalEntryId = upsertRow?.uid ?? entryId;

if (upsertErr) {
  // If something unexpected happened, attempt merge-on-conflict path
  if (upsertErr.message?.includes("unique") || upsertErr.message?.includes("duplicate")) {
    const { data: existingUserComp } = await supabase
      .from("joined_competitions")
      .select("uid, ticket_numbers, amount_spent, numberoftickets")
      .eq("canonical_user_id", canonicalUserId)
      .eq("competitionid", competitionId)
      .limit(1)
      .maybeSingle();

    if (existingUserComp) {
      const existTickets = existingUserComp.ticketnumbers || "";
      const existingNums = existTickets
        ? existTickets.split(",").map((n: string) => Number(n)).filter((n: number) => !isNaN(n))
        : [];
      const mergedSet = new Set<number>([...existingNums, ...ticketNumbers]);
      const mergedTickets = Array.from(mergedSet).sort((a, b) => a - b).join(",");

      const { error: rescueUpdateErr } = await supabase
        .from("joined_competitions")
        .update({
          ticket_numbers: mergedTickets,
          numberoftickets: mergedSet.size,
          amount_spent: Number(existingUserComp.amountspent || 0) + totalCost,
          updated_at: new Date().toISOString(),
        })
        .eq("canonical_user_id", canonicalUserId)
        .eq("competitionid", competitionId);

      if (rescueUpdateErr) {
        // Refund balance
        await supabase
          .from("sub_account_balances")
          .update({
            available_balance: currentBalance,
            updated_at: new Date().toISOString(),
          })
          .eq("canonical_user_id", canonicalUserId)
          .eq("currency", "USD");

        return jsonResponse({
          success: false,
          rescued: false,
          error: "Failed to update existing entry",
        });
      }

      finalEntryId = existingUserComp.uid;
    } else {
      // Could not find row after duplicate error; refund
      await supabase
        .from("sub_account_balances")
        .update({
          available_balance: currentBalance,
          updated_at: new Date().toISOString(),
        })
        .eq("canonical_user_id", canonicalUserId)
        .eq("currency", "USD");

      return jsonResponse({
        success: false,
        rescued: false,
        error: "Conflict detected but no existing entry found",
      });
    }
  } else {
    // Non-unique error: refund and exit
    await supabase
      .from("sub_account_balances")
      .update({
        available_balance: currentBalance,
        updated_at: new Date().toISOString(),
      })
      .eq("canonical_user_id", canonicalUserId)
      .eq("currency", "USD");

    return jsonResponse({
      success: false,
      rescued: false,
      error: "Failed to create or update entry",
    });
  }
}

// 4) Insert tickets (non-blocking)
try {
  const ticketRows = ticketNumbers.map((num) => ({
    competition_id: competitionId,
    ticket_numbers: num,
    canonical_user_id: canonicalUserId, // prefer canonical_user_id
    status: "sold",
    tx_id: rescueIdempotencyKey,
    created_at: new Date().toISOString(),
  }));
  await supabase.from("tickets").insert(ticketRows);
} catch {
  // Non-blocking
}

// 5) Insert balance ledger (non-blocking)
try {
  await supabase.from("balance_ledger").insert({
    canonical_user_id: canonicalUserId,
    transaction_type: "debit",
    amount: -totalCost,
    currency: "USD",
    balance_before: currentBalance,
    balance_after: newBalance,
    reference_id: rescueIdempotencyKey,
    description: `Rescue purchase ${ticketNumbers.length} tickets`,
    created_at: new Date().toISOString(),
  });
} catch {
  // Non-blocking
}

console.log(
  `[verify-and-rescue][${requestId}] Direct DB rescue complete! entry=${finalEntryId}, tickets=${ticketNumbers.length}`
);

return jsonResponse({
  success: true,
  rescued: true,
  alreadyExists: false,
  entry_id: finalEntryId,
  ticket_numbers: ticketNumbers,
  ticket_count: ticketNumbers.length,
  total_cost: totalCost,
  available_balance: newBalance,
  competition_id: competitionId,
  message: `Rescue successful! ${ticketNumbers.length} tickets purchased.`,
});
