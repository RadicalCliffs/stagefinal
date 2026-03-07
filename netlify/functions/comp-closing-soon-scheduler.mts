import type { Config, Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

export const config: Config = {
  schedule: "@hourly", // Run every hour to check for competitions closing soon
};

interface Competition {
  id: string;
  title: string;
  prize_value: number | null;
  ticket_price: number | null;
  end_date: string | null;
  tickets_sold: number | null;
  total_tickets: number | null;
}

interface User {
  canonical_user_id: string;
  email: string;
  username: string;
  last_closing_soon_notification?: string | null;
}

/**
 * Send "Competition Closing Soon" email using SendGrid dynamic template
 */
async function sendClosingSoonEmails(
  recipients: User[],
  competition: Competition
): Promise<{ sent: number; failed: number }> {
  const sendgridApiKey = Netlify.env.get("SENDGRID_API_KEY");
  const fromEmail = Netlify.env.get("SENDGRID_FROM_EMAIL") || "contact@theprize.io";
  const templateId = Netlify.env.get("SENDGRID_TEMPLATE_CLOSING_SOON");

  if (!sendgridApiKey || !templateId) {
    console.log("[comp-closing-soon] SendGrid not fully configured, skipping");
    return { sent: 0, failed: recipients.length };
  }

  let sent = 0;
  let failed = 0;

  // Format competition details
  const prizeValue = competition.prize_value ? `£${competition.prize_value}` : "Amazing Prize";
  const ticketPrice = competition.ticket_price ? `£${competition.ticket_price.toFixed(2)}` : "Check site";
  const ticketsSold = competition.tickets_sold || 0;
  const totalTickets = competition.total_tickets || 0;
  const percentageSold = totalTickets > 0 ? Math.round((ticketsSold / totalTickets) * 100) : 0;
  
  // Format end date (e.g., "Dec 25, 2024 at 6:00 PM")
  const endDate = competition.end_date 
    ? new Date(competition.end_date).toLocaleString('en-GB', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })
    : "Soon";

  // Calculate hours remaining
  const hoursRemaining = competition.end_date
    ? Math.max(0, Math.round((new Date(competition.end_date).getTime() - Date.now()) / (1000 * 60 * 60)))
    : 0;

  // Send in batches to avoid rate limits (SendGrid allows up to 1000 per request)
  const batchSize = 100;
  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);

    // Create personalizations for each user in the batch
    const personalizations = batch.map((recipient) => ({
      to: [{ email: recipient.email }],
      dynamic_template_data: {
        "Player Username": recipient.username,
        "Competition Name": competition.title,
        "Prize Value": prizeValue,
        "End Date": endDate,
        "Ticket Price": ticketPrice,
        "Hours Remaining": hoursRemaining.toString(),
        "Tickets Sold": ticketsSold.toString(),
        "Total Tickets": totalTickets.toString(),
        "Percentage Sold": `${percentageSold}%`,
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
        console.error(`[comp-closing-soon] Batch failed:`, errorText);
        failed += batch.length;
      }
    } catch (error) {
      console.error(`[comp-closing-soon] Batch error:`, error);
      failed += batch.length;
    }
  }

  return { sent, failed };
}

/**
 * Main scheduler function - runs every hour
 * Finds competitions closing within 24 hours and sends emails to users who haven't entered yet
 */
