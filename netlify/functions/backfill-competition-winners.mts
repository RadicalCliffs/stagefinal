import type { Config } from "@netlify/functions";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { toPrizePid } from "./_shared/userId.mts";

/**
 * Backfill Competition Winners Function
 *
 * This function finds all completed competitions from the past three months
 * that have sold tickets but no winner assigned, and draws a winner for each.
 *
 * The RNG implementation ONLY selects from actually purchased tickets,
 * ensuring a winner is always from those who bought tickets.
 *
 * Can be triggered manually or scheduled to run periodically.
 */

export const config: Config = {
  // Run once daily at 3 AM to catch any missed winners
  schedule: "0 3 * * *",
};

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

// ---------- Retry helpers ----------
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 250;

async function withRetries<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[BackfillWinners] ${label} failed (attempt ${attempt}/${MAX_RETRIES}): ${msg}`);
      if (attempt < MAX_RETRIES) {
        const delay = INITIAL_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 150;
        await sleep(delay);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ---------- RNG utilities for winner selection ----------
// Uses cryptographically secure random selection from purchased tickets only
function generateSecureRandom(): number {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return array[0] / (0xFFFFFFFF + 1);
}

/**
 * Select a winning ticket from ONLY the purchased tickets.
 * This ensures the winner is ALWAYS someone who bought a ticket.
 * The function keeps generating random selections from purchased tickets only.
 */
function selectWinnerFromPurchasedTickets(purchasedTicketNumbers: number[]): number {
  if (purchasedTicketNumbers.length === 0) {
    throw new Error('Cannot select winner from empty ticket list');
  }
  const randomNumber = generateSecureRandom();
  const randomIndex = Math.floor(randomNumber * purchasedTicketNumbers.length);
  return purchasedTicketNumbers[randomIndex];
}

// ---------- Competition entry interface ----------
interface CompetitionEntry {
  uid: string;
  competitionid: string;
  userid: string;
  wallet_address: string | null;
  numberoftickets: number;
  ticketnumbers: string | null;
  amountspent: number;
  purchasedate: string;
  privy_user_id?: string;
}

// ---------- Notification helper functions ----------

/**
 * Create a winner notification in the database
 */
async function createWinnerNotification(
  supabase: SupabaseClient,
  profileId: string,
  competition: any,
  ticketNumber: number
): Promise<void> {
  try {
    const { error } = await supabase.from("user_notifications").insert({
      user_id: profileId,
      type: "win",
      title: "🎉 Congratulations! You Won!",
      message: `You have won ${competition.title}! Your winning ticket was #${ticketNumber}. Check your entries for more details.`,
      competition_id: competition.id,
      prize_info: competition.prize_value ? `£${competition.prize_value}` : competition.title,
      read: false,
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.error("[BackfillWinners] Error creating winner notification:", error);
    } else {
      console.log(`[BackfillWinners] Winner notification created for user ${profileId}`);
    }
  } catch (err) {
    console.error("[BackfillWinners] Error in createWinnerNotification:", err);
  }
}

/**
 * Send winner email using SendGrid dynamic template
 */
