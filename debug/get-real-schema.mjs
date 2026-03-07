import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "sb_publishable_w8xd4Fu4rqp0fnPpKPoR0Q_W9ykSBrx",
);

console.log("Checking actual PostgreSQL column types...\n");

// Get the schema by examining the actual data structure
const { data: ptData } = await supabase
  .from("pending_tickets")
  .select("competition_id")
  .limit(1);
const { data: ticketsData } = await supabase
  .from("tickets")
  .select("competition_id")
  .limit(1);
const { data: compData } = await supabase
  .from("competitions")
  .select("id")
  .limit(1);

console.log("Sample values from database:");
console.log("pending_tickets.competition_id:", ptData?.[0]?.competition_id);
console.log("tickets.competition_id:", ticketsData?.[0]?.competition_id);
console.log("competitions.id:", compData?.[0]?.id);

// Now let's test the actual comparison that's failing
console.log("\n=== Testing the failing allocate function ===\n");

const testCompId = "799a8e12-38f2-4989-ad24-15c995d673a6";
const testUserId = "prize:pid:0x0ff51ec0a752a53a3e94c8e92ecb1cce96450e65";

const { data, error } = await supabase.rpc("allocate_lucky_dip_tickets_batch", {
  p_user_id: testUserId,
  p_competition_id: testCompId,
  p_count: 5,
  p_ticket_price: 1,
  p_hold_minutes: 15,
  p_session_id: "test-session",
  p_unavailable_tickets: [],
});

if (error) {
  console.error("ERROR:", error.message);
  console.error("\nFull error details:");
  console.error("pg_context:", error.pg_context);

  // Parse the error to understand the type mismatch
  if (error.pg_message?.includes("uuid = text")) {
    console.log("\n🔴 CONFIRMED: UUID = TEXT comparison error");
    console.log(
      "This means NEW.competition_id is UUID but being compared to TEXT column",
    );
  }
} else {
  console.log("✅ SUCCESS:", data);
}

process.exit(0);