export default async function handler(_request: Request, context: Context) {
  console.log("[comp-closing-soon] Starting scheduler");

  const supabaseUrl = Netlify.env.get("SUPABASE_URL") || Netlify.env.get("VITE_SUPABASE_URL");
  const supabaseServiceKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("[comp-closing-soon] Missing Supabase configuration");
    return new Response(
      JSON.stringify({ success: false, error: "Missing configuration" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Get current time and 24 hours from now
    const now = new Date();
    const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Find competitions that:
    // 1. Are live/active
    // 2. End within the next 24 hours
    // 3. Haven't sent a closing soon email yet (or sent more than 12 hours ago)
    const { data: competitions, error: compError } = await supabase
      .from("competitions")
      .select("id, title, prize_value, ticket_price, end_date, tickets_sold, total_tickets, last_closing_soon_email_sent")
      .eq("status", "live")
      .gte("end_date", now.toISOString())
      .lte("end_date", twentyFourHoursFromNow.toISOString())
      .order("end_date", { ascending: true });

    if (compError) {
      console.error("[comp-closing-soon] Error fetching competitions:", compError);
      return new Response(
        JSON.stringify({ success: false, error: compError.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!competitions || competitions.length === 0) {
      console.log("[comp-closing-soon] No competitions closing within 24 hours");
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "No competitions closing soon",
          competitions_checked: 0 
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`[comp-closing-soon] Found ${competitions.length} competitions closing soon:`, 
      competitions.map(c => `${c.title} (ends: ${c.end_date})`).join(", "));

    let totalSent = 0;
    let totalFailed = 0;
    const processedCompetitions: string[] = [];

    for (const competition of competitions) {
      // Check if we already sent an email for this competition recently (within 12 hours)
      const lastEmailSent = competition.last_closing_soon_email_sent 
        ? new Date(competition.last_closing_soon_email_sent)
        : null;
      
      if (lastEmailSent) {
        const hoursSinceLastEmail = (now.getTime() - lastEmailSent.getTime()) / (1000 * 60 * 60);
        if (hoursSinceLastEmail < 12) {
          console.log(`[comp-closing-soon] Skipping ${competition.title} - email sent ${hoursSinceLastEmail.toFixed(1)}h ago`);
          continue;
        }
      }

      // Get all users who have:
      // 1. An email address
      // 2. Haven't entered this competition yet
      // 3. Haven't been notified about this competition closing recently
      const { data: eligibleUsers, error: usersError } = await supabase
        .from("canonical_users")
        .select("canonical_user_id, email, username, last_closing_soon_notification")
        .not("email", "is", null)
        .not("email", "eq", "");

      if (usersError) {
        console.error(`[comp-closing-soon] Error fetching users for ${competition.title}:`, usersError);
        continue;
      }

      if (!eligibleUsers || eligibleUsers.length === 0) {
        console.log(`[comp-closing-soon] No eligible users found for ${competition.title}`);
        continue;
      }

      // Filter out users who have already entered this competition
      const { data: entries, error: entriesError } = await supabase
        .from("competition_entries")
        .select("canonical_user_id")
        .eq("competition_id", competition.id);

      if (entriesError) {
        console.error(`[comp-closing-soon] Error fetching entries for ${competition.title}:`, entriesError);
        continue;
      }

      const enteredUserIds = new Set(entries?.map(e => e.canonical_user_id) || []);
      
      // Filter users who haven't entered and haven't been notified recently
      const usersToNotify = eligibleUsers.filter(user => {
        // Skip if user already entered
        if (enteredUserIds.has(user.canonical_user_id)) {
          return false;
        }

        // Skip if user was notified about ANY competition closing recently (within 6 hours)
        if (user.last_closing_soon_notification) {
          const lastNotification = new Date(user.last_closing_soon_notification);
          const hoursSinceNotification = (now.getTime() - lastNotification.getTime()) / (1000 * 60 * 60);
          if (hoursSinceNotification < 6) {
            return false;
          }
        }

        return true;
      });

      if (usersToNotify.length === 0) {
        console.log(`[comp-closing-soon] No users to notify for ${competition.title} (all entered or recently notified)`);
        continue;
      }

      console.log(`[comp-closing-soon] Sending emails for "${competition.title}" to ${usersToNotify.length} users`);

      // Send emails
      const { sent, failed } = await sendClosingSoonEmails(usersToNotify, competition);
      totalSent += sent;
      totalFailed += failed;

      if (sent > 0) {
        // Update competition to mark that we sent the closing soon email
        await supabase
          .from("competitions")
          .update({ last_closing_soon_email_sent: now.toISOString() })
          .eq("id", competition.id);

        // Update users to mark that they received a closing soon notification
        const userIds = usersToNotify.slice(0, sent).map(u => u.canonical_user_id);
        await supabase
          .from("canonical_users")
          .update({ last_closing_soon_notification: now.toISOString() })
          .in("canonical_user_id", userIds);

        processedCompetitions.push(competition.title);
      }

      console.log(`[comp-closing-soon] ${competition.title}: sent=${sent}, failed=${failed}`);
    }

    console.log(`[comp-closing-soon] Summary: ${totalSent} emails sent, ${totalFailed} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        competitions_processed: processedCompetitions.length,
        competitions: processedCompetitions,
        emails_sent: totalSent,
        emails_failed: totalFailed,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[comp-closing-soon] Fatal error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
