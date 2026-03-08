import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

console.log("🔍 Checking if gen_ticket_tx_id function exists...\n");

const { data, error } = await supabase.rpc("gen_ticket_tx_id", {
  p_ticket_id: "00000000-0000-0000-0000-000000000000",
  p_competition_id: "00000000-0000-0000-0000-000000000000",
  p_ticket_number: 1,
  p_canonical_user_id: "test",
  p_wallet_address: "0x0",
  p_payment_provider: "test",
  p_payment_amount: 0,
  p_payment_tx_hash: "",
  p_created_at: new Date().toISOString(),
});

if (error) {
  console.log("❌ Function does NOT exist or errored:");
  console.log(error.message);
} else {
  console.log("✅ Function exists! Test result:");
  console.log(data);
}
