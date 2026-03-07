import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "sb_publishable_w8xd4Fu4rqp0fnPpKPoR0Q_W9ykSBrx",
);

const competitionId = "799a8e12-38f2-4989-ad24-15c995d673a6";

console.log("=== Checking Why Competition Marked Sold Out ===\n");

// Count actual tickets from tickets table
console.log("1. Tickets table count:");
const { count: ticketsCount, error: ticketsError } = await supabase
  .from("tickets")
  .select("*", { count: "exact", head: true })
  .eq("competition_id", competitionId);

console.log(`   Tickets in tickets table: ${ticketsCount || 0}`);

// Count joincompetition entries
console.log("\n2. Joincompetition count:");
const { data: jcData, error: jcError } = await supabase
  .from("joincompetition")
  .select("ticketnumbers")
  .eq("competitionid", competitionId);

let jcTicketCount = 0;
if (jcData) {
  jcData.forEach((entry) => {
    if (entry.ticketnumbers) {
      jcTicketCount += entry.ticketnumbers.split(",").length;
    }
  });
}
console.log(`   Tickets in joincompetition: ${jcTicketCount}`);

// Count pending tickets by status
console.log("\n3. Pending tickets breakdown:");
const { data: allPending, error: allPendingError } = await supabase
  .from("pending_tickets")
  .select("status, ticket_count, created_at, expires_at, canonical_user_id")
  .eq("competition_id", competitionId);

if (allPending) {
  const byStatus = {};
  let pendingOnlyCount = 0;

  allPending.forEach((p) => {
    byStatus[p.status] = (byStatus[p.status] || 0) + p.ticket_count;
    if (p.status === "pending" && new Date(p.expires_at) > new Date()) {
      pendingOnlyCount += p.ticket_count;
    }
  });

  console.log("   By status:");
  Object.entries(byStatus).forEach(([status, count]) => {
    console.log(`     ${status}: ${count} tickets`);
  });

  console.log(`\n   Active 'pending' status only: ${pendingOnlyCount} tickets`);
}

// Calculate what check_and_mark_competition_sold_out would see
console.log("\n4. What check_and_mark_competition_sold_out calculates:");
const totalFromJC = jcTicketCount;
const totalFromTickets = ticketsCount || 0;
const soldCount = totalFromJC + totalFromTickets;

const pendingActiveCount =
  allPending
    ?.filter(
      (p) => p.status === "pending" && new Date(p.expires_at) > new Date(),
    )
    .reduce((sum, p) => sum + p.ticket_count, 0) || 0;

console.log(
  `   Sold count: ${totalFromJC} (joincompetition) + ${totalFromTickets} (tickets) = ${soldCount}`,
);
console.log(`   Pending count: ${pendingActiveCount}`);
console.log(`   Total allocated: ${soldCount + pendingActiveCount}`);

// Get competition capacity
const { data: comp } = await supabase
  .from("competitions")
  .select("total_tickets, tickets_sold, status")
  .eq("id", competitionId)
  .single();

if (comp) {
  console.log(`\n   Competition total: ${comp.total_tickets}`);
  console.log(`   Competition tickets_sold field: ${comp.tickets_sold}`);
  console.log(`   Competition status: ${comp.status}`);

  const shouldBeSoldOut = soldCount + pendingActiveCount >= comp.total_tickets;
  console.log(`\n   Should be sold out? ${shouldBeSoldOut}`);
  console.log(`   Is marked sold out? ${comp.status === "sold_out"}`);

  if (comp.status === "sold_out" && !shouldBeSoldOut) {
    console.log(
      "\n   ❌ INCORRECT: Competition is marked sold_out but should not be!",
    );
    console.log(
      `   Allocated: ${soldCount + pendingActiveCount} / ${comp.total_tickets}`,
    );
    console.log(
      `   Remaining: ${comp.total_tickets - soldCount - pendingActiveCount}`,
    );
  }
}

console.log("\n" + "=".repeat(70));
console.log("Analysis complete.");
console.log("=".repeat(70));

process.exit(0);
