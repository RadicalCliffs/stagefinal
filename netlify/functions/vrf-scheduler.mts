import type { Config } from "@netlify/functions";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { toPrizePid } from "./_shared/userId.mts";

/**
 * VRF Scheduler - Automatic VRF Draw Triggering
 *
 * This scheduled function runs every 10 minutes to check for competitions
 * that have ended (timer expired or sold out) and need VRF draws triggered.
 *
 * When a competition ends, this function:
 * 1. Queries for competitions with an on-chain ID that are active/ended and past end date
 * 2. Validates on-chain state to ensure the competition is ready for drawing
 * 3. Updates the competition status to "drawing" while VRF processes
 * 4. The VRF system (via Chainlink VRF callbacks) handles the actual random selection
 *
 * This eliminates the need for administrators to manually trigger VRF draws
 * when competitions end. The existing client-side checker remains as a backup,
 * but this scheduled function provides more reliable automatic processing that
 * doesn't depend on a browser being open.
 *
 * NOTE: This function should ONLY be invoked via Netlify's scheduler.
 * Direct HTTP invocations will be rejected to prevent timeout issues.
 */

export const config: Config = {
  schedule: "*/10 * * * *", // Run every 10 minutes
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

// ---------- Types ----------
interface CompetitionForDraw {
  id: string;
  title: string;
  status: string;
  end_date: string;
  onchain_competition_id: number | null;
  is_instant_win: boolean;
  vrf_draw_requested_at: string | null;
  vrf_draw_completed_at: string | null;
}

// ---------- Notification helpers ----------

/**
 * Create a winner notification in the database
 */
async function createWinnerNotification(
  supabase: SupabaseClient,
  profileId: string,
  competition: CompetitionForDraw,
  ticketNumber: number
): Promise<void> {
  try {
    const { error } = await supabase.from("user_notifications").insert({
      user_id: profileId,
      type: "win",
      title: "🎉 Congratulations! You Won!",
      message: `You have won ${competition.title}! Your winning ticket was #${ticketNumber}. Check your entries for more details.`,
      competition_id: competition.id,
      prize_info: competition.title,
      read: false,
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.error("[VRF-Scheduler] Error creating winner notification:", error);
    } else {
      console.log(`[VRF-Scheduler] Winner notification created for user ${profileId}`);
    }
  } catch (err) {
    console.error("[VRF-Scheduler] Error in createWinnerNotification:", err);
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
  ticketNumber: number
): Promise<void> {
  const sendgridApiKey = Netlify.env.get("SENDGRID_API_KEY");
  const fromEmail = Netlify.env.get("SENDGRID_FROM_EMAIL") || "contact@theprize.io";
  const templateId = Netlify.env.get("SENDGRID_TEMPLATE_WINNER");

  if (!sendgridApiKey || !templateId) {
    console.log("[VRF-Scheduler] SendGrid winner email not configured, skipping");
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
          },
        }],
        from: { email: fromEmail, name: "ThePrize.io" },
        template_id: templateId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[VRF-Scheduler] Winner email failed:`, errorText);
    } else {
      console.log(`[VRF-Scheduler] Winner email sent to ${email}`);
    }
  } catch (error) {
    console.error(`[VRF-Scheduler] Winner email error:`, error);
  }
}

/**
 * Notify all non-winning participants that the competition has ended
 */
async function notifyLosingParticipants(
  supabase: SupabaseClient,
  competition: CompetitionForDraw,
  winnerUserId: string | null
): Promise<void> {
  console.log(`[VRF-Scheduler] Notifying non-winners for competition ${competition.id}...`);

  try {
    // Get all entries for this competition
    const { data: entries } = await supabase
      .from("joincompetition")
      .select("userid")
      .eq("competitionid", competition.id);

    if (!entries || entries.length === 0) {
      console.log(`[VRF-Scheduler] No entries found for competition ${competition.id}`);
      return;
    }

    // Get unique user IDs (excluding the winner)
    const participantUserIds = new Set<string>();
    for (const entry of entries) {
      if (entry.userid && entry.userid !== winnerUserId) {
        participantUserIds.add(entry.userid);
      }
    }

    console.log(`[VRF-Scheduler] Found ${participantUserIds.size} non-winning participants to notify`);

    if (participantUserIds.size === 0) return;

    // Batch notification creation
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
          console.error(`[VRF-Scheduler] Error creating batch of loss notifications:`, error);
        }
      }
      console.log(`[VRF-Scheduler] Created ${notifications.length} loss notifications`);
    }
  } catch (err) {
    console.error("[VRF-Scheduler] Error in notifyLosingParticipants:", err);
  }
}

// ---------- Core functions ----------

/**
 * Find competitions ready for VRF draw
 */
async function getCompetitionsReadyForDraw(supabase: SupabaseClient): Promise<CompetitionForDraw[]> {
  const now = new Date().toISOString();

  // Query for competitions that:
  // 1. Have an onchain_competition_id (deployed to blockchain)
  // 2. Are active or ended status
  // 3. Have passed their end_date
  // 4. Have not yet completed VRF draw
  // 5. Are NOT instant win (instant win winners are determined at purchase)
  const { data, error } = await supabase
    .from("competitions")
    .select("id, title, status, end_date, onchain_competition_id, is_instant_win, vrf_draw_requested_at, vrf_draw_completed_at")
    .not("onchain_competition_id", "is", null)
    .in("status", ["active", "ended"])
    .lt("end_date", now)
    .is("vrf_draw_completed_at", null)
    .eq("is_instant_win", false)
    .order("end_date", { ascending: true });

  if (error) {
    console.error("[VRF-Scheduler] Error fetching competitions:", error);
    return [];
  }

  return data || [];
}

/**
 * Mark competition as drawing (VRF in progress)
 */
async function markCompetitionAsDrawing(supabase: SupabaseClient, competitionId: string): Promise<void> {
  const { error } = await supabase
    .from("competitions")
    .update({
      status: "drawing",
      vrf_draw_requested_at: new Date().toISOString(),
    })
    .eq("id", competitionId);

  if (error) {
    console.error(`[VRF-Scheduler] Error marking competition ${competitionId} as drawing:`, error);
    throw error;
  }
}

/**
 * Process a competition for VRF draw
 * This function validates the competition is ready and triggers the draw process
 */
async function processCompetitionForDraw(
  supabase: SupabaseClient,
  competition: CompetitionForDraw
): Promise<{ success: boolean; message: string }> {
  console.log(`[VRF-Scheduler] Processing competition: ${competition.title} (${competition.id})`);

  // Validate onchain_competition_id
  if (!competition.onchain_competition_id || competition.onchain_competition_id <= 0) {
    return {
      success: false,
      message: `Invalid onchain_competition_id: ${competition.onchain_competition_id}`,
    };
  }

  // Skip if already being processed
  if (competition.vrf_draw_requested_at) {
    const requestedAt = new Date(competition.vrf_draw_requested_at);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    // If draw was requested less than 5 minutes ago, skip
    if (requestedAt > fiveMinutesAgo) {
      return {
        success: false,
        message: `VRF draw already requested at ${competition.vrf_draw_requested_at}`,
      };
    }

    // If it's been more than 5 minutes, retry
    console.log(`[VRF-Scheduler] VRF draw was requested ${competition.vrf_draw_requested_at} but not completed. Retrying...`);
  }

  try {
    // Mark competition as drawing
    await markCompetitionAsDrawing(supabase, competition.id);

    console.log(`[VRF-Scheduler] Competition ${competition.id} marked as drawing, VRF system will process`);

    return {
      success: true,
      message: `Competition ${competition.id} ready for VRF draw`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Error processing competition: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Check for and process VRF draw results
 * This function checks for competitions in "drawing" status that have been drawn on-chain
 * and syncs the winners to the database
 */
async function checkVRFDrawResults(supabase: SupabaseClient): Promise<void> {
  // Get competitions that are in drawing status
  const { data: drawingCompetitions, error } = await supabase
    .from("competitions")
    .select("id, title, status, onchain_competition_id, is_instant_win")
    .eq("status", "drawing")
    .not("onchain_competition_id", "is", null);

  if (error || !drawingCompetitions || drawingCompetitions.length === 0) {
    return;
  }

  console.log(`[VRF-Scheduler] Checking ${drawingCompetitions.length} competitions in drawing status`);

  // For each drawing competition, check if there are winners already synced
  for (const comp of drawingCompetitions) {
    const { data: existingWinner } = await supabase
      .from("winners")
      .select("id, user_id, ticket_number")
      .eq("competition_id", comp.id)
      .maybeSingle();

    if (existingWinner) {
      // Winner already exists, mark as completed and send notifications
      console.log(`[VRF-Scheduler] Winner found for competition ${comp.id}, marking as completed`);

      await supabase
        .from("competitions")
        .update({
          status: "completed",
          competitionended: 1,
          vrf_draw_completed_at: new Date().toISOString(),
        })
        .eq("id", comp.id);

      // Get user details for notification and email
      let userData = null;
      if (existingWinner.user_id) {
        const { data: user } = await supabase
          .from("canonical_users")
          .select("id, username, email")
          .eq("id", existingWinner.user_id)
          .maybeSingle();
        userData = user;
      }

      // Create winner notification
      if (existingWinner.user_id) {
        await createWinnerNotification(
          supabase,
          existingWinner.user_id,
          comp as CompetitionForDraw,
          existingWinner.ticket_number
        );
      }

      // Send winner email if user has an email address
      if (userData?.email) {
        // Get competition prize value
        const { data: compDetails } = await supabase
          .from("competitions")
          .select("prize_value")
          .eq("id", comp.id)
          .maybeSingle();

        const prizeValue = compDetails?.prize_value ? `£${compDetails.prize_value}` : comp.title;
        await sendWinnerEmail(
          userData.email,
          userData.username || "Player",
          comp.title,
          prizeValue,
          existingWinner.ticket_number
        );
      }

      // Notify losing participants
      await notifyLosingParticipants(supabase, comp as CompetitionForDraw, existingWinner.user_id);
    }
  }
}

// ---------- Main handler ----------
export default async (req: Request): Promise<Response> => {
  const startTime = Date.now();

  // Only allow scheduled invocations (Netlify scheduler adds next_run in body)
  let isScheduledInvocation = false;
  try {
    const body = await req.json();
    if (body && body.next_run) {
      isScheduledInvocation = true;
      console.log(`[VRF-Scheduler] Scheduled function triggered. Next run: ${body.next_run}`);
    }
  } catch {
    // If body parsing fails, it's likely not a scheduled invocation
    console.log("[VRF-Scheduler] Request has no valid JSON body");
  }

  // Reject direct HTTP invocations to prevent timeout issues
  if (!isScheduledInvocation) {
    console.log("[VRF-Scheduler] Rejecting non-scheduled invocation");
    return new Response(
      JSON.stringify({
        error: "This function can only be invoked by Netlify's scheduler",
        message: "Direct invocations are disabled to prevent timeout issues",
      }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  try {
    const supabase = getSupabase();

    // Step 1: Find competitions ready for VRF draw
    const competitions = await getCompetitionsReadyForDraw(supabase);

    let processedCount = 0;
    let errorCount = 0;

    if (competitions.length > 0) {
      console.log(`[VRF-Scheduler] Found ${competitions.length} competition(s) ready for VRF draw`);

      // Step 2: Process each competition
      for (const competition of competitions) {
        const result = await processCompetitionForDraw(supabase, competition);

        if (result.success) {
          processedCount++;
          console.log(`[VRF-Scheduler] ✓ ${competition.title}: ${result.message}`);
        } else {
          errorCount++;
          console.log(`[VRF-Scheduler] ✗ ${competition.title}: ${result.message}`);
        }
      }
    }

    // Step 3: Check for VRF draw results and sync winners
    await checkVRFDrawResults(supabase);

    const elapsed = Date.now() - startTime;
    console.log(`[VRF-Scheduler] Completed in ${elapsed}ms. Ready for draw: ${competitions.length}, Processed: ${processedCount}, Errors: ${errorCount}`);

    return new Response(
      JSON.stringify({
        success: true,
        elapsed,
        ready: competitions.length,
        processed: processedCount,
        errors: errorCount,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[VRF-Scheduler] Fatal error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};
