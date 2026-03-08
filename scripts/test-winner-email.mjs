import fetch from "node-fetch";
import "dotenv/config";

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || process.argv[2];
const TEMPLATE_ID = "d-8c1c8a84405443da908cdf85eb30d182";
const FROM_EMAIL = "contact@theprize.io";

const TEST_RECIPIENTS = ["maxmatthews1@gmail.com", "radcliffemax373@gmail.com"];

console.log("=== SENDING TEST WINNER EMAILS ===\n");

for (const email of TEST_RECIPIENTS) {
  console.log(`📤 Sending to ${email}...`);

  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email }],
            dynamic_template_data: {
              Ticket_Number: "#12345",
              Prize_Name: "iPhone 16 Pro Max Test Competition",
              Competition_URL: "https://theprize.io/competitions/test-comp-id",
            },
          },
        ],
        from: { email: FROM_EMAIL, name: "ThePrize.io" },
        template_id: TEMPLATE_ID,
      }),
    });

    if (response.ok) {
      console.log(`   ✅ Winner email sent to ${email}\n`);
    } else {
      const errorText = await response.text();
      console.error(`   ❌ Failed (${response.status}):`, errorText, "\n");
    }
  } catch (error) {
    console.error(`   ❌ Error:`, error.message, "\n");
  }
}

console.log("✨ Done!\n");
