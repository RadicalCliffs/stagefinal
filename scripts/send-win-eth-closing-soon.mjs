import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sendgridApiKey = process.env.SENDGRID_API_KEY;
const sendgridFromEmail = "contact@theprize.io";
const closingSoonTemplateId = "d-7a2ad001923849df82394754988394e5";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

console.log("=== SENDING 'WIN ETH' CLOSING SOON EMAIL ===\n");

// Get the Win ETH competition
console.log("📋 Fetching 'Win ETH' competition...");
const { data: competition, error: compError } = await supabase
  .from("competitions")
  .select(
    "id, title, ticket_price, tickets_sold, total_tickets, end_date, status",
  )
  .eq("title", "Win ETH")
  .eq("status", "active")
  .single();

if (compError || !competition) {
  console.error("❌ Competition not found:", compError);
  process.exit(1);
}

const ticketsRemaining = Math.max(
  0,
  (competition.total_tickets || 0) - (competition.tickets_sold || 0),
);
const now = new Date();
const endDate = new Date(competition.end_date);
const hoursRemaining = Math.max(
  0,
  Math.round((endDate.getTime() - now.getTime()) / (1000 * 60 * 60)),
);

console.log(`✅ Competition: ${competition.title}`);
console.log(
  `   Tickets: ${competition.tickets_sold}/${competition.total_tickets} (${ticketsRemaining} remaining)`,
);
console.log(`   Entry Price: $${competition.ticket_price?.toFixed(2)}`);
console.log(`   Ends: ${endDate.toLocaleString()}`);
console.log(`   Hours Remaining: ${hoursRemaining}\n`);

// Get all users with emails containing jackson, luke, or highblock
console.log("📋 Fetching users with jackson/luke/highblock in email...");
const { data: allUsers, error: usersError } = await supabase
  .from("canonical_users")
  .select("canonical_user_id, email, username")
  .not("email", "is", null)
  .not("email", "eq", "");

if (usersError || !allUsers) {
  console.error("❌ Error fetching users:", usersError);
  process.exit(1);
}

// Filter for emails containing jackson, luke, or highblock (case-insensitive)
const targetUsers = allUsers.filter((user) => {
  const email = user.email.toLowerCase();
  return (
    email.includes("jackson") ||
    email.includes("luke") ||
    email.includes("highblock")
  );
});

if (targetUsers.length === 0) {
  console.log("❌ No users found with jackson/luke/highblock in email");
  process.exit(0);
}

console.log(`✅ Found ${targetUsers.length} users:\n`);
targetUsers.forEach((user, idx) => {
  console.log(
    `   ${idx + 1}. ${user.email} (${user.username || "no username"})`,
  );
});

console.log("\n⚠️  Sending emails in 3 seconds...\n");
await new Promise((resolve) => setTimeout(resolve, 3000));

// Send closing soon emails
const personalizations = targetUsers.map((user) => ({
  to: [{ email: user.email }],
  dynamic_template_data: {
    prize_name: competition.title,
    tickets_remaining: ticketsRemaining.toString(),
    hours_remaining: `${hoursRemaining} hours`,
    entry_price: `$${competition.ticket_price?.toFixed(2) || "0.00"}`,
    "Cash alternative available": "Cash alternative available",
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
    console.error(`❌ SendGrid error (${response.status}):`, errorText);
  } else {
    console.log(
      `✅ Successfully sent ${targetUsers.length} closing soon emails!\n`,
    );
    console.log("📧 Recipients:");
    targetUsers.forEach((user, idx) => {
      console.log(`   ${idx + 1}. ${user.email}`);
    });
  }
} catch (error) {
  console.error(`❌ Error:`, error);
}

console.log("\n✨ Done!\n");
