require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl =
  process.env.VITE_SUPABASE_URL || "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Get sold_out competitions
  const { data: soldOut, error: e1 } = await supabase
    .from("competitions")
    .select("id, title, status, uid, winner_address, total_tickets, end_date")
    .eq("status", "sold_out")
    .is("winner_address", null);

  console.log("\n=== SOLD OUT COMPETITIONS (no winner) ===");
  if (e1) console.error(e1);
  else {
    soldOut?.forEach((c) => {
      const isNumericUid = c.uid && /^\d+$/.test(c.uid);
      console.log(`- ${c.title}`);
      console.log(`  id: ${c.id}`);
      console.log(
        `  uid: ${c.uid} (${isNumericUid ? "NUMERIC - OK" : "NOT NUMERIC - needs on-chain creation"})`,
      );
      console.log(`  tickets: ${c.total_tickets}, end: ${c.end_date}`);
      console.log();
    });
  }

  // Get ended competitions
  const { data: ended, error: e2 } = await supabase
    .from("competitions")
    .select("id, title, status, uid, winner_address, total_tickets, end_date")
    .is("winner_address", null)
    .not("end_date", "is", null)
    .lt("end_date", new Date().toISOString())
    .limit(10);

  console.log("\n=== ENDED COMPETITIONS (no winner) ===");
  if (e2) console.error(e2);
  else {
    ended?.forEach((c) => {
      const isNumericUid = c.uid && /^\d+$/.test(c.uid);
      console.log(`- ${c.title}`);
      console.log(`  id: ${c.id}`);
      console.log(
        `  uid: ${c.uid} (${isNumericUid ? "NUMERIC - OK" : "NOT NUMERIC - needs on-chain creation"})`,
      );
      console.log(
        `  status: ${c.status}, tickets: ${c.total_tickets}, end: ${c.end_date}`,
      );
      console.log();
    });
  }
}

main().catch(console.error);
