import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg",
);

const unpaidIds = [
  "7631c0d6-367b-4a51-a6c3-56dd134ccbe5",
  "c8e77a89-7267-41bf-a367-df4d1f2a8929",
  "27c27dfe-e50b-42da-9b9b-bb91b4a570e5",
];

console.log("=== CHECKING UNPAID TRANSACTIONS ===\n");

for (const id of unpaidIds) {
  const { data, error } = await supabase
    .from("user_transactions")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.log(`Error for ${id}:`, error.message);
  } else {
    console.log(`Transaction: ${id}`);
    console.log(`  Amount: $${data.amount}`);
    console.log(`  Status: ${data.status}`);
    console.log(`  Payment Status: ${data.payment_status}`);
    console.log(`  Payment Provider: ${data.payment_provider}`);
    console.log(`  Canonical User ID: ${data.canonical_user_id}`);
    console.log(`  Webhook Ref: ${data.webhook_ref}`);
    console.log(`  Created: ${data.created_at}`);
    console.log("");
  }
}
