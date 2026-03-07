import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "sb_publishable_w8xd4Fu4rqp0fnPpKPoR0Q_W9ykSBrx",
);

console.log("=== Testing payment flow after adding missing function ===\n");

// Test 1: Can we call the function directly?
console.log("Test 1: Call check_and_mark_competition_sold_out...");
const { data: d1, error: e1 } = await supabase.rpc(
  "check_and_mark_competition_sold_out",
  {
    p_competition_id: "799a8e12-38f2-4989-ad24-15c995d673a6",
  },
);

if (e1) {
  console.log("❌ FAILED:", e1.message);
} else {
  console.log("✅ PASSED - returned:", d1);
}

// Test 2: Try to PATCH a pending_tickets record (simulating payment confirmation)
console.log(
  "\nTest 2: Simulate payment confirmation (PATCH pending_tickets)...",
);

// First, create a test reservation
const testId = crypto.randomUUID();
const { data: insertData, error: insertError } = await supabase
  .from("pending_tickets")
  .insert({
    id: testId,
    user_id: "test-payment-" + Date.now(),
    competition_id: "799a8e12-38f2-4989-ad24-15c995d673a6",
    ticket_numbers: [99991, 99992, 99993],
    ticket_count: 3,
    ticket_price: 1,
    total_amount: 3,
    status: "pending",
    expires_at: new Date(Date.now() + 900000).toISOString(),
  })
  .select()
  .single();

if (insertError) {
  console.log("❌ INSERT failed:", insertError.message);
} else {
  console.log("✅ Created test reservation:", testId);

  // Now try to PATCH it (this is what payment confirmation does)
  const { data: patchData, error: patchError } = await supabase
    .from("pending_tickets")
    .update({
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      transaction_hash: "0xtest123",
    })
    .eq("id", testId)
    .select();

  if (patchError) {
    console.log("❌ PATCH failed:", patchError.message);
    console.log("   Error code:", patchError.code);
    console.log("   Details:", patchError.details);

    if (patchError.message?.includes("check_and_mark_competition_sold_out")) {
      console.log("\n🔴 Still missing the function - run the SQL first!");
    }
  } else {
    console.log("✅ PATCH succeeded - payment confirmation works!");
    console.log("   Updated record:", patchData);
  }

  // Clean up
  await supabase.from("pending_tickets").delete().eq("id", testId);
}

console.log("\n" + "=".repeat(60));
console.log("If no errors above, payments should work now!");
console.log("=".repeat(60));

process.exit(0);
