import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "sb_publishable_w8xd4Fu4rqp0fnPpKPoR0Q_W9ykSBrx",
);

const userId = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";
const walletAddress = "0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";
const competitionId = "799a8e12-38f2-4989-ad24-15c995d673a6";

console.log("=== Detailed Ticket Analysis ===\n");
console.log(`Checking purchase_price values for 627 tickets...\n`);

const { data: tickets, error } = await supabase
  .from("tickets")
  .select(
    "id, ticket_number, purchase_price, purchase_date, status, created_at",
  )
  .eq("competition_id", competitionId)
  .or(
    `user_id.eq.${userId},canonical_user_id.eq.${userId},wallet_address.ilike.${walletAddress}`,
  )
  .order("ticket_number");

if (error) {
  console.log("❌ Error:", error.message);
} else {
  console.log(`Found ${tickets.length} tickets\n`);

  // Analyze purchase_price values
  const priceGroups = {};
  tickets.forEach((t) => {
    const price = t.purchase_price || 0;
    if (!priceGroups[price]) {
      priceGroups[price] = [];
    }
    priceGroups[price].push(t.ticket_number);
  });

  console.log("Purchase Price Distribution:");
  console.log("-".repeat(80));
  Object.keys(priceGroups)
    .sort((a, b) => parseFloat(b) - parseFloat(a))
    .forEach((price) => {
      const count = priceGroups[price].length;
      const total = parseFloat(price) * count;
      console.log(
        `  $${price}: ${count} tickets (total: $${total.toFixed(2)})`,
      );
      if (count <= 10) {
        console.log(`     Ticket numbers: ${priceGroups[price].join(", ")}`);
      }
    });

  const totalAmount = tickets.reduce(
    (sum, t) => sum + (parseFloat(t.purchase_price) || 0),
    0,
  );
  const expectedAmount = tickets.length * 0.1;

  console.log("\n" + "=".repeat(80));
  console.log(`Total tickets: ${tickets.length}`);
  console.log(`Total purchase_price (sum): $${totalAmount.toFixed(2)}`);
  console.log(
    `Expected total ($0.10 × ${tickets.length}): $${expectedAmount.toFixed(2)}`,
  );
  console.log(`Difference: $${(expectedAmount - totalAmount).toFixed(2)}`);

  if (Math.abs(expectedAmount - totalAmount) > 0.01) {
    console.log("\n❌ ISSUE CONFIRMED: purchase_price values are incorrect!");
    console.log(
      `   ${tickets.length - (priceGroups["0.1"] || []).length} tickets have wrong purchase_price`,
    );

    console.log("\n🔧 RECOMMENDED FIX:");
    console.log(`   UPDATE tickets`);
    console.log(`   SET purchase_price = 0.1`);
    console.log(`   WHERE competition_id = '${competitionId}'`);
    console.log(
      `     AND (canonical_user_id = '${userId}' OR wallet_address ILIKE '${walletAddress}')`,
    );
    console.log(`     AND (purchase_price IS NULL OR purchase_price != 0.1);`);
  } else {
    console.log("\n✅ All purchase_price values are correct");
  }

  // Check for recent tickets (likely the problematic batch)
  const recentTickets = tickets.filter((t) => {
    const created = new Date(t.created_at);
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - 1); // Last hour
    return created > cutoff;
  });

  if (recentTickets.length > 0) {
    console.log(
      `\n\n📅 Recent Tickets (last hour): ${recentTickets.length} tickets`,
    );
    const recentTotal = recentTickets.reduce(
      (sum, t) => sum + (parseFloat(t.purchase_price) || 0),
      0,
    );
    console.log(`   Total purchase_price: $${recentTotal.toFixed(2)}`);
    console.log(`   Expected: $${(recentTickets.length * 0.1).toFixed(2)}`);
    console.log(
      `   Sample ticket numbers: ${recentTickets
        .slice(0, 10)
        .map((t) => t.ticket_number)
        .join(", ")}`,
    );
  }
}
