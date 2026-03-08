import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

async function checkSchema() {
  console.log("🔍 Checking ACTUAL schema...\n");

  // Check canonical_users columns
  const { data: users, error: usersErr } = await supabase
    .from("canonical_users")
    .select("*")
    .limit(1);

  if (usersErr) {
    console.log("❌ canonical_users error:", usersErr.message);
  } else {
    console.log(
      "✅ canonical_users columns:",
      users && users[0] ? Object.keys(users[0]) : "NO DATA",
    );
  }

  // Check tickets columns
  const { data: tickets, error: ticketsErr } = await supabase
    .from("tickets")
    .select("*")
    .limit(1);

  if (ticketsErr) {
    console.log("❌ tickets error:", ticketsErr.message);
  } else {
    console.log(
      "✅ tickets columns:",
      tickets && tickets[0] ? Object.keys(tickets[0]) : "NO DATA",
    );
  }

  // Check user_transactions columns
  const { data: txs, error: txsErr } = await supabase
    .from("user_transactions")
    .select("*")
    .limit(1);

  if (txsErr) {
    console.log("❌ user_transactions error:", txsErr.message);
  } else {
    console.log(
      "✅ user_transactions columns:",
      txs && txs[0] ? Object.keys(txs[0]) : "NO DATA",
    );
  }
}

checkSchema().catch(console.error);
