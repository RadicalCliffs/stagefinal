import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY",
);

const USER_ID = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

console.log("=== Checking $1000 Competition ===\n");

// Find competition
const { data: comps } = await supabase
  .from("competitions")
  .select("id, title, ticket_price")
  .ilike("title", "%1000%");

if (!comps || comps.length === 0) {
  console.error("Can't find $1000 competition");
  process.exit(1);
}

const comp = comps[0];
console.log("Competition:", comp.title);
console.log("ID:", comp.id);
console.log("Ticket Price:", `$${comp.ticket_price}\n`);

// Check competition_entries
const { data: entry } = await supabase
  .from("competition_entries")
  .select("*")
  .eq("canonical_user_id", USER_ID)
  .eq("competition_id", comp.id)
  .single();

console.log("competition_entries:");
console.log("  Tickets Count:", entry.tickets_count);
console.log("  Amount Spent:", `$${entry.amount_spent}`);
console.log(
  "  Expected:",
  `${entry.tickets_count} × $${comp.ticket_price} = $${entry.tickets_count * comp.ticket_price}\n`,
);

// Check individual tickets
const { data: tickets } = await supabase
  .from("tickets")
  .select("ticket_number, purchase_price, purchase_key, purchased_at")
  .eq("canonical_user_id", USER_ID)
  .eq("competition_id", comp.id)
  .order("purchased_at", { ascending: false });

console.log(`Individual tickets: ${tickets.length} tickets`);

// Group by purchase_key
const byPurchase = {};
tickets.forEach((t) => {
  const key = t.purchase_key || t.purchased_at;
  if (!byPurchase[key]) {
    byPurchase[key] = { count: 0, prices: [] };
  }
  byPurchase[key].count++;
  byPurchase[key].prices.push(t.purchase_price);
});

console.log(`\nPurchases (${Object.keys(byPurchase).length} groups):`);
for (const [key, info] of Object.entries(byPurchase)) {
  const totalPrice = info.prices.reduce((sum, p) => sum + (p || 0), 0);
  console.log(
    `  ${key?.substring(0, 20)}...: ${info.count} tickets, total: $${totalPrice}`,
  );
}

// Calculate correct amount
const correctAmount = entry.tickets_count * comp.ticket_price;

if (Math.abs(entry.amount_spent - correctAmount) > 0.01) {
  console.log(`\n❌ FIXING: $${entry.amount_spent} → $${correctAmount}`);

  const { error } = await supabase
    .from("competition_entries")
    .update({ amount_spent: correctAmount })
    .eq("id", entry.id);

  if (error) {
    console.error("Failed:", error);
  } else {
    console.log("✅ Fixed!");
  }
} else {
  console.log("\n✅ Amount is correct");
}
