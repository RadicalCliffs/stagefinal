import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

const USER_HASHES = {
  "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363":
    "0xac1dfe66d18919a0434793ee74e15e831babec126afedaa25df2d49d101fd901",
  "prize:pid:0x543e8fb59312a2578f70152c79eae169e4f8fe9e":
    "0x271a504c9639c98e520bdd181a03370609313993e830d4f547ae1a68c61b768b",
  "prize:pid:0xe1a2e7487ddb3d82b150b47b8c6e9e5e03e0caf6":
    "0x95e380db63e9f3e20b2bca6e421c6aaba3c57d87418d95ee14903d129d49c1eb",
};

console.log(
  "🔧 Fixing balance payment tickets with WRONG hashes (not their user's topup)...\n",
);

for (const [userId, correctHash] of Object.entries(USER_HASHES)) {
  console.log(`User: ${userId.substring(0, 40)}...`);

  // Update all balance payment tickets for this user that have a WRONG hash
  const { data, error, count } = await supabase
    .from("tickets")
    .update({ tx_id: correctHash })
    .eq("canonical_user_id", userId)
    .in("payment_provider", ["balance", "balance_payment"])
    .neq("tx_id", correctHash)
    .select("id");

  if (error) {
    console.log(`  ❌ Error: ${error.message}`);
  } else {
    console.log(`  ✅ Fixed ${data?.length || 0} tickets`);
  }
  console.log();
}

console.log("🎉 Done! Running verification...\n");

// Verify
for (const [userId, expectedHash] of Object.entries(USER_HASHES)) {
  console.log(`User: ${userId.substring(0, 40)}...`);

  const { count: total } = await supabase
    .from("tickets")
    .select("*", { count: "exact", head: true })
    .eq("canonical_user_id", userId);

  const { count: correct } = await supabase
    .from("tickets")
    .select("*", { count: "exact", head: true })
    .eq("canonical_user_id", userId)
    .eq("tx_id", expectedHash);

  const { count: balanceWrong } = await supabase
    .from("tickets")
    .select("*", { count: "exact", head: true })
    .eq("canonical_user_id", userId)
    .in("payment_provider", ["balance", "balance_payment"])
    .neq("tx_id", expectedHash);

  console.log(`  Total: ${total || 0}`);
  console.log(`  ✅ With correct topup hash: ${correct || 0}`);
  console.log(`  ❌ Balance payments with wrong hash: ${balanceWrong || 0}`);
  console.log();
}
