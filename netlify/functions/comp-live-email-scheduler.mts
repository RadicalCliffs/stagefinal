import type { Config } from "@netlify/functions";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Competition Live Email Scheduler
 *
 * This scheduled function runs every 15 minutes to check for newly created
 * competitions and sends COMP LIVE notification emails to all registered users.
 *
 * A competition is considered "newly live" if:
 * 1. It has status 'active'
 * 2. It was created in the last 15 minutes
 * 3. It hasn't had a notification email sent yet (tracked via notifications table)
 */

export const config: Config = {
  schedule: "*/15 * * * *", // Run every 15 minutes
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

interface Competition {
  id: string;
  title: string;
  prize_value: string | null;
  ticket_price: number | null;
  end_date: string | null;
  created_at: string;
}

interface User {
  id: string;
  email: string;
  username: string;
}

/**
 * Send COMP LIVE email using SendGrid dynamic template
 */
async function sendCompLiveEmail(
  recipients: Array<{ email: string; username: string }>,
  competition: Competition
): Promise<{ sent: number; failed: number }> {
  const sendgridApiKey = Netlify.env.get("SENDGRID_API_KEY");
  const fromEmail = Netlify.env.get("SENDGRID_FROM_EMAIL") || "contact@theprize.io";
  const templateId = Netlify.env.get("SENDGRID_TEMPLATE_COMP_LIVE");

  if (!sendgridApiKey || !templateId) {
    console.log("[comp-live-email] SendGrid not fully configured, skipping");
    return { sent: 0, failed: recipients.length };
  }

  let sent = 0;
  let failed = 0;

  // Format competition details
  const prizeValue = competition.prize_value ? `£${competition.prize_value}` : "Amazing Prize";
  const ticketPrice = competition.ticket_price ? `£${competition.ticket_price.toFixed(2)}` : "Check site";
  const endDate = competition.end_date
    ? new Date(competition.end_date).toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "Coming soon";

  // Send in batches to avoid rate limits (SendGrid allows up to 1000 per request)
  const batchSize = 100;
  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);

    const personalizations = batch.map((recipient) => ({
      to: [{ email: recipient.email }],
      dynamic_template_data: {
        "Player Username": recipient.username,
        "Competition Name": competition.title,
        "Prize Value": prizeValue,
        "End Date": endDate,
        "Ticket Price": ticketPrice,
        "Competition_URL": `https://theprize.io/competitions/${competition.id}`,
      },
    }));

    try {
      const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sendgridApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations,
          from: { email: fromEmail, name: "ThePrize.io" },
          template_id: templateId,
        }),
      });

      if (response.ok) {
        sent += batch.length;
      } else {
        const errorText = await response.text();
        console.error(`[comp-live-email] Batch failed:`, errorText);
        failed += batch.length;
      }
    } catch (error) {
      console.error(`[comp-live-email] Batch error:`, error);
      failed += batch.length;
    }

    // Small delay between batches to avoid rate limiting
    if (i + batchSize < recipients.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return { sent, failed };
}

/**
 * Mark a competition as having its notification sent
 */
async function markCompetitionNotified(supabase: SupabaseClient, competitionId: string): Promise<void> {
  try {
    // Use a system notification record to track that comp_live email was sent
    await supabase.from("user_notifications").insert({
      user_id: "system",
      type: "announcement",
      title: "COMP_LIVE_EMAIL_SENT",
      message: `Competition live email sent for ${competitionId}`,
      competition_id: competitionId,
      read: true,
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[comp-live-email] Error marking competition notified:`, error);
  }
}

/**
 * Check if a competition has already had its notification sent
 */
async function hasCompetitionBeenNotified(supabase: SupabaseClient, competitionId: string): Promise<boolean> {
  const { data } = await supabase
    .from("user_notifications")
    .select("id")
    .eq("user_id", "system")
    .eq("title", "COMP_LIVE_EMAIL_SENT")
    .eq("competition_id", competitionId)
    .maybeSingle();

  return !!data;
}

// ---------- Main handler ----------
export default async (req: Request): Promise<Response> => {
  const startTime = Date.now();

  try {
    const { next_run } = await req.json();
    console.log(`[comp-live-email] Scheduled function triggered. Next run: ${next_run}`);
  } catch {
    console.log("[comp-live-email] Function triggered (manual invoke)");
  }

  try {
    const supabase = getSupabase();

    // Find competitions that became active in the last 30 minutes
    // (30 min window to catch any we might have missed)
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    const { data: newCompetitions, error: compError } = await supabase
      .from("competitions")
      .select("id, title, prize_value, ticket_price, end_date, created_at")
      .eq("status", "active")
      .gte("created_at", thirtyMinutesAgo)
      .order("created_at", { ascending: false });

    if (compError) {
      console.error("[comp-live-email] Error fetching competitions:", compError);
      return new Response(JSON.stringify({ error: compError.message }), { status: 500 });
    }

    if (!newCompetitions || newCompetitions.length === 0) {
      console.log("[comp-live-email] No new competitions to notify about");
      return new Response(JSON.stringify({ message: "No new competitions" }));
    }

    console.log(`[comp-live-email] Found ${newCompetitions.length} new competition(s)`);

    // Get all users with email addresses
    const { data: users, error: usersError } = await supabase
      .from("canonical_users")
      .select("id, email, username")
      .not("email", "is", null);

    if (usersError || !users || users.length === 0) {
      console.log("[comp-live-email] No users with email addresses found");
      return new Response(JSON.stringify({ message: "No users to notify" }));
    }

    const recipients = users
      .filter((u): u is User => !!u.email && !!u.username)
      .map((u) => ({ email: u.email, username: u.username }));

    console.log(`[comp-live-email] Found ${recipients.length} users to notify`);

    let totalSent = 0;
    let totalFailed = 0;

    // Process each new competition
    for (const competition of newCompetitions) {
      // Check if we've already sent notification for this competition
      const alreadyNotified = await hasCompetitionBeenNotified(supabase, competition.id);
      if (alreadyNotified) {
        console.log(`[comp-live-email] Competition ${competition.id} already notified, skipping`);
        continue;
      }

      console.log(`[comp-live-email] Sending COMP LIVE emails for: ${competition.title}`);

      const { sent, failed } = await sendCompLiveEmail(recipients, competition);
      totalSent += sent;
      totalFailed += failed;

      // Mark competition as notified
      await markCompetitionNotified(supabase, competition.id);

      console.log(`[comp-live-email] Competition ${competition.title}: sent=${sent}, failed=${failed}`);
    }

    const elapsed = Date.now() - startTime;
    const summary = {
      success: true,
      elapsed_ms: elapsed,
      competitions_processed: newCompetitions.length,
      emails_sent: totalSent,
      emails_failed: totalFailed,
    };

    console.log(`[comp-live-email] Completed in ${elapsed}ms:`, summary);

    return new Response(JSON.stringify(summary), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[comp-live-email] Fatal error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