async function sendWinnerEmail(
  email: string,
  username: string,
  competitionTitle: string,
  prizeValue: string,
  ticketNumber: number,
  competitionId: string
): Promise<void> {
  const sendgridApiKey = Netlify.env.get("SENDGRID_API_KEY");
  const fromEmail = Netlify.env.get("SENDGRID_FROM_EMAIL") || "contact@theprize.io";
  const templateId = Netlify.env.get("SENDGRID_TEMPLATE_WINNER");

  if (!sendgridApiKey || !templateId) {
    console.log("[BackfillWinners] SendGrid winner email not configured, skipping");
    return;
  }

  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sendgridApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{
          to: [{ email }],
          dynamic_template_data: {
            "Player Username": username,
            "Competition Name": competitionTitle,
            "Prize Value": prizeValue,
            "Winning Ticket": `#${ticketNumber}`,
            Competition_URL: `https://theprize.io/competitions/${competitionId}`,
          },
        }],
        from: { email: fromEmail, name: "ThePrize.io" },
        template_id: templateId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[BackfillWinners] Winner email failed:`, errorText);
    } else {
      console.log(`[BackfillWinners] Winner email sent to ${email}`);
    }
  } catch (error) {
    console.error(`[BackfillWinners] Winner email error:`, error);
  }
}

// ---------- Core functions ----------

/**
 * Get all entries for a competition, checking both UUID and legacy uid
 */
async function getCompetitionEntries(
  supabase: SupabaseClient,
  competitionId: string,
  competitionUid: string | null
): Promise<CompetitionEntry[]> {
  // Try with UUID first
  let { data, error } = await withRetries("fetch entries by id", () =>
    supabase
      .from("joincompetition")
      .select("*")
      .eq("competitionid", competitionId)
  );

  // If no results, try with legacy uid
  if ((!data || data.length === 0) && competitionUid) {
    const uidResult = await withRetries("fetch entries by uid", () =>
      supabase
        .from("joincompetition")
        .select("*")
        .eq("competitionid", competitionUid)
    );
    if (!uidResult.error && uidResult.data && uidResult.data.length > 0) {
      data = uidResult.data;
    }
  }

  if (error) {
    console.error("[BackfillWinners] Error fetching entries:", error);
    return [];
  }

  return data || [];
}

/**
 * Create a winner record for a competition
 */
async function createWinner(
  supabase: SupabaseClient,
  competition: any,
  entry: CompetitionEntry,
  ticketNumber: number
): Promise<boolean> {
  try {
    // Check if winner already exists
    const { data: existingWinner } = await supabase
      .from("winners")
      .select("*")
      .eq("competition_id", competition.id)
      .maybeSingle();

    if (existingWinner) {
      console.log(`[BackfillWinners] Winner already exists for competition ${competition.id}`);
      return false;
    }

    // Get user details - try multiple lookup strategies
    let userData = null;
    const userId = entry.userid || entry.privy_user_id;

    if (userId) {
      // Try lookup by privy_user_id
      const { data: userByPrivy } = await supabase
        .from("canonical_users")
        .select("id, username, email, country, wallet_address")
        .eq("privy_user_id", userId)
        .maybeSingle();

      if (userByPrivy) {
        userData = userByPrivy;
      } else {
        // Try by direct ID
        const { data: userById } = await supabase
          .from("canonical_users")
          .select("id, username, email, country, wallet_address")
          .eq("id", userId)
          .maybeSingle();
        userData = userById;
      }
    }

    // If still no user data, try by wallet address
    if (!userData && entry.wallet_address) {
      const { data: userByWallet } = await supabase
        .from("canonical_users")
        .select("id, username, email, country, wallet_address")
        .eq("wallet_address", entry.walletaddress)
        .maybeSingle();
      userData = userByWallet;
    }

    // Convert user id to canonical format for consistent storage
    const canonicalUserId = toPrizePid(userData?.id || userId);

    // Robust username lookup - try additional strategies if userData is incomplete
    let finalUsername = userData?.username;
    if (!finalUsername && entry.walletaddress) {
      const { data: walletUser } = await supabase
        .from("canonical_users")
        .select("username")
        .or(`wallet_address.ilike.${entry.walletaddress},canonical_user_id.eq.prize:pid:${entry.walletaddress.toLowerCase()}`)
        .maybeSingle();
      finalUsername = walletUser?.username;
    }
    
    if (!finalUsername) {
      console.error(`[BackfillWinners] ❌ CRITICAL: User not found for comp ${competition.id}, entry ${entry.walletaddress || userId}`);
      finalUsername = "Unknown";
    }

    // Create winner record
    const winnerData = {
      competition_id: competition.id,
      user_id: canonicalUserId,
      ticket_number: ticketNumber,
      prize_value: competition.prize_value || 0,
      prize_claimed: false,
      username: finalUsername,
      country: userData?.country || null,
      wallet_address: entry.walletaddress || userData?.wallet_address || null,
      crdate: new Date().toISOString(),
    };

    const { error } = await withRetries("insert winner", () =>
      supabase.from("winners").insert(winnerData)
    );

    if (error) {
      console.error("[BackfillWinners] Error creating winner:", error);
      return false;
    }

    console.log(`[BackfillWinners] Winner created for ${competition.title}: ticket #${ticketNumber}`);

    // Create winner notification and send email
    // Use the profile ID (UUID) for notification storage
    const profileId = userData?.id || userId;
    if (profileId) {
      await createWinnerNotification(supabase, profileId, competition, ticketNumber);
    }

    // Send winner email if user has an email address
    if (userData?.email) {
      const prizeValue = competition.prize_value ? `£${competition.prize_value}` : competition.title;
      await sendWinnerEmail(
        userData.email,
        userData.username || "Player",
        competition.title,
        prizeValue,
        ticketNumber,
        competition.id
      );
    }

    return true;
  } catch (error) {
    console.error("[BackfillWinners] Error in createWinner:", error);
    return false;
  }
}

