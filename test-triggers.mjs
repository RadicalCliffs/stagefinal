import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "sb_publishable_w8xd4Fu4rqp0fnPpKPoR0Q_W9ykSBrx",
);

console.log("=== Listing all available RPC functions ===\n");

// Try calling a function that lists available functions
const { data, error } = await supabase.rpc("get_function_list");

if (error) {
  console.log("get_function_list not available, trying direct queries...\n");

  // Try to call the three functions we just created
  console.log("Testing get_unavailable_tickets...");
  const { data: d1, error: e1 } = await supabase.rpc(
    "get_unavailable_tickets",
    {
      p_competition_id: "799a8e12-38f2-4989-ad24-15c995d673a6",
    },
  );

  if (e1) {
    console.log("❌ Error:", e1.message);
  } else {
    console.log("✅ Function exists, returned:", d1);
  }

  console.log("\nTrying to list pending_tickets triggers...");
  const { data: ptData, error: ptError } = await supabase
    .from("pending_tickets")
    .select("id")
    .limit(1);

  if (ptError) {
    console.log("❌ pending_tickets error:", ptError);
  } else {
    console.log("✅ pending_tickets table accessible");
  }

  // Try to INSERT a test row to see if triggers fire
  console.log("\n=== Testing trigger by attempting INSERT ===");
  const testId = crypto.randomUUID();
  const { data: insertData, error: insertError } = await supabase
    .from("pending_tickets")
    .insert({
      id: testId,
      user_id: "test-user",
      competition_id: "799a8e12-38f2-4989-ad24-15c995d673a6",
      ticket_numbers: [1, 2, 3],
      ticket_count: 3,
      ticket_price: 1,
      total_amount: 3,
      status: "pending",
      expires_at: new Date(Date.now() + 900000).toISOString(),
    })
    .select();

  if (insertError) {
    console.log("❌ INSERT error (this shows trigger status):");
    console.log("Message:", insertError.message);
    console.log("Code:", insertError.code);
    console.log("Details:", insertError.details);
    console.log("Hint:", insertError.hint);

    if (insertError.message?.includes("uuid = text")) {
      console.log("\n🔴 CONFIRMED: Trigger has UUID = TEXT comparison bug");
    }
  } else {
    console.log("✅ INSERT succeeded:", insertData);

    // Clean up
    await supabase.from("pending_tickets").delete().eq("id", testId);
  }
}

process.exit(0);
