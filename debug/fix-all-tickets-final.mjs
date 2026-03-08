import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

// Correct hashes for each user
const USER_HASHES = {
  "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363":
    "0xac1dfe66d18919a0434793ee74e15e831babec126afedaa25df2d49d101fd901",
  "prize:pid:0x543e8fb59312a2578f70152c79eae169e4f8fe9e":
    "0x271a504c9639c98e520bdd181a03370609313993e830d4f547ae1a68c61b768b",
  "prize:pid:0xe1a2e7487ddb3d82b150b47b8c6e9e5e03e0caf6":
    "0x95e380db63e9f3e20b2bca6e421c6aaba3c57d87418d95ee14903d129d49c1eb",
};

console.log("🔧 Fixing ALL tickets for each user (no date filter)...\n");

for (const [userId, correctHash] of Object.entries(USER_HASHES)) {
  console.log(`User: ${userId.substring(0, 40)}...`);
  console.log(`Correct hash: ${correctHash.substring(0, 20)}...`);

  // Count total tickets
  const { count } = await supabase
    .from("tickets")
    .select("*", { count: "exact", head: true })
    .eq("canonical_user_id", userId);

  console.log(`Total tickets: ${count || 0}`);

  if (!count || count === 0) {
    console.log("  Skipping - no tickets\n");
    continue;
  }

  // Update ALL tickets for this user to their correct hash
  // Do in batches to avoid timeout
  let updated = 0;
  let offset = 0;
  const batchSize = 500;

  while (offset < count) {
    // Get batch of ticket IDs
    const { data: batch } = await supabase
      .from("tickets")
      .select("id")
      .eq("canonical_user_id", userId)
      .range(offset, offset + batchSize - 1);

    if (!batch || batch.length === 0) break;

    const ids = batch.map((t) => t.id);

    // Update this batch
    const { error } = await supabase
      .from("tickets")
      .update({ tx_id: correctHash })
      .in("id", ids);

    if (error) {
      console.log(`  ❌ Error: ${error.message}`);
      break;
    }

    updated += batch.length;
    process.stdout.write(`  Updated ${updated}/${count}...\r`);
    offset += batchSize;
  }

  console.log(`  ✅ Updated ${updated} tickets\n`);
}

console.log("🎉 ALL DONE!");
