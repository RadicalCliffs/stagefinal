import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

async function countFakeHashes() {
  console.log("🔍 Checking for tickets with fake blockchain hashes...\n");

  // Get all tickets created around March 4 with 0x hashes
  const { data: tickets, error } = await supabase
    .from("tickets")
    .select(
      "ticket_number, competition_id, canonical_user_id, tx_id, created_at",
    )
    .gte("created_at", "2026-03-01")
    .lte("created_at", "2026-03-10")
    .not("tx_id", "is", null)
    .order("created_at");

  if (error) {
    console.error("❌ Error:", error);
    return;
  }

  console.log(
    `📋 Found ${tickets.length} tickets with tx_id from March 1-10\n`,
  );

  // Filter for 0x hashes (not BAL_ or charge IDs)
  const fakeHashTickets = tickets.filter(
    (t) =>
      t.tx_id &&
      t.tx_id.startsWith("0x") &&
      t.tx_id.length === 66 &&
      !t.tx_id.startsWith("0xaade"), // exclude the known real recent hash
  );

  console.log(
    `🎭 ${fakeHashTickets.length} tickets with potential fake 0x hashes\n`,
  );

  // Group by competition
  const byCompetition = {};
  fakeHashTickets.forEach((t) => {
    if (!byCompetition[t.competition_id]) {
      byCompetition[t.competition_id] = [];
    }
    byCompetition[t.competition_id].push(t);
  });

  console.log(
    `🎯 Affected competitions: ${Object.keys(byCompetition).length}\n`,
  );

  for (const [compId, compTickets] of Object.entries(byCompetition)) {
    const uniqueUsers = [
      ...new Set(compTickets.map((t) => t.canonical_user_id)),
    ];
    console.log(`Competition ${compId.substring(0, 20)}...`);
    console.log(`  ${compTickets.length} tickets`);
    console.log(`  ${uniqueUsers.length} users`);
    console.log(
      `  Dates: ${compTickets[0].created_at} to ${compTickets[compTickets.length - 1].created_at}`,
    );
    console.log(`  Sample hash: ${compTickets[0].tx_id}`);
    console.log("");
  }
}

countFakeHashes().catch(console.error);
