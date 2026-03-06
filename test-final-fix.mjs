// Test the FINAL fix
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg",
);

const compId = "a879ba68-d098-42f6-a687-f70fd7109ee8";

console.log("Testing FINAL fix with correct parameter name...\n");

// Test with p_competition_id (what function expects)
const { data, error } = await supabase.rpc("get_unavailable_tickets", {
  p_competition_id: compId,
});

if (error) {
  console.error("❌ Error:", error.message);
  console.log("\n📝 You still need to run: FIX_UNAVAILABLE_TICKETS_FINAL.sql");
} else {
  console.log(`✅ SUCCESS: ${data?.length || 0} unavailable tickets`);

  // Compare with DB
  const { data: tickets } = await supabase
    .from("tickets")
    .select("ticket_number")
    .eq("competition_id", compId);

  console.log(`   Tickets in DB: ${tickets?.length}`);

  if (data?.length === tickets?.length) {
    console.log("\n🎉 PERFECT! All tickets showing as unavailable!");
    console.log("\nNow test in browser:");
    console.log("1. Hard refresh (Ctrl+Shift+R)");
    console.log("2. Open ticket selector");
    console.log("3. Purchased tickets should be grayed out");
  } else {
    console.log("\n⚠️  Mismatch - check SQL function");
  }
}
