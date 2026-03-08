import fetch from "node-fetch";
import "dotenv/config";

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || process.argv[2];
const TEMPLATE_ID = "d-7a2ad001923849df82394754988394e5";
const FROM_EMAIL = "contact@theprize.io";

const TEST_RECIPIENTS = ["maxmatthews1@gmail.com", "radcliffemax373@gmail.com"];

console.log("=== SENDING TEST CLOSING SOON EMAILS ===\n");

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
              prize_name: "Tesla Model 3 Test Competition",
              tickets_remaining: "42",
              hours_remaining: "18 hours",
              entry_price: "£2.50",
              "Cash alternative available": "Cash alternative available",
              Competition_URL: "https://theprize.io/competitions/test-comp-id",
            },
          },
        ],
        from: { email: FROM_EMAIL, name: "ThePrize.io" },
        template_id: TEMPLATE_ID,
      }),
    });

    if (response.ok) {
      console.log(`   ✅ Closing soon email sent to ${email}\n`);
    } else {
      const errorText = await response.text();
      console.error(`   ❌ Failed (${response.status}):`, errorText, "\n");
    }
  } catch (error) {
    console.error(`   ❌ Error:`, error.message, "\n");
  }
}

console.log("✨ Done!\n");
