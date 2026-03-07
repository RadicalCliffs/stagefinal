import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg";

const supabase = createClient(supabaseUrl, supabaseKey);

console.log("Testing what functions are actually working in Supabase...\n");

// Test 1: get_unavailable_tickets
console.log("1. Testing get_unavailable_tickets (broken with stack depth):");
try {
  const { data, error } = await supabase.rpc("get_unavailable_tickets", {
    competition_id: "799a8e12-38f2-4989-ad24-15c995d673a6",
  });

  if (error) {
    console.error(
      "   ❌ ERROR:",
      error.code,
      "-",
      error.message.substring(0, 80),
    );
  } else {
    console.log("   ✓ Works! Returned", data?.length || 0, "tickets");
  }
} catch (err) {
  console.error("   ❌ Exception:", err.message);
}

// Test 2: allocate_lucky_dip_tickets_batch
console.log("\n2. Testing allocate_lucky_dip_tickets_batch with 1 ticket:");
try {
  const { data, error } = await supabase.rpc(
    "allocate_lucky_dip_tickets_batch",
    {
      p_user_id: "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363",
      p_competition_id: "799a8e12-38f2-4989-ad24-15c995d673a6",
      p_count: 1,
      p_ticket_price: 1,
      p_hold_minutes: 1,
      p_session_id: "test-" + Date.now(),
      p_excluded_tickets: null,
    },
  );

  if (error) {
    console.error(
      "   ❌ ERROR:",
      error.code,
      "-",
      error.message.substring(0, 100),
    );
    console.error("   Full error:", error);
  } else {
    console.log("   ✓ Works! Result:", JSON.stringify(data, null, 2));
  }
} catch (err) {
  console.error("   ❌ Exception:", err.message);
}

console.log("\n=== DIAGNOSIS ===");
console.log("If both functions fail, you need to apply SIMPLEST_FIX.sql");
console.log(
  "Go to: https://supabase.com/dashboard/project/mthwfldcjvpxjtmrqkqm/sql/new",
);
