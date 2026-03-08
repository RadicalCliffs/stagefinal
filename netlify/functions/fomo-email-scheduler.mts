import type { Config } from "@netlify/functions";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * FOMO Weekly Email Scheduler
 *
 * This scheduled function runs every Wednesday at 10:00 AM UTC to send
 * "Fear Of Missing Out" emails to all registered users, encouraging them
 * to check out active competitions.
 *
 * The email includes:
 * - Number of active competitions
 * - Total prize value available
 * - Personalized greeting with username
 */

export const config: Config = {
  // Run every Wednesday at 10:00 AM UTC
  // Cron: minute hour day-of-month month day-of-week
  schedule: "0 10 * * 3", // 3 = Wednesday
};

// ---------- Supabase ----------
function getSupabase(): SupabaseClient {
  const supabaseUrl =
    Netlify.env.get("VITE_SUPABASE_URL") || Netlify.env.get("SUPABASE_URL");
  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl) throw new Error("Missing SUPABASE_URL / VITE_SUPABASE_URL");
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

interface User {
  email: string;
  username: string;
}

/**
 * Get statistics about active competitions
 */
async function getCompetitionStats(supabase: SupabaseClient): Promise<{
  activeCount: number;
  totalPrizeValue: number;
}> {
  const { data: competitions, error } = await supabase
    .from("competitions")
    .select("id, prize_value")
    .eq("status", "active");

  if (error || !competitions) {
    return { activeCount: 0, totalPrizeValue: 0 };
  }

  const totalPrizeValue = competitions.reduce((sum, comp) => {
    const value = parseFloat(comp.prize_value) || 0;
    return sum + value;
  }, 0);

  return {
    activeCount: competitions.length,
    totalPrizeValue,
  };
}

/**
 * Send FOMO email using SendGrid dynamic template
 */
async function sendFomoEmails(
  recipients: User[],
  activeCompetitions: string,
  totalPrizes: string,
): Promise<{ sent: number; failed: number }> {
  const sendgridApiKey = Netlify.env.get("SENDGRID_API_KEY");
  const fromEmail =
    Netlify.env.get("SENDGRID_FROM_EMAIL") || "contact@theprize.io";
  const templateId = Netlify.env.get("SENDGRID_TEMPLATE_FOMO");

  if (!sendgridApiKey || !templateId) {
    console.log("[fomo-email] SendGrid not fully configured, skipping");
    return { sent: 0, failed: recipients.length };
  }

  let sent = 0;
  let failed = 0;

  // Send in batches to avoid rate limits (SendGrid allows up to 1000 per request)
  const batchSize = 100;
  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);

    // Create personalizations for each user in the batch
    const personalizations = batch.map((recipient) => ({
      to: [{ email: recipient.email }],
      dynamic_template_data: {
        "Player Username": recipient.username,
        "Active Competitions": activeCompetitions,
        "Total Prizes": totalPrizes,
        Competitions_URL: "https://theprize.io/competitions",
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
        console.log(
          `[fomo-email] Batch ${Math.floor(i / batchSize) + 1}: sent ${batch.length} emails`,
        );
      } else {
        const errorText = await response.text();
        console.error(
          `[fomo-email] Batch ${Math.floor(i / batchSize) + 1} failed:`,
          errorText,
        );
        failed += batch.length;
      }
    } catch (error) {
      console.error(
        `[fomo-email] Batch ${Math.floor(i / batchSize) + 1} error:`,
        error,
      );
      failed += batch.length;
    }

    // Small delay between batches to avoid rate limiting
    if (i + batchSize < recipients.length) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return { sent, failed };
}

// ---------- Main handler ----------
export default async (req: Request): Promise<Response> => {
  const startTime = Date.now();

  try {
    const { next_run } = await req.json();
    console.log(
      `[fomo-email] Scheduled function triggered. Next run: ${next_run}`,
    );
  } catch {
    console.log("[fomo-email] Function triggered (manual invoke)");
  }

  try {
    const supabase = getSupabase();

    // Get competition statistics
    const stats = await getCompetitionStats(supabase);

    if (stats.activeCount === 0) {
      console.log("[fomo-email] No active competitions, skipping FOMO email");
      return new Response(
        JSON.stringify({
          message: "No active competitions, FOMO email skipped",
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    console.log(
      `[fomo-email] Found ${stats.activeCount} active competitions with £${stats.totalPrizeValue} in prizes`,
    );

    // Get all users with email addresses
    const { data: users, error: usersError } = await supabase
      .from("canonical_users")
      .select("email, username")
      .not("email", "is", null);

    if (usersError) {
      console.error("[fomo-email] Error fetching users:", usersError);
      return new Response(JSON.stringify({ error: usersError.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!users || users.length === 0) {
      console.log("[fomo-email] No users with email addresses found");
      return new Response(
        JSON.stringify({ message: "No users to send FOMO email to" }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // Filter to only users with both email and username
    const recipients: User[] = users.filter(
      (u): u is User => !!u.email && !!u.username,
    );

    console.log(
      `[fomo-email] Sending FOMO emails to ${recipients.length} users`,
    );

    // Format statistics for the email
    const activeCompetitions = stats.activeCount.toString();
    const totalPrizes = `£${stats.totalPrizeValue.toLocaleString()}`;

    // Send the emails
    const { sent, failed } = await sendFomoEmails(
      recipients,
      activeCompetitions,
      totalPrizes,
    );

    const elapsed = Date.now() - startTime;
    const summary = {
      success: true,
      elapsed_ms: elapsed,
      total_users: recipients.length,
      emails_sent: sent,
      emails_failed: failed,
      active_competitions: stats.activeCount,
      total_prizes: totalPrizes,
    };

    console.log(`[fomo-email] Completed in ${elapsed}ms:`, summary);

    return new Response(JSON.stringify(summary), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[fomo-email] Fatal error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
};
