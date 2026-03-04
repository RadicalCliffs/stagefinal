import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "sb_publishable_w8xd4Fu4rqp0fnPpKPoR0Q_W9ykSBrx",
);

console.log("=== Querying ACTUAL tickets table columns from Supabase ===\n");

// Get one actual ticket to see all columns
const { data: tickets, error } = await supabase
  .from("tickets")
  .select("*")
  .limit(1);

if (error) {
  console.error("❌ Error:", error);
  process.exit(1);
}

if (tickets && tickets.length > 0) {
  const columns = Object.keys(tickets[0]).sort();
  console.log("✅ ACTUAL columns in tickets table:");
  console.log("=".repeat(60));
  columns.forEach((col) => {
    const value = tickets[0][col];
    const type =
      typeof value === "object" && value !== null ? "object" : typeof value;
    console.log(`  ${col} (${type})`);
  });
  console.log("=".repeat(60));
  console.log(`\nTotal columns: ${columns.length}`);

  // Check specific columns we're interested in
  console.log("\n🔍 Checking for transaction/payment columns:");
  const txColumns = columns.filter(
    (c) =>
      c.includes("transaction") ||
      c.includes("payment") ||
      c.includes("tx") ||
      c.includes("hash"),
  );
  if (txColumns.length > 0) {
    console.log("Found:", txColumns.join(", "));
  } else {
    console.log("❌ No transaction/payment related columns found");
  }
} else {
  console.log("No tickets found in the table");
}
