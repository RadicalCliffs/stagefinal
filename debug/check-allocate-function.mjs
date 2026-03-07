import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg";

const supabase = createClient(supabaseUrl, supabaseKey);

console.log("Testing allocate_lucky_dip_tickets_batch directly...\n");

// Call with the EXACT same parameters the edge function uses
const testCompId = "799a8e12-38f2-4989-ad24-15c995d673a6";
const testUserId = "prize:pid:0x0ff51ec0a752a53a3e94c8e92ecb1cce96450e65";

const { data, error } = await supabase.rpc("allocate_lucky_dip_tickets_batch", {
  p_user_id: testUserId,
  p_competition_id: testCompId,
  p_count: 10,
  p_ticket_price: 1,
  p_hold_minutes: 15,
  p_session_id: null,
  p_excluded_tickets: null,
});

if (error) {
  console.error("❌ RPC ERROR:");
  console.error("Code:", error.code);
  console.error("Message:", error.message);
  console.error("Details:", error.details);
  console.error("Hint:", error.hint);
} else {
  console.log("✓ RPC Response:");
  console.log(JSON.stringify(data, null, 2));

  if (data && typeof data === "object") {
    if (data.success) {
      console.log("\n✓✓✓ SUCCESS!");
    } else {
      console.log("\n❌ FUNCTION RETURNED ERROR:");
      console.log("Error:", data.error);
      console.log("Full response:", data);
    }
  }
}
