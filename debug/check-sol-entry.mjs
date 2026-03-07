import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY",
);

const USER_ID = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

console.log("=== Checking ALL SOL Competitions ===\n");

// Find ALL SOL competitions
const { data: solComps, error: solError } = await supabase
  .from("competitions")
  .select("id, title, ticket_price")
  .or("title.ilike.%SOL%,title.ilike.%sol%");

if (solError) {
  console.error("Error:", solError);
  process.exit(1);
}

console.log(`Found ${solComps.length} SOL-related competitions:\n`);

// Get all user entries for SOL competitions
const { data: entries } = await supabase
  .from("competition_entries")
  .select("*")
  .eq("canonical_user_id", USER_ID)
  .in(
    "competition_id",
    solComps.map((c) => c.id),
  );

console.log(`User has entries in ${entries?.length || 0} SOL competitions\n`);

for (const comp of solComps) {
  const entry = entries?.find((e) => e.competition_id === comp.id);

  console.log(`${comp.title} (${comp.id.substring(0, 8)}...)`);
  console.log(`  Ticket Price: $${comp.ticket_price}`);

  if (entry) {
    const expected = entry.tickets_count * comp.ticket_price;
    console.log(`  ✅ Has entry:`);
    console.log(`     Tickets: ${entry.tickets_count}`);
    console.log(`     Amount Spent: $${entry.amount_spent}`);
    console.log(`     Expected: $${expected}`);

    if (Math.abs(entry.amount_spent - expected) > 0.01) {
      console.log(`     ❌ MISMATCH! Fixing...`);

      const { error: updateError } = await supabase
        .from("competition_entries")
        .update({ amount_spent: expected })
        .eq("id", entry.id);

      if (updateError) {
        console.error(`     Failed:`, updateError.message);
      } else {
        console.log(`     ✅ Fixed to $${expected}`);
      }
    }
  } else {
    console.log(`  ⚪ No entry`);
  }
  console.log();
}
