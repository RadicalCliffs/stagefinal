import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const supabaseServiceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

console.log("=== FETCHING LATEST COMPETITIONS ===\n");

const { data: competitions, error } = await supabase
  .from("competitions")
  .select(
    "id, title, status, ticket_price, tickets_sold, total_tickets, end_date, created_at",
  )
  .order("created_at", { ascending: false })
  .limit(5);

if (error) {
  console.error("❌ Error:", error);
  process.exit(1);
}

console.log(`📊 Latest ${competitions.length} Competitions:\n`);

competitions.forEach((comp, idx) => {
  const ticketsRemaining = (comp.total_tickets || 0) - (comp.tickets_sold || 0);
  const endDate = comp.end_date ? new Date(comp.end_date) : null;
  const isEnded = endDate && endDate < new Date();

  console.log(`${idx + 1}. ${comp.title}`);
  console.log(`   ID: ${comp.id}`);
  console.log(`   Status: ${comp.status}${isEnded ? " (ended)" : ""}`);
  console.log(`   Entry Price: $${comp.ticket_price?.toFixed(2) || "0.00"}`);
  console.log(
    `   Tickets: ${comp.tickets_sold || 0}/${comp.total_tickets || 0} (${ticketsRemaining} remaining)`,
  );
  console.log(`   Created: ${new Date(comp.created_at).toLocaleString()}`);
  if (endDate) {
    console.log(`   Ends: ${endDate.toLocaleString()}`);
  }
  console.log();
});
