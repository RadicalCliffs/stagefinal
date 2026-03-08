import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

async function checkHashFormat() {
  console.log("🔍 Checking last_topup_tx_hash format...\n");

  const { data, error } = await supabase
    .from("canonical_users")
    .select("canonical_user_id, last_topup_tx_hash")
    .not("last_topup_tx_hash", "is", null)
    .limit(5);

  if (error) {
    console.error("❌ Error:", error.message);
    return;
  }

  if (!data || data.length === 0) {
    console.log("No users with last_topup_tx_hash found");
    return;
  }

  console.log(`Found ${data.length} users with hashes:\n`);

  data.forEach((user) => {
    console.log(
      `User: ${user.canonical_user_id?.substring(0, 30) || "N/A"}...`,
    );
    console.log(`Hash type: ${typeof user.last_topup_tx_hash}`);
    console.log(`Hash value:`, user.last_topup_tx_hash);
    console.log(`JSON stringified:`, JSON.stringify(user.last_topup_tx_hash));
    console.log("");
  });
}

checkHashFormat().catch(console.error);
