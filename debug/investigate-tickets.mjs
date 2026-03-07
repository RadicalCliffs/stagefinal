import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "sb_publishable_w8xd4Fu4rqp0fnPpKPoR0Q_W9ykSBrx",
);

const competitionId = "799a8e12-38f2-4989-ad24-15c995d673a6";
const userId = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

console.log("=== Deeper Investigation ===\n");

// 1. Check competition total tickets
console.log("1. Competition Capacity:");
const { data: comp, error: compError } = await supabase
  .from("competitions")
  .select("id, title, total_tickets, tickets_sold, status")
  .eq("id", competitionId)
  .single();

if (compError) {
  console.log("❌ Error:", compError.message);
} else {
  console.log(`   Total capacity: ${comp.total_tickets} tickets`);
  console.log(`   Tickets sold count: ${comp.tickets_sold}`);
  console.log(`   Status: ${comp.status}`);
  console.log(`   Remaining: ${comp.total_tickets - comp.tickets_sold}`);
}

// 2. Check who owns the 629 tickets
console.log("\n2. Ticket Ownership:");
const { data: tickets, error: ticketsError } = await supabase
  .from("tickets")
  .select("user_id, canonical_user_id, wallet_address, COUNT(*)")
  .eq("competition_id", competitionId);

if (ticketsError) {
  console.log("❌ Error:", ticketsError.message);
} else {
  console.log("   Tickets by user:");

  // Group by user manually
  const userGroups = {};
  for (const ticket of tickets) {
    const key =
      ticket.canonical_user_id ||
      ticket.user_id ||
      ticket.wallet_address ||
      "unknown";
    userGroups[key] = (userGroups[key] || 0) + 1;
  }

  Object.entries(userGroups).forEach(([user, count]) => {
    console.log(`     ${user}: ${count} tickets`);
  });
}

// 3. Show all tickets for this competition
console.log("\n3. All Tickets (first 10):");
const { data: allTickets, error: allError } = await supabase
  .from("tickets")
  .select(
    "ticket_number, user_id, canonical_user_id, buyer_id, order_id, status, purchase_date",
  )
  .eq("competition_id", competitionId)
  .order("ticket_number", { ascending: true })
  .limit(10);

if (allError) {
  console.log("❌ Error:", allError.message);
} else {
  allTickets.forEach((t) => {
    console.log(
      `     Ticket #${t.ticket_number}: user_id=${t.user_id}, canonical=${t.canonical_user_id}, buyer=${t.buyer_id}, status=${t.status}`,
    );
  });
}

// 4. Check pending_tickets details
console.log("\n4. Pending Tickets Details:");
const { data: pending, error: pendingError } = await supabase
  .from("pending_tickets")
  .select("*")
  .eq("competition_id", competitionId)
  .eq("canonical_user_id", userId);

if (pendingError) {
  console.log("❌ Error:", pendingError.message);
} else {
  console.log(`   Found ${pending.length} pending ticket records for user`);
  pending.forEach((p) => {
    console.log(`\n     ID: ${p.id}`);
    console.log(`     Status: ${p.status}`);
    console.log(`     Ticket count: ${p.ticket_count}`);
    console.log(
      `     Ticket numbers: ${p.ticket_numbers?.slice(0, 5).join(", ")}... (${p.ticket_numbers?.length} total)`,
    );
    console.log(`     Total amount: $${p.total_amount}`);
    console.log(`     Created: ${p.created_at}`);
    console.log(`     Confirmed: ${p.confirmed_at || "Not confirmed"}`);
    console.log(`     Session ID: ${p.session_id}`);
    console.log(`     Order ID: ${p.order_id}`);
  });
}

// 5. Check if tickets table has entries with the pending order_id
console.log("\n5. Tickets Created from Pending Orders:");
for (const p of pending || []) {
  if (p.status === "confirmed") {
    const { data: createdTickets, error: createdError } = await supabase
      .from("tickets")
      .select("COUNT(*)")
      .eq("competition_id", competitionId)
      .eq("order_id", p.id);

    if (!createdError && createdTickets && createdTickets[0]) {
      console.log(
        `     Pending ${p.id}: ${createdTickets[0].count} tickets created in tickets table`,
      );
    }
  }
}

console.log("\n" + "=".repeat(70));
console.log("Investigation complete.");
console.log("=".repeat(70));

process.exit(0);
