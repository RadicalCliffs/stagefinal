import type { Config } from "@netlify/functions";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { toPrizePid } from "./_shared/userId.mts";

/**
 * Competition Lifecycle Checker - Scheduled Function
 *
 * This function runs every 5 minutes to check for:
 * 1. Expired competitions (past end_date) that need to be drawn
 * 2. Sold-out competitions that need to be completed
 *
 * Moving this logic server-side eliminates client-side network issues
 * and ensures reliable competition lifecycle management.
 */

export const config: Config = {
  schedule: "*/5 * * * *", // Run every 5 minutes
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
      console.warn(`[Lifecycle] ${label} failed (attempt ${attempt}/${MAX_RETRIES}): ${msg}`);
      if (attempt < MAX_RETRIES) {
        const delay = INITIAL_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 150;
        await sleep(delay);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ---------- RNG utilities for winner selection ----------
function generateSecureRandom(): number {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return array[0] / (0xFFFFFFFF + 1);
}

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
}

// ---------- Core lifecycle functions ----------

/**
 * Get all entries for a competition
 * Uses RPC function to handle both UUID and legacy uid formats
 */
async function getCompetitionEntries(
  supabase: SupabaseClient,
  competitionId: string,
  competitionUid: string | null = null
): Promise<CompetitionEntry[]> {
  // Try using the RPC function first (handles both UUID and legacy uid)
  const { data: rpcData, error: rpcError } = await withRetries("fetch entries via RPC", () =>
    supabase.rpc('get_joincompetition_entries_for_competition', {
      p_competition_id: competitionId
    })
  );

  if (!rpcError && rpcData && rpcData.length > 0) {
    console.log(`[Lifecycle] Found ${rpcData.length} entries via RPC for competition ${competitionId}`);
    return rpcData;
  }

  // Fallback to direct query if RPC fails
  console.warn(`[Lifecycle] RPC failed (${rpcError?.message}), falling back to direct query`);

  // Build OR filter for both competition ID and legacy uid
  const orFilter = competitionUid && competitionUid !== competitionId
    ? `competitionid.eq.${competitionId},competitionid.eq.${competitionUid}`
    : `competitionid.eq.${competitionId}`;

  // Get entries from joincompetition table
  let { data: joinData, error: joinError } = await withRetries("fetch joincompetition entries", () =>
    supabase
      .from("joincompetition")
      .select("*")
      .or(orFilter)
  );

  if (joinError) {
    console.error("[Lifecycle] Error fetching joincompetition entries:", joinError);
  }

  const entries: CompetitionEntry[] = joinData || [];

  // Also get tickets from tickets table that are not in joincompetition
  const { data: ticketsData, error: ticketsError } = await withRetries("fetch tickets entries", () =>
    supabase
      .from("tickets")
      .select("ticket_number, competition_id, privy_user_id, user_id, created_at, purchase_price")
      .eq("competition_id", competitionId)
  );

  if (ticketsError) {
    console.error("[Lifecycle] Error fetching tickets entries:", ticketsError);
  }

  // Collect existing ticket numbers from joincompetition to avoid duplicates
  const existingTicketNumbers = new Set<number>();
  entries.forEach(entry => {
    if (entry.ticketnumbers) {
      const nums = entry.ticketnumbers.split(",").map(n => parseInt(n.trim())).filter(n => !isNaN(n));
      nums.forEach(num => existingTicketNumbers.add(num));
    }
  });

  // Group tickets by user and add as entries if not already in joincompetition
  if (ticketsData && ticketsData.length > 0) {
    const ticketsByUser = new Map<string, any[]>();

    for (const ticket of ticketsData) {
      // Skip if this ticket is already counted in joincompetition
      if (existingTicketNumbers.has(ticket.ticket_number)) continue;

      const userId = ticket.privy_user_id || ticket.user_id || 'unknown';
      if (!ticketsByUser.has(userId)) {
        ticketsByUser.set(userId, []);
      }
      ticketsByUser.get(userId)!.push(ticket);
    }

    // Convert grouped tickets into CompetitionEntry format
    for (const [userId, userTickets] of ticketsByUser) {
      const ticketNumbers = userTickets.map(t => t.ticket_number).sort((a, b) => a - b);
      const entry: CompetitionEntry = {
        uid: `tickets-${userId}-${competitionId}`,
        competitionid: competitionId,
        userid: userId,
        wallet_address: null,
        numberoftickets: ticketNumbers.length,
        ticketnumbers: ticketNumbers.join(','),
        amountspent: userTickets.reduce((sum, t) => sum + (t.purchase_price || 0), 0),
        purchasedate: userTickets[0]?.created_at || new Date().toISOString(),
      };
      entries.push(entry);
    }
  }

  const entriesCount = entries.length;
  console.log(`[Lifecycle] Found ${entriesCount} entries using combined query (joincompetition + tickets)`);

  if (entriesCount > 0) {
    // Log sample of competitionid values to verify format matching
    const sampleIds = entries.slice(0, 3).map(e => e.competitionid);
    console.log(`[Lifecycle] Sample competitionid values from entries: ${sampleIds.join(', ')}`);
  }

  return entries;
}

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
      console.error("[Lifecycle] Error creating winner notification:", error);
    } else {
      console.log(`[Lifecycle] Winner notification created for user ${profileId}`);
    }
  } catch (err) {
    console.error("[Lifecycle] Error in createWinnerNotification:", err);
  }
}

