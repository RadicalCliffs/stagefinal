import { readFileSync } from "fs";
import "dotenv/config";

const sendgridApiKey = process.env.SENDGRID_API_KEY;
const sendgridFromEmail = "contact@theprize.io";
const winnerTemplateId = "d-8c1c8a84405443da908cdf85eb30d182";

console.log("=== SENDING WINNER EMAILS ===\n");

// Read winner data from previous script
const winnerData = JSON.parse(
  readFileSync("scripts/temp-winner-data.json", "utf8"),
);

if (winnerData.length === 0) {
  console.log("❌ No winner data found\n");
  process.exit(0);
}

console.log(`📧 Preparing to send ${winnerData.length} winner emails:\n`);

winnerData.forEach((winner, idx) => {
  console.log(`${idx + 1}. ${winner.email}`);
  console.log(`   Competition: ${winner.competition_title}`);
  console.log(`   Ticket: #${winner.ticket_number}`);
  console.log(`   Prize: $${winner.prize_value || "N/A"}\n`);
});

console.log("⚠️  Sending emails in 3 seconds...\n");
await new Promise((resolve) => setTimeout(resolve, 3000));

// Send emails
const personalizations = winnerData.map((winner) => ({
  to: [{ email: winner.email }],
  dynamic_template_data: {
    Ticket_Number: `#${winner.ticket_number}`,
    Prize_Name: winner.competition_title,
    Competition_URL: winner.competition_id ? `https://theprize.io/competitions/${winner.competition_id}` : "https://theprize.io/competitions",
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
    console.error(`❌ SendGrid error (${response.status}):`, errorText);
  } else {
    console.log(`✅ Successfully sent ${winnerData.length} winner emails!\n`);
    console.log("📧 Emails sent to:");
    winnerData.forEach((winner, idx) => {
      console.log(`   ${idx + 1}. ${winner.email}`);
      console.log(`      Competition: ${winner.competition_title}`);
      console.log(`      Winning Ticket: #${winner.ticket_number}\n`);
    });
  }
} catch (error) {
  console.error(`❌ Error:`, error);
}

console.log("✨ Done!\n");
