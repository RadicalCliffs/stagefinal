import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const supabaseServiceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const targetEmails = [
  "jackson@theprize.io",
  "lukejewitt@gmail.com",
  "jacksonmudge001@gmail.com",
];

console.log("=== FINDING WINS FOR TARGET USERS ===\n");

const winnerData = [];

for (const email of targetEmails) {
  console.log(`📋 Checking ${email}...`);

  // Get user by email
  const { data: user, error: userError } = await supabase
    .from("canonical_users")
    .select("canonical_user_id, username, email")
    .eq("email", email)
    .single();

  if (userError || !user) {
    console.log(`   ❌ User not found\n`);
    continue;
  }

  // Get their most recent win
  const { data: wins, error: winError } = await supabase
    .from("winners")
    .select(
      `
      id,
      ticket_number,
      created_at,
      competitions!inner(id, title, ticket_price, prize_value, status)
    `,
    )
    .eq("user_id", user.canonical_user_id)
    .order("created_at", { ascending: false })
    .limit(1);

  if (winError || !wins || wins.length === 0) {
    console.log(`   ❌ No wins found\n`);
    continue;
  }

  const win = wins[0];
  const competition = win.competitions;

  console.log(`   ✅ Found win!`);
  console.log(`      Competition: ${competition.title}`);
  console.log(`      Winning Ticket: #${win.ticket_number}`);
  console.log(`      Won at: ${new Date(win.created_at).toLocaleString()}`);
  console.log(`      Prize Value: $${competition.prize_value || "N/A"}\n`);

  winnerData.push({
    email: user.email,
    username: user.username || "Player",
    ticket_number: win.ticket_number,
    competition_title: competition.title,
    prize_value: competition.prize_value,
    won_at: win.created_at,
  });
}

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("📊 SUMMARY");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

if (winnerData.length === 0) {
  console.log("❌ No wins found for any of the target users\n");
} else {
  console.log(`✅ Found ${winnerData.length} winner(s):\n`);

  winnerData.forEach((winner, idx) => {
    console.log(`${idx + 1}. ${winner.email}`);
    console.log(`   Competition: ${winner.competition_title}`);
    console.log(`   Winning Ticket: #${winner.ticket_number}`);
    console.log(`   Prize: $${winner.prize_value || "N/A"}`);
    console.log(`   Won: ${new Date(winner.won_at).toLocaleString()}\n`);
  });
}

// Export for next script
console.log("\n📝 Winner data ready for email sending.\n");

// Save to file for next step
import { writeFileSync } from "fs";
writeFileSync(
  "scripts/temp-winner-data.json",
  JSON.stringify(winnerData, null, 2),
);
console.log("💾 Saved winner data to scripts/temp-winner-data.json\n");
