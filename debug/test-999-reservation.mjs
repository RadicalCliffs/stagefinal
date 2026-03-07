import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY";

const supabase = createClient(supabaseUrl, supabaseKey);

const competitionId = "a879ba68-d098-42f6-a687-f70fd7109ee8";
const testUserId = "test-user-" + Date.now();

console.log("Testing 999 ticket reservation...");
console.log("Competition ID:", competitionId);
console.log("User ID:", testUserId);

// Test the RPC directly
const { data, error } = await supabase.rpc("allocate_lucky_dip_tickets_batch", {
  p_user_id: `prize:pid:${testUserId}`,
  p_competition_id: competitionId,
  p_count: 999,
  p_ticket_price: 1,
  p_hold_minutes: 15,
  p_session_id: "test-session-" + Date.now(),
  p_excluded_tickets: null,
});

if (error) {
  console.error("\n❌ RPC ERROR:");
  console.error("Message:", error.message);
  console.error("Details:", error.details);
  console.error("Hint:", error.hint);
  console.error("Code:", error.code);
  console.error("\nFull error object:", JSON.stringify(error, null, 2));
} else {
  console.log("\n✅ SUCCESS!");
  console.log("Result:", JSON.stringify(data, null, 2));
}
