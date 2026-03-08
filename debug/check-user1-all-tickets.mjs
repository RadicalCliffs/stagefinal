import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

async function checkUserTickets() {
  const userId = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

  console.log("🔍 Checking all March 4 tickets for user 1...\n");

  // Get all tickets from March 4 for this user
  const { data: tickets } = await supabase
    .from("tickets")
    .select("ticket_number, competition_id, tx_id, created_at")
    .eq("canonical_user_id", userId)
    .gte("created_at", "2026-03-04T00:00:00")
    .lte("created_at", "2026-03-04T23:59:59")
    .order("ticket_number");

  if (!tickets) return;

  console.log(`📋 Total tickets: ${tickets.length}\n`);

  // Group by competition
  const byComp = {};
  tickets.forEach((t) => {
    if (!byComp[t.competition_id]) {
      byComp[t.competition_id] = [];
    }
    byComp[t.competition_id].push(t);
  });

  console.log(`🎯 Competitions: ${Object.keys(byComp).length}\n`);

  for (const [compId, compTickets] of Object.entries(byComp)) {
    const fakeHashes = compTickets.filter(
      (t) =>
        t.tx_id?.startsWith("0x") &&
        t.tx_id.length === 66 &&
        !t.tx_id.startsWith("0x7542"), // exclude the real hash we know
    );

    const realHashes = compTickets.filter((t) => t.tx_id?.startsWith("0x7542"));

    console.log(`Competition ${compId.substring(0, 30)}...`);
    console.log(`  Total: ${compTickets.length} tickets`);
    console.log(`  With real hash (0x7542...): ${realHashes.length}`);
    console.log(`  With fake hash: ${fakeHashes.length}`);

    if (fakeHashes.length > 0) {
      console.log(`  Sample fake: ${fakeHashes[0].tx_id.substring(0, 25)}...`);
    }
    console.log("");
  }
}

checkUserTickets().catch(console.error);