/**
 * Create a competition ended (loss) notification for non-winning participants
 */
async function createLossNotification(
  supabase: SupabaseClient,
  profileId: string,
  competition: any
): Promise<void> {
  try {
    const { error } = await supabase.from("user_notifications").insert({
      user_id: profileId,
      type: "competition_ended",
      title: "Competition Ended",
      message: `The competition "${competition.title}" has ended. Unfortunately, you didn't win this time. Check out our other competitions for more chances to win!`,
      competition_id: competition.id,
      read: false,
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.error("[Lifecycle] Error creating loss notification:", error);
    }
  } catch (err) {
    console.error("[Lifecycle] Error in createLossNotification:", err);
  }
}

/**
 * Notify all non-winning participants that the competition has ended
 */
async function notifyLosingParticipants(
  supabase: SupabaseClient,
  competition: any,
  entries: CompetitionEntry[],
  winnerUserId: string | null
): Promise<void> {
  console.log(`[Lifecycle] Notifying non-winners for competition ${competition.id}...`);

  // Get unique user IDs from entries (excluding the winner)
  const participantUserIds = new Set<string>();
  for (const entry of entries) {
    if (entry.userid && entry.userid !== winnerUserId) {
      participantUserIds.add(entry.userid);
    }
  }

  console.log(`[Lifecycle] Found ${participantUserIds.size} non-winning participants to notify`);

  // Batch notification creation for efficiency
  const notifications: Array<{
    user_id: string;
    type: string;
    title: string;
    message: string;
    competition_id: string;
    read: boolean;
    created_at: string;
  }> = [];

  for (const userId of participantUserIds) {
    // Look up the user's profile ID (UUID) for notification storage
    const { data: profile } = await supabase
      .from("canonical_users")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    if (profile?.id) {
      notifications.push({
        user_id: profile.id,
        type: "competition_ended",
        title: "Competition Ended",
        message: `The competition "${competition.title}" has ended. Unfortunately, you didn't win this time. Check out our other competitions for more chances to win!`,
        competition_id: competition.id,
        read: false,
        created_at: new Date().toISOString(),
      });
    }
  }

  if (notifications.length > 0) {
    // Insert all loss notifications in batches
    const batchSize = 50;
    for (let i = 0; i < notifications.length; i += batchSize) {
      const batch = notifications.slice(i, i + batchSize);
      const { error } = await supabase.from("user_notifications").insert(batch);
      if (error) {
        console.error(`[Lifecycle] Error creating batch of loss notifications:`, error);
      }
    }
    console.log(`[Lifecycle] Created ${notifications.length} loss notifications`);
  }
}

/**
 * Create a winner record
 */
async function createWinner(
  supabase: SupabaseClient,
  competition: any,
  entry: CompetitionEntry,
  ticketNumber: number
): Promise<void> {
  try {
    // Check if winner already exists
    const { data: existingWinner } = await supabase
      .from("winners")
      .select("*")
      .eq("competition_id", competition.id)
      .maybeSingle();

    if (existingWinner) {
      console.log(`[Lifecycle] Winner already exists for competition ${competition.id}`);
      return;
    }

    // Get user details
    const { data: user } = await supabase
      .from("canonical_users")
      .select("id, username, country, wallet_address")
      .eq("id", entry.userid)
      .maybeSingle();

    // Convert user id to canonical format for consistent storage
    const canonicalUserId = toPrizePid(entry.userid);

    // Create winner record
    const winnerData = {
      competition_id: competition.id,
      user_id: canonicalUserId,
      ticket_number: ticketNumber,
      prize_value: competition.prize_value || 0,
      prize_claimed: false,
      username: user?.username || "Unknown",
      country: user?.country || null,
      wallet_address: entry.walletaddress || user?.wallet_address || null,
      crdate: new Date().toISOString(),
    };

    const { error } = await withRetries("insert winner", () =>
      supabase.from("winners").insert(winnerData)
    );

    if (error) {
      console.error("[Lifecycle] Error creating winner:", error);
      throw error;
    }

    console.log(`[Lifecycle] Winner record created successfully`);

    // Create winner notification
    // The user's profile ID (UUID) is used for notifications, not the canonical user ID
    const profileId = user?.id || entry.userid;
    await createWinnerNotification(supabase, profileId, competition, ticketNumber);
  } catch (error) {
    console.error("[Lifecycle] Error in createWinner:", error);
    throw error;
  }
}

/**
 * Mark competition as drawn/completed
 */
async function markCompetitionAsDrawn(supabase: SupabaseClient, competition: any): Promise<void> {
  const { error } = await withRetries("mark as drawn", () =>
    supabase
      .from("competitions")
      .update({
        status: "completed",
        competitionended: 1,
        draw_date: new Date().toISOString(),
      })
      .eq("id", competition.id)
  );

  if (error) {
    console.error("[Lifecycle] Error marking competition as drawn:", error);
    throw error;
  }
}

/**
 * Draw a competition and select winner(s)
 * ENHANCED: Better dual-ID format support and logging
 */
async function drawCompetition(supabase: SupabaseClient, competition: any): Promise<void> {
  console.log(`[Lifecycle] Drawing competition: ${competition.title} (${competition.id})`);
  console.log(`[Lifecycle] Competition details: status=${competition.status}, uid=${competition.uid}, is_instant_win=${competition.is_instant_win}`);

  try {
    // Check if competition is instant win
    if (competition.is_instant_win) {
      // Instant win competitions don't need additional winner selection
      // Winners are already determined when tickets are purchased
      await markCompetitionAsDrawn(supabase, competition);
      console.log(`[Lifecycle] Instant win competition ${competition.id} marked as drawn`);
      return;
    }

    // For standard competitions, select a winner from entries
    // Pass both id and uid to ensure we find entries regardless of how they were stored
    console.log(`[Lifecycle] Fetching entries for competition ${competition.id}...`);
    const entries = await getCompetitionEntries(supabase, competition.id, competition.uid);
    console.log(`[Lifecycle] Found ${entries.length} entries for competition ${competition.id}`);

    if (entries.length === 0) {
      console.log(`[Lifecycle] No entries found for competition ${competition.id}, marking as completed without winner`);
      await markCompetitionAsDrawn(supabase, competition);
      return;
    }

    // Get all purchased ticket numbers
    const allTicketNumbers: number[] = [];
    const ticketToEntryMap = new Map<number, CompetitionEntry>();
    let totalTicketsFromEntries = 0;

    for (const entry of entries) {
      if (entry.ticketnumbers) {
        const ticketNumbers = entry.ticketnumbers
          .split(",")
          .map((t) => parseInt(t.trim()))
          .filter((t) => !isNaN(t));

        totalTicketsFromEntries += ticketNumbers.length;
        ticketNumbers.forEach((ticketNum) => {
          allTicketNumbers.push(ticketNum);
          ticketToEntryMap.set(ticketNum, entry);
        });
      }
    }

    console.log(`[Lifecycle] Competition ${competition.id} has ${allTicketNumbers.length} valid ticket numbers from ${entries.length} entries`);
    console.log(`[Lifecycle] Ticket distribution: ${totalTicketsFromEntries} tickets across entries`);

    if (allTicketNumbers.length === 0) {
      console.log(`[Lifecycle] No valid tickets found for competition ${competition.id}`);
      await markCompetitionAsDrawn(supabase, competition);
      return;
    }

    // Select winning ticket number from ACTUALLY PURCHASED tickets only
    // This ensures a winner is ALWAYS selected from purchased tickets
    // Uses cryptographically secure RNG for fairness
    const winningTicketNumber = selectWinnerFromPurchasedTickets(allTicketNumbers);
    console.log(`[Lifecycle] Selected winning ticket number: ${winningTicketNumber}`);

    // Find the entry that owns the winning ticket
    const winningEntry = ticketToEntryMap.get(winningTicketNumber);

    if (!winningEntry) {
      // This should never happen since we're selecting from allTicketNumbers
      console.error(`[Lifecycle] CRITICAL ERROR: winning ticket ${winningTicketNumber} not found in map`);
      console.error(`[Lifecycle] ticketToEntryMap size: ${ticketToEntryMap.size}`);
      console.error(`[Lifecycle] Available ticket numbers: ${Array.from(ticketToEntryMap.keys()).slice(0, 20).join(', ')}...`);
    }

    if (winningEntry) {
      // Create winner record
      console.log(`[Lifecycle] Creating winner record for user ${winningEntry.userid}`);
      await createWinner(supabase, competition, winningEntry, winningTicketNumber);
      console.log(`[Lifecycle] Winner selected for competition ${competition.id}: User ${winningEntry.userid}, Ticket ${winningTicketNumber}`);

      // Notify all non-winning participants that the competition has ended
      await notifyLosingParticipants(supabase, competition, entries, winningEntry.userid);
    }

    // Mark competition as drawn
    await markCompetitionAsDrawn(supabase, competition);
    console.log(`[Lifecycle] Competition ${competition.id} successfully drawn and marked as completed`);
  } catch (error) {
    console.error(`[Lifecycle] Error drawing competition ${competition.id}:`, error);
    console.error(`[Lifecycle] Error details:`, error instanceof Error ? error.stack : error);
    throw error;
  }
}

/**
 * Check for expired competitions and process them
 * ENHANCED: Better logging and error handling for production debugging
 */
async function processExpiredCompetitions(supabase: SupabaseClient): Promise<number> {
  const now = new Date().toISOString();
  console.log(`[Lifecycle] Checking for expired competitions at ${now}...`);

  // Get all competitions that have passed their end date and are NOT in terminal states
  // CRITICAL: Must check status='active' specifically, as that's what active competitions use
  const { data: expiredCompetitions, error } = await withRetries("fetch expired", () =>
    supabase
      .from("competitions")
      .select("*")
      .in("status", ["active", "drawing", "draft"])
      .not("end_date", "is", null)
      .lt("end_date", now)
  );

  if (error) {
    console.error("[Lifecycle] Error fetching expired competitions:", error);
    console.error("[Lifecycle] Error details:", JSON.stringify(error, null, 2));
    return 0;
  }

  if (!expiredCompetitions || expiredCompetitions.length === 0) {
    console.log("[Lifecycle] No expired competitions found");
    // Log query details for debugging
    console.log(`[Lifecycle] Query: status IN (active, drawing, draft), end_date < ${now}`);
    return 0;
  }

  console.log(`[Lifecycle] Found ${expiredCompetitions.length} expired competition(s):`);
  expiredCompetitions.forEach((comp, idx) => {
    console.log(`  ${idx + 1}. ${comp.title} (${comp.id}) - Status: ${comp.status}, End Date: ${comp.end_date}`);
  });

  let processedCount = 0;
  const errors: Array<{ competitionId: string; error: string }> = [];

  // Process each expired competition
  for (const competition of expiredCompetitions) {
    try {
      console.log(`[Lifecycle] Processing competition ${competition.id} (${competition.title})...`);
      await drawCompetition(supabase, competition);
      processedCount++;
      console.log(`[Lifecycle] Successfully processed competition ${competition.id}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Lifecycle] Error processing competition ${competition.id}:`, errorMsg);
      errors.push({ competitionId: competition.id, error: errorMsg });
    }
  }

  if (errors.length > 0) {
    console.error(`[Lifecycle] Failed to process ${errors.length} competition(s):`);
    errors.forEach(({ competitionId, error }) => {
      console.error(`  - ${competitionId}: ${error}`);
    });
  }

  console.log(`[Lifecycle] Summary: Processed ${processedCount}/${expiredCompetitions.length} expired competitions`);
  return processedCount;
}

/**
 * Check for sold-out competitions and process them
 * ENHANCED: Better logging and dual-ID format support
 */
async function processSoldOutCompetitions(supabase: SupabaseClient): Promise<number> {
  console.log("[Lifecycle] Checking for sold-out competitions...");

  // Get all active competitions with defined total_tickets
  const { data: activeCompetitions, error } = await withRetries("fetch active", () =>
    supabase
      .from("competitions")
      .select("*")
      .eq("status", "active")
      .gt("total_tickets", 0)
  );

  if (error) {
    console.error("[Lifecycle] Error fetching active competitions:", error);
    console.error("[Lifecycle] Error details:", JSON.stringify(error, null, 2));
    return 0;
  }

  if (!activeCompetitions || activeCompetitions.length === 0) {
    console.log("[Lifecycle] No active competitions to check");
    return 0;
  }

  console.log(`[Lifecycle] Checking ${activeCompetitions.length} active competitions for sold-out status`);
  let soldOutCount = 0;
  const errors: Array<{ competitionId: string; error: string }> = [];

  for (const competition of activeCompetitions) {
    try {
      // Count sold tickets using RPC function (handles both UUID and legacy uid)
      const { data: ticketCountResult, error: countError } = await withRetries(
        "count sold tickets",
        () => supabase.rpc('count_sold_tickets_for_competition', {
          p_competition_id: competition.id
        })
      );

      let totalSoldTickets = 0;
      if (!countError && ticketCountResult !== null) {
        totalSoldTickets = Number(ticketCountResult);
        console.log(`[Lifecycle] Competition ${competition.id}: ${totalSoldTickets}/${competition.total_tickets} tickets sold (via RPC)`);
      } else {
        // Fallback: Count manually if RPC fails
        console.warn(`[Lifecycle] RPC count failed (${countError?.message}), using fallback for ${competition.id}`);

        // Count from joincompetition table
        let { data: entries } = await supabase
          .from("joincompetition")
          .select("ticketnumbers")
          .eq("competitionid", competition.id);

        // If no entries found with UUID, try legacy uid
        if ((!entries || entries.length === 0) && competition.uid && competition.uid !== competition.id) {
          const uidResult = await supabase
            .from("joincompetition")
            .select("ticketnumbers")
            .eq("competitionid", competition.uid);
          if (uidResult.data && uidResult.data.length > 0) {
            entries = uidResult.data;
          }
        }

        // Collect all ticket numbers from joincompetition
        const joincompetitionTickets = new Set<number>();
        (entries || []).forEach((entry: any) => {
          if (entry.ticketnumbers) {
            const nums = entry.ticketnumbers.split(",").filter((n: string) => n.trim() !== "");
            nums.forEach((n: string) => {
              const num = parseInt(n.trim());
              if (!isNaN(num)) {
                joincompetitionTickets.add(num);
              }
            });
          }
        });

        // Also count from tickets table (for tickets not in joincompetition)
        const { data: ticketsTableData } = await supabase
          .from("tickets")
          .select("ticket_number")
          .eq("competition_id", competition.id);

        // Add tickets from tickets table that aren't already counted
        (ticketsTableData || []).forEach((ticket: any) => {
          if (ticket.ticket_number != null && !joincompetitionTickets.has(ticket.ticket_number)) {
            joincompetitionTickets.add(ticket.ticket_number);
          }
        });

        totalSoldTickets = joincompetitionTickets.size;
        console.log(`[Lifecycle] Competition ${competition.id}: ${totalSoldTickets}/${competition.total_tickets} tickets sold (via fallback)`);
      }

      console.log(`[Lifecycle] Competition ${competition.id}: ${totalSoldTickets}/${competition.total_tickets} tickets sold`);

      // Check if sold out
      if (totalSoldTickets >= competition.total_tickets) {
        console.log(`[Lifecycle] Competition ${competition.id} (${competition.title}) is SOLD OUT: ${totalSoldTickets}/${competition.total_tickets}`);
        await drawCompetition(supabase, competition);
        soldOutCount++;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Lifecycle] Error checking sold-out status for ${competition.id}:`, errorMsg);
      errors.push({ competitionId: competition.id, error: errorMsg });
    }
  }

  if (errors.length > 0) {
    console.error(`[Lifecycle] Failed to check ${errors.length} competition(s):`);
    errors.forEach(({ competitionId, error }) => {
      console.error(`  - ${competitionId}: ${error}`);
    });
  }

  console.log(`[Lifecycle] Processed ${soldOutCount} sold-out competition(s)`);
  return soldOutCount;
}

// ---------- Main handler ----------
export default async (req: Request): Promise<void> => {
  const startTime = Date.now();

  try {
    const { next_run } = await req.json();
    console.log(`[Lifecycle] Scheduled function triggered. Next run: ${next_run}`);
  } catch {
    console.log("[Lifecycle] Scheduled function triggered (manual invoke)");
  }

  try {
    const supabase = getSupabase();

    // Process expired competitions
    const expiredCount = await processExpiredCompetitions(supabase);

    // Process sold-out competitions
    const soldOutCount = await processSoldOutCompetitions(supabase);

    const elapsed = Date.now() - startTime;
    console.log(`[Lifecycle] Completed in ${elapsed}ms. Expired: ${expiredCount}, Sold-out: ${soldOutCount}`);
  } catch (error) {
    console.error("[Lifecycle] Fatal error:", error);
  }
};
