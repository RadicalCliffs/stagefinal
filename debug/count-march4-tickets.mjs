import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

async function countFakeHashes() {
  console.log("🔍 Checking for tickets with fake blockchain hashes...\n");

  // Just count tickets created March 4
  const { count, error } = await supabase
    .from("tickets")
    .select("*", { count: "exact", head: true })
    .gte("created_at", "2026-03-04T00:00:00")
    .lte("created_at", "2026-03-04T23:59:59");

  if (error) {
    console.error("❌ Error:", error);
    return;
  }

  console.log(`📋 Tickets created on March 4: ${count}\n`);

  // Sample some tickets
  const { data: sample } = await supabase
    .from("tickets")
    .select(
      "ticket_number, competition_id, canonical_user_id, tx_id, created_at",
    )
    .gte("created_at", "2026-03-04T00:00:00")
    .lte("created_at", "2026-03-04T23:59:59")
    .limit(100);

  if (sample) {
    const with0x = sample.filter(
      (t) => t.tx_id?.startsWith("0x") && t.tx_id.length === 66,
    );
    console.log(`Sample of 100: ${with0x.length} have 0x hashes`);

    if (with0x.length > 0) {
      console.log("Sample hashes:");
      with0x.slice(0, 5).forEach((t) => {
        console.log(`  ${t.tx_id} - ticket ${t.ticket_number}`);
      });
    }
  }
}

countFakeHashes().catch(console.error);
