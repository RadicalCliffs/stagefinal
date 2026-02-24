require("dotenv/config");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.PUBLIC_SUPABASE_URL || "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY",
);

async function fixAllTicketCounts() {
  console.log("=== FIXING ALL COMPETITION TICKET COUNTS ===\n");

  // Get all competitions
  const { data: comps, error: compErr } = await supabase
    .from("competitions")
    .select("id, title, tickets_sold")
    .order("created_at", { ascending: false });

  if (compErr) {
    console.error("Error fetching competitions:", compErr);
    return;
  }

  let fixed = 0;
  let errors = 0;

  for (const comp of comps) {
    // Count actual tickets
    const { count, error: countErr } = await supabase
      .from("tickets")
      .select("*", { count: "exact", head: true })
      .eq("competition_id", comp.id);

    if (countErr) {
      console.error(
        `Error counting tickets for ${comp.title}:`,
        countErr.message,
      );
      errors++;
      continue;
    }

    const actualCount = count || 0;

    // Only update if different
    if (comp.tickets_sold !== actualCount) {
      const { error: updateErr } = await supabase
        .from("competitions")
        .update({ tickets_sold: actualCount })
        .eq("id", comp.id);

      if (updateErr) {
        console.error(`Error updating ${comp.title}:`, updateErr.message);
        errors++;
      } else {
        console.log(
          `${comp.title.substring(0, 40)}: ${comp.tickets_sold} → ${actualCount}`,
        );
        fixed++;
      }
    }
  }

  console.log(`\n=== DONE: ${fixed} fixed, ${errors} errors ===`);
}

fixAllTicketCounts().catch(console.error);
