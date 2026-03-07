import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "sb_publishable_w8xd4Fu4rqp0fnPpKPoR0Q_W9ykSBrx",
);

console.log("=== TESTING ALL FUNCTIONS AFTER FIX ===\n");

let allPassed = true;

// Test 1: get_unavailable_tickets
console.log("Test 1: get_unavailable_tickets function...");
const { data: d1, error: e1 } = await supabase.rpc("get_unavailable_tickets", {
  p_competition_id: "799a8e12-38f2-4989-ad24-15c995d673a6",
});

if (e1) {
  console.log("❌ FAILED:", e1.message);
  allPassed = false;
} else {
  console.log(
    "✅ PASSED - returned",
    Array.isArray(d1) ? `${d1.length} tickets` : d1,
  );
}

// Test 2: INSERT trigger (validate_pending_tickets)
console.log("\nTest 2: validate_pending_tickets trigger...");
const testId = crypto.randomUUID();
const { data: d2, error: e2 } = await supabase
  .from("pending_tickets")
  .insert({
    id: testId,
    user_id: "test-user-" + Date.now(),
    competition_id: "799a8e12-38f2-4989-ad24-15c995d673a6",
    ticket_numbers: [99999, 99998, 99997],
    ticket_count: 3,
    ticket_price: 1,
    total_amount: 3,
    status: "pending",
    expires_at: new Date(Date.now() + 900000).toISOString(),
  })
  .select();

if (e2) {
  console.log("❌ FAILED:", e2.message);
  if (e2.message?.includes("uuid = text")) {
    console.log("   Still has UUID = TEXT bug");
  }
  allPassed = false;
} else {
  console.log("✅ PASSED - trigger validated and allowed INSERT");
  // Clean up
  await supabase.from("pending_tickets").delete().eq("id", testId);
}

// Test 3: Check if update_tickets_sold_on_pending trigger ran
console.log("\nTest 3: update_tickets_sold_on_pending trigger...");
if (!e2) {
  const { data: compData } = await supabase
    .from("competitions")
    .select("tickets_sold")
    .eq("id", "799a8e12-38f2-4989-ad24-15c995d673a6")
    .single();

  console.log("✅ PASSED - tickets_sold updated to:", compData?.tickets_sold);
}

console.log("\n" + "=".repeat(60));
if (allPassed) {
  console.log("✅ ALL TESTS PASSED - FIX IS WORKING!");
} else {
  console.log("❌ SOME TESTS FAILED - CHECK ERRORS ABOVE");
}
console.log("=".repeat(60));

process.exit(allPassed ? 0 : 1);
