import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY",
);

const USER_ID = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

console.log("=== EMERGENCY DIAGNOSTIC ===\n");

// Check if data still exists in competition_entries
console.log("1. Checking competition_entries table...");
const { data: entries, error: entriesError } = await supabase
  .from("competition_entries")
  .select("*")
  .eq("canonical_user_id", USER_ID);

if (entriesError) {
  console.error("❌ Error reading competition_entries:", entriesError);
} else {
  console.log(`✅ Found ${entries.length} entries in database`);
  if (entries.length > 0) {
    entries.forEach((e) => {
      console.log(
        `  - Competition: ${e.competition_id}, Tickets: ${e.tickets_count}, Amount: $${e.amount_spent}`,
      );
    });
  }
}

// Check if RPC function exists and works
console.log("\n2. Testing RPC function...");
const { data: rpcData, error: rpcError } = await supabase.rpc(
  "get_user_competition_entries",
  { p_user_identifier: USER_ID },
);

if (rpcError) {
  console.error("❌ RPC Error:", rpcError.message);
  console.error("Full error:", rpcError);
} else {
  console.log(`✅ RPC returned ${rpcData.length} entries`);
  if (rpcData.length > 0) {
    rpcData.forEach((e) => {
      console.log(
        `  - ${e.competition_title}: ${e.tickets_count} tickets, $${e.amount_spent}`,
      );
    });
  }
}

// Check canonical_users table
console.log("\n3. Checking canonical_users...");
const { data: users, error: usersError } = await supabase
  .from("canonical_users")
  .select("canonical_user_id, wallet_address")
  .eq("canonical_user_id", USER_ID);

if (usersError) {
  console.error("❌ Error:", usersError);
} else if (users.length === 0) {
  console.error("❌ User not found in canonical_users!");
} else {
  console.log("✅ User found:", users[0]);
}

console.log("\n=== END DIAGNOSTIC ===");
