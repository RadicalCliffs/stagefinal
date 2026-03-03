import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "sb_publishable_w8xd4Fu4rqp0fnPpKPoR0Q_W9ykSBrx",
);

const competitionId = "799a8e12-38f2-4989-ad24-15c995d673a6";
const userId = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

console.log("=== Competition State Diagnosis ===\n");

// 1. Check competition details
console.log("1. Competition Details:");
const { data: comp, error: compError } = await supabase
  .from("competitions")
  .select(
    "id, title, total_tickets, ticket_price, tickets_sold, status, sold_out, end_date, draw_date",
  )
  .eq("id", competitionId)
  .single();

if (compError) {
  console.log("❌ Error:", compError.message);
} else {
  console.log("   Title:", comp.title);
  console.log("   Total tickets:", comp.total_tickets);
  console.log("   Tickets sold:", comp.tickets_sold);
  console.log("   Status:", comp.status);
  console.log("   Sold out:", comp.sold_out);
  console.log("   End date:", comp.end_date);
  console.log("   Draw date:", comp.draw_date);

  const remainingTickets = comp.total_tickets - comp.tickets_sold;
  console.log(`   Remaining: ${remainingTickets} tickets`);

  if (comp.sold_out && remainingTickets > 0) {
    console.log("   ⚠️  WARNING: Marked sold_out but has remaining tickets!");
  }
  if (!comp.sold_out && remainingTickets <= 0) {
    console.log(
      "   ⚠️  WARNING: Has no remaining tickets but not marked sold_out!",
    );
  }
}

// 2. Check actual ticket records
console.log("\n2. Actual Ticket Records:");
const { data: tickets, error: ticketsError } = await supabase
  .from("tickets")
  .select("id, ticket_number, user_id, status, purchase_date")
  .eq("competition_id", competitionId);

if (ticketsError) {
  console.log("❌ Error:", ticketsError.message);
} else {
  console.log(`   Total tickets records: ${tickets.length}`);
  const userTickets = tickets.filter((t) => t.user_id === userId);
  console.log(`   User's tickets: ${userTickets.length}`);

  const soldTickets = tickets.filter((t) => t.status === "sold");
  console.log(`   Sold status tickets: ${soldTickets.length}`);

  if (comp && tickets.length !== comp.tickets_sold) {
    console.log(
      `   ⚠️  MISMATCH: tickets table has ${tickets.length} but competitions.tickets_sold = ${comp.tickets_sold}`,
    );
  }
}

// 3. Check pending tickets
console.log("\n3. Pending Tickets:");
const { data: pending, error: pendingError } = await supabase
  .from("pending_tickets")
  .select("id, user_id, ticket_count, status, created_at, expires_at")
  .eq("competition_id", competitionId);

if (pendingError) {
  console.log("❌ Error:", pendingError.message);
} else {
  console.log(`   Total pending reservations: ${pending.length}`);
  const userPending = pending.filter(
    (p) =>
      p.user_id === userId ||
      p.user_id === "0x0ff51ec0ecc9ae1e5e6048976ba307c849781363",
  );
  console.log(`   User's pending: ${userPending.length}`);

  if (userPending.length > 0) {
    console.log("\n   User pending details:");
    userPending.forEach((p) => {
      console.log(
        `     - ${p.ticket_count} tickets, status: ${p.status}, created: ${p.created_at}`,
      );
    });
  }
}

// 4. Check user_transactions for this competition
console.log("\n4. User Transactions:");
const { data: txs, error: txsError } = await supabase
  .from("user_transactions")
  .select("id, amount, ticket_count, status, payment_status, created_at")
  .eq("competition_id", competitionId)
  .eq("canonical_user_id", userId)
  .order("created_at", { ascending: false });

if (txsError) {
  console.log("❌ Error:", txsError.message);
} else {
  console.log(`   Total transactions: ${txs.length}`);
  const totalTicketsBought = txs.reduce(
    (sum, tx) => sum + (tx.ticket_count || 0),
    0,
  );
  const totalSpent = txs.reduce((sum, tx) => sum + (tx.amount || 0), 0);
  console.log(`   Total tickets bought: ${totalTicketsBought}`);
  console.log(`   Total spent: $${totalSpent}`);

  if (txs.length > 0) {
    console.log("\n   Recent transactions:");
    txs.slice(0, 3).forEach((tx) => {
      console.log(
        `     - ${tx.ticket_count} tickets, $${tx.amount}, status: ${tx.status}/${tx.payment_status}, ${tx.created_at}`,
      );
    });
  }
}

// 5. Check get_unavailable_tickets
console.log("\n5. Unavailable Tickets Count:");
const { data: unavailable, error: unavailError } = await supabase.rpc(
  "get_unavailable_tickets",
  { comp_uid: competitionId },
);

if (unavailError) {
  console.log("❌ Error:", unavailError.message);
} else {
  console.log(`   Unavailable tickets: ${unavailable?.length || 0}`);
  if (comp && unavailable) {
    const available = comp.total_tickets - unavailable.length;
    console.log(`   Available tickets: ${available}`);

    if (available !== comp.total_tickets - comp.tickets_sold) {
      console.log(
        `   ⚠️  MISMATCH: Available (${available}) != Total - Sold (${comp.total_tickets - comp.tickets_sold})`,
      );
    }
  }
}

console.log("\n" + "=".repeat(70));
console.log("Diagnosis complete.");
console.log("=".repeat(70));

process.exit(0);
