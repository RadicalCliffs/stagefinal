import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sendgridApiKey = process.env.SENDGRID_API_KEY;
const sendgridFromEmail = "contact@theprize.io";
const winnerTemplateId = "d-8c1c8a84405443da908cdf85eb30d182";
const closingSoonTemplateId = "d-7a2ad001923849df82394754988394e5";

const testEmails = ["maxmatthews1@gmail.com", "radcliffemax373@gmail.com"];

const supabase = createClient(supabaseUrl, supabaseServiceKey);

console.log("=== EMAIL TESTING SCRIPT ===\n");

/**
 * Send winner email
 */
async function sendWinnerEmail(
  recipients,
  ticketNumber,
  prizeName,
  competitionId,
) {
  const personalizations = recipients.map((email) => ({
    to: [{ email }],
    dynamic_template_data: {
      Ticket_Number: ticketNumber,
      Prize_Name: prizeName,
      Competition_URL: competitionId
        ? `https://theprize.io/competitions/${competitionId}`
        : "https://theprize.io/competitions",
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
        from: { email: sendgridFromEmail, name: "ThePrize.io" },
        template_id: winnerTemplateId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Winner email failed:`, errorText);
      return false;
    } else {
      console.log(`✅ Winner email sent successfully`);
      return true;
    }
  } catch (error) {
    console.error(`❌ Winner email error:`, error);
    return false;
  }
}

/**
 * Send closing soon email
 */
async function sendClosingSoonEmail(
  recipients,
  prizeName,
  ticketsRemaining,
  hoursRemaining,
  entryPrice,
) {
  const personalizations = recipients.map((email) => ({
    to: [{ email }],
    dynamic_template_data: {
      prize_name: prizeName,
      tickets_remaining: ticketsRemaining,
      hours_remaining: hoursRemaining,
      entry_price: entryPrice,
      "Cash alternative available": "Cash alternative available",
      Competition_URL: "https://theprize.io/competitions/test-comp-id",
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
        from: { email: sendgridFromEmail, name: "ThePrize.io" },
        template_id: closingSoonTemplateId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Closing soon email failed:`, errorText);
      return false;
    } else {
      console.log(`✅ Closing soon email sent successfully`);
      return true;
    }
  } catch (error) {
    console.error(`❌ Closing soon email error:`, error);
    return false;
  }
}

// Get most recent winner
console.log("📋 Fetching most recent winner...");
const { data: winners, error: winnerError } = await supabase
  .from("winners")
  .select(
    `
    id,
    ticket_number,
    created_at,
    competitions!inner(id, title, status)
  `,
  )
  .order("created_at", { ascending: false })
  .limit(1);

if (winnerError || !winners || winners.length === 0) {
  console.error("❌ No recent winners found:", winnerError);
  process.exit(1);
}

const recentWinner = winners[0];
const competition = recentWinner.competitions;

console.log(`\n🏆 Most Recent Winner:`);
console.log(`   Competition: ${competition.title}`);
console.log(`   Winning Ticket: #${recentWinner.ticket_number}`);
console.log(`   Won at: ${new Date(recentWinner.created_at).toLocaleString()}`);

// Get the winner's competition details for closing soon test
console.log("\n📋 Fetching competition details for closing soon test...");
const { data: testComp, error: compError } = await supabase
  .from("competitions")
  .select(
    "id, title, ticket_price, tickets_sold, total_tickets, end_date, created_at",
  )
  .eq("id", competition.id)
  .single();

if (compError || !testComp) {
  console.error("❌ Could not fetch competition details:", compError);
  process.exit(1);
}

const ticketsRemaining = Math.max(
  0,
  (testComp.total_tickets || 0) - (testComp.tickets_sold || 0),
);
const now = new Date();
const endDate = new Date(testComp.end_date);
const isEnded = endDate < now;
const hoursRemaining = isEnded
  ? 0
  : Math.max(
      0,
      Math.round((endDate.getTime() - now.getTime()) / (1000 * 60 * 60)),
    );

console.log(`\n⏰ Competition Details (${isEnded ? "ENDED" : "ACTIVE"}):`);
console.log(`   Name: ${testComp.title}`);
console.log(
  `   Tickets Sold: ${testComp.tickets_sold || 0}/${testComp.total_tickets || 0}`,
);
console.log(`   Tickets Remaining: ${ticketsRemaining}`);
console.log(`   Entry Price: $${testComp.ticket_price?.toFixed(2) || "0.00"}`);
console.log(`   End Date: ${endDate.toLocaleString()}`);
if (!isEnded) {
  console.log(`   Hours Remaining: ${hoursRemaining}`);
}

const closingSoonData = {
  title: testComp.title,
  ticketsRemaining: ticketsRemaining.toString(),
  hoursRemaining: isEnded ? "0 hours (ended)" : `${hoursRemaining} hours`,
  entryPrice: `$${testComp.ticket_price?.toFixed(2) || "0.00"}`,
};

console.log(`\n📧 Test Email Recipients:`);
testEmails.forEach((email, i) => console.log(`   ${i + 1}. ${email}`));

console.log("\n⚠️  Sending test emails in 3 seconds...\n");
await new Promise((resolve) => setTimeout(resolve, 3000));

// Send winner email test
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("🎉 TESTING WINNER EMAIL");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

await sendWinnerEmail(
  testEmails,
  `#${recentWinner.ticket_number}`,
  competition.title,
);

// Send closing soon email test
console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("⏰ TESTING CLOSING SOON EMAIL");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

await sendClosingSoonEmail(
  testEmails,
  closingSoonData.title,
  closingSoonData.ticketsRemaining,
  closingSoonData.hoursRemaining,
  closingSoonData.entryPrice,
);

console.log("\n✨ Done! Check your inboxes.\n");
