import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

async function rollbackAllHashes() {
  console.log("🔄 ROLLING BACK all balance payment hashes to NULL...\n");

  // Get all tickets with 0x hashes from Feb-Mar (these were all updated by us)
  let allTickets = [];
  let page = 0;

  while (true) {
    const { data: tickets } = await supabase
      .from("tickets")
      .select("ticket_number, tx_id")
      .gte("created_at", "2026-02-20")
      .lte("created_at", "2026-03-08")
      .range(page * 1000, (page + 1) * 1000 - 1);

    if (!tickets || tickets.length === 0) break;

    const with0x = tickets.filter(
      (t) => t.tx_id?.startsWith("0x") && t.tx_id.length === 66,
    );

    allTickets.push(...with0x);
    if (tickets.length < 1000) break;
    page++;
  }

  console.log(`📋 Found ${allTickets.length} tickets with 0x hashes\n`);
  console.log("🗑️  Setting all to NULL...\n");

  let updated = 0;
  const batchSize = 100;

  for (let i = 0; i < allTickets.length; i += batchSize) {
    const batch = allTickets.slice(i, i + batchSize);
    const ticketNumbers = batch.map((t) => t.ticket_number);

    const { error } = await supabase
      .from("tickets")
      .update({ tx_id: null })
      .in("ticket_number", ticketNumbers);

    if (!error) {
      updated += batch.length;
      if (updated % 1000 === 0) {
        console.log(`   Rolled back ${updated} / ${allTickets.length}...`);
      }
    }
  }

  console.log(`\n✅ Rolled back ${updated} tickets to NULL`);
  console.log(
    "\nNow need to properly map each user to THEIR OWN topup by wallet address",
  );
}

rollbackAllHashes().catch(console.error);