/**
 * Mark competition as drawn/completed if not already
 */
async function ensureCompetitionCompleted(supabase: SupabaseClient, competition: any): Promise<void> {
  if (competition.status !== "completed") {
    await withRetries("mark as completed", () =>
      supabase
        .from("competitions")
        .update({
          status: "completed",
          competitionended: 1,
          draw_date: competition.draw_date || new Date().toISOString(),
        })
        .eq("id", competition.id)
    );
  }
}

/**
 * Draw a winner for a competition that doesn't have one
 */
async function drawWinnerForCompetition(
  supabase: SupabaseClient,
  competition: any
): Promise<{ success: boolean; reason: string }> {
  console.log(`[BackfillWinners] Processing: ${competition.title} (${competition.id})`);

  // Skip instant win competitions - winners are determined at purchase
  if (competition.is_instant_win) {
    return { success: false, reason: "instant_win" };
  }

  // Get all entries for this competition
  const entries = await getCompetitionEntries(supabase, competition.id, competition.uid);

  if (entries.length === 0) {
    console.log(`[BackfillWinners] No entries for ${competition.id}`);
    await ensureCompetitionCompleted(supabase, competition);
    return { success: false, reason: "no_entries" };
  }

  // Extract all purchased ticket numbers
  const allTicketNumbers: number[] = [];
  const ticketToEntryMap = new Map<number, CompetitionEntry>();

  for (const entry of entries) {
    if (entry.ticketnumbers) {
      const ticketNumbers = entry.ticketnumbers
        .split(",")
        .map((t) => parseInt(t.trim()))
        .filter((t) => !isNaN(t) && t > 0);

      ticketNumbers.forEach((ticketNum) => {
        allTicketNumbers.push(ticketNum);
        ticketToEntryMap.set(ticketNum, entry);
      });
    }
  }

  if (allTicketNumbers.length === 0) {
    console.log(`[BackfillWinners] No valid tickets for ${competition.id}`);
    await ensureCompetitionCompleted(supabase, competition);
    return { success: false, reason: "no_tickets" };
  }

  console.log(`[BackfillWinners] Found ${allTicketNumbers.length} purchased tickets for ${competition.title}`);

  // Select winning ticket from ONLY purchased tickets
  // This is the key: RNG only chooses from tickets that were actually bought
  const winningTicketNumber = selectWinnerFromPurchasedTickets(allTicketNumbers);
  const winningEntry = ticketToEntryMap.get(winningTicketNumber);

  if (!winningEntry) {
    console.error(`[BackfillWinners] Unexpected: winning ticket ${winningTicketNumber} not in map`);
    return { success: false, reason: "ticket_map_error" };
  }

  // Create winner record
  const created = await createWinner(supabase, competition, winningEntry, winningTicketNumber);

  if (created) {
    await ensureCompetitionCompleted(supabase, competition);
    console.log(`[BackfillWinners] Winner drawn: ${competition.title} -> ticket #${winningTicketNumber}`);
    return { success: true, reason: "winner_created" };
  }

  return { success: false, reason: "winner_creation_failed" };
}

/**
 * Find and process all competitions from the past 3 months without winners
 */
