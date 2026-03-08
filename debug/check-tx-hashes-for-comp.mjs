import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

// Win 10 ETH competition
const COMP_ID = "12cccfb1-df68-4b3e-a168-07dfeaeb06cc";
const TICKET_NUMBERS = [
  5, 6, 8, 20, 26, 30, 34, 58, 71, 72, 75, 76, 80, 82, 85, 86, 91, 94, 104, 107,
];

console.log("🔍 Checking TX hashes for competition entries\n");
console.log(`Competition ID: ${COMP_ID}`);
console.log(`Ticket Numbers: ${TICKET_NUMBERS.join(", ")}\n`);

// 1. Check tickets table
console.log("1️⃣ Checking tickets table:");
const { data: tickets } = await supabase
  .from("tickets")
  .select(
    "ticket_number, canonical_user_id, wallet_address, transaction_hash, payment_tx_hash, created_at",
  )
  .eq("competition_id", COMP_ID)
  .in("ticket_number", TICKET_NUMBERS)
  .order("ticket_number");

if (tickets && tickets.length > 0) {
  tickets.forEach((t) => {
    console.log(`  Ticket ${t.ticket_number}:`);
    console.log(
      `    User: ${t.canonical_user_id || t.wallet_address || "Unknown"}`,
    );
    console.log(`    transaction_hash: ${t.transaction_hash || "NULL"}`);
    console.log(`    payment_tx_hash: ${t.payment_tx_hash || "NULL"}`);
  });
} else {
  console.log("  ❌ No tickets found");
}

// 2. Check joincompetition table
console.log("\n2️⃣ Checking joincompetition table:");
const { data: joins } = await supabase
  .from("joincompetition")
  .select(
    "canonical_user_id, wallet_address, transaction_hash, transactionhash, ticket_numbers, payment_provider",
  )
  .or(`competition_id.eq.${COMP_ID},competitionid.eq.${COMP_ID}`);

if (joins && joins.length > 0) {
  joins.forEach((j) => {
    console.log(`  Entry:`);
    console.log(
      `    User: ${j.canonical_user_id || j.wallet_address || "Unknown"}`,
    );
    console.log(`    Tickets: ${j.ticket_numbers}`);
    console.log(`    transaction_hash: ${j.transaction_hash || "NULL"}`);
    console.log(`    transactionhash: ${j.transactionhash || "NULL"}`);
    console.log(`    payment_provider: ${j.payment_provider || "NULL"}`);
  });
} else {
  console.log("  ❌ No entries found");
}

// 3. Check pending_tickets table
console.log("\n3️⃣ Checking pending_tickets table:");
const { data: pending } = await supabase
  .from("pending_tickets")
  .select(
    "canonical_user_id, wallet_address, transaction_hash, ticket_numbers, status, payment_provider",
  )
  .eq("competition_id", COMP_ID);

if (pending && pending.length > 0) {
  pending.forEach((p) => {
    console.log(`  Pending:`);
    console.log(
      `    User: ${p.canonical_user_id || p.wallet_address || "Unknown"}`,
    );
    console.log(`    Tickets: ${p.ticket_numbers}`);
    console.log(`    transaction_hash: ${p.transaction_hash || "NULL"}`);
    console.log(`    status: ${p.status}`);
    console.log(`    payment_provider: ${p.payment_provider || "NULL"}`);
  });
} else {
  console.log("  ❌ No pending tickets found");
}

// 4. Check v_joincompetition_active view
console.log("\n4️⃣ Checking v_joincompetition_active view:");
const { data: view } = await supabase
  .from("v_joincompetition_active")
  .select(
    "canonical_user_id, wallet_address, transaction_hash, transactionhash, ticket_numbers",
  )
  .eq("competition_id", COMP_ID);

if (view && view.length > 0) {
  view.forEach((v) => {
    console.log(`  View Entry:`);
    console.log(
      `    User: ${v.canonical_user_id || v.wallet_address || "Unknown"}`,
    );
    console.log(`    Tickets: ${v.ticket_numbers}`);
    console.log(`    transaction_hash: ${v.transaction_hash || "NULL"}`);
    console.log(`    transactionhash: ${v.transactionhash || "NULL"}`);
  });
} else {
  console.log("  ❌ No view entries found");
}

// 5. Check user_transactions for topup txs
console.log("\n5️⃣ Checking user_transactions for balance topups:");
const { data: userTxs } = await supabase
  .from("user_transactions")
  .select(
    "canonical_user_id, wallet_address, type, tx_id, transaction_hash, created_at",
  )
  .eq("type", "topup")
  .in("status", ["completed", "confirmed"])
  .limit(20)
  .order("created_at", { ascending: false });

if (userTxs && userTxs.length > 0) {
  userTxs.forEach((tx) => {
    console.log(`  Topup:`);
    console.log(
      `    User: ${tx.canonical_user_id || tx.wallet_address || "Unknown"}`,
    );
    console.log(`    tx_id: ${tx.tx_id || "NULL"}`);
    console.log(`    transaction_hash: ${tx.transaction_hash || "NULL"}`);
    console.log(`    Date: ${tx.created_at}`);
  });
} else {
  console.log("  ❌ No topup transactions found");
}

console.log("\n✅ Check complete");
