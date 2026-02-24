require("dotenv/config");
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY",
);

const JERRY = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

(async () => {
  // Find ALL Solana competitions
  const { data: comps } = await supabase
    .from("competitions")
    .select("id, title, ticket_price, total_tickets, tickets_sold")
    .or("title.ilike.%solana%,title.ilike.%slammer%,title.ilike.%slam%");

  console.log("All Solana/Slam competitions:");
  comps?.forEach((c) => console.log(c));

  // Get Jerry's entries for all these competitions
  for (const comp of comps || []) {
    const { count } = await supabase
      .from("tickets")
      .select("*", { count: "exact", head: true })
      .eq("competition_id", comp.id)
      .eq("canonical_user_id", JERRY);

    console.log(
      `\n${comp.title}: Jerry has ${count} tickets, ticket_price=${comp.ticket_price}`,
    );
  }

  // Also look for competitions with 2146 tickets for Jerry
  console.log("\n\n--- Searching for competition with ~2146 Jerry tickets ---");
  const { data: allEntries } = await supabase
    .from("competition_entries")
    .select("competition_id, tickets_count, competitions(title, ticket_price)")
    .eq("canonical_user_id", JERRY)
    .gte("tickets_count", 2000);

  console.log("Competitions where Jerry has 2000+ tickets:");
  allEntries?.forEach((e) => console.log(e));

  // Check tickets table directly
  const { data: ticketCounts } = await supabase
    .from("tickets")
    .select("competition_id, competitions(title, ticket_price)")
    .eq("canonical_user_id", JERRY);

  // Group by competition_id
  const counts = {};
  ticketCounts?.forEach((t) => {
    const key = t.competition_id;
    if (!counts[key]) {
      counts[key] = {
        count: 0,
        title: t.competitions?.title,
        price: t.competitions?.ticket_price,
      };
    }
    counts[key].count++;
  });

  console.log("\n--- All Jerry ticket counts by competition ---");
  Object.entries(counts).forEach(([id, data]) => {
    console.log(`${data.title}: ${data.count} tickets @ $${data.price}`);
  });
})();