async function backfillMissingWinners(supabase: SupabaseClient): Promise<{
  processed: number;
  winnersCreated: number;
  noEntries: number;
  alreadyHasWinner: number;
  errors: number;
}> {
  const stats = {
    processed: 0,
    winnersCreated: 0,
    noEntries: 0,
    alreadyHasWinner: 0,
    errors: 0,
  };

  // Calculate 3 months ago
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  console.log(`[BackfillWinners] Looking for competitions since ${threeMonthsAgo.toISOString()}`);

  // Get all competitions that:
  // 1. Were created in the last 3 months OR have end_date in last 3 months
  // 2. Have status 'completed' OR end_date has passed
  // 3. Are NOT instant win (those winners are determined at purchase)
  const { data: competitions, error } = await withRetries("fetch competitions", () =>
    supabase
      .from("competitions")
      .select("*")
      .eq("is_instant_win", false)
      .or(
        `created_at.gte.${threeMonthsAgo.toISOString()},end_date.gte.${threeMonthsAgo.toISOString()}`
      )
      .order("created_at", { ascending: false })
  );

  if (error) {
    console.error("[BackfillWinners] Error fetching competitions:", error);
    return stats;
  }

  if (!competitions || competitions.length === 0) {
    console.log("[BackfillWinners] No competitions found in the last 3 months");
    return stats;
  }

  console.log(`[BackfillWinners] Found ${competitions.length} competitions to check`);

  // Filter to only expired or completed competitions
  const now = new Date();
  const expiredCompetitions = competitions.filter((c) => {
    const endDate = c.end_date ? new Date(c.end_date) : null;
    return c.status === "completed" || (endDate && endDate < now);
  });

  console.log(`[BackfillWinners] ${expiredCompetitions.length} are expired/completed`);

  // Check which ones already have winners
  const competitionIds = expiredCompetitions.map((c) => c.id);
  const { data: existingWinners } = await supabase
    .from("winners")
    .select("competition_id")
    .in("competition_id", competitionIds);

  const competitionsWithWinners = new Set(
    (existingWinners || []).map((w) => w.competition_id)
  );

  // Process each competition without a winner
  for (const competition of expiredCompetitions) {
    stats.processed++;

    if (competitionsWithWinners.has(competition.id)) {
      stats.alreadyHasWinner++;
      continue;
    }

    try {
      const result = await drawWinnerForCompetition(supabase, competition);

      if (result.success) {
        stats.winnersCreated++;
      } else if (result.reason === "no_entries" || result.reason === "no_tickets") {
        stats.noEntries++;
      } else {
        stats.errors++;
      }
    } catch (error) {
      console.error(`[BackfillWinners] Error processing ${competition.id}:`, error);
      stats.errors++;
    }
  }

  return stats;
}

/**
 * Sync competition_winners table with winners data
 */
async function syncCompetitionWinners(supabase: SupabaseClient): Promise<void> {
  console.log("[BackfillWinners] Syncing competition_winners table...");

  try {
    // Call the sync function if it exists
    const { error } = await supabase.rpc("sync_all_winners_to_competition_winners");
    if (error) {
      // If RPC doesn't exist, that's okay - the trigger should handle it
      console.log("[BackfillWinners] sync_all_winners_to_competition_winners RPC not available, using trigger");
    } else {
      console.log("[BackfillWinners] competition_winners synced successfully");
    }
  } catch (e) {
    console.log("[BackfillWinners] Sync function not available, relying on triggers");
  }
}

// ---------- Main handler ----------
export default async (req: Request): Promise<Response> => {
  const startTime = Date.now();

  try {
    const { next_run } = await req.json();
    console.log(`[BackfillWinners] Scheduled function triggered. Next run: ${next_run}`);
  } catch {
    console.log("[BackfillWinners] Function triggered (manual invoke)");
  }

  try {
    const supabase = getSupabase();

    // Run the backfill process
    const stats = await backfillMissingWinners(supabase);

    // Sync the competition_winners table
    await syncCompetitionWinners(supabase);

    const elapsed = Date.now() - startTime;
    const summary = {
      success: true,
      elapsed_ms: elapsed,
      processed: stats.processed,
      winners_created: stats.winnersCreated,
      no_entries: stats.noEntries,
      already_had_winner: stats.alreadyHasWinner,
      errors: stats.errors,
    };

    console.log(`[BackfillWinners] Completed in ${elapsed}ms:`, summary);

    return new Response(JSON.stringify(summary), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[BackfillWinners] Fatal error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
