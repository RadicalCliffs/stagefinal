import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

// Hardcode the hashes for the 3 main users based on what we found
const USER_HASHES = {
  "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363":
    "0xac1dfe66d18919a0434793ee74e15e831babec126afedaa25df2d49d101fd901",
  "prize:pid:0x543e8fb59312a2578f70152c79eae169e4f8fe9e":
    "0x271a504c9639c98e520bdd181a03370609313993e830d4f547ae1a68c61b768b",
  "prize:pid:0xe1a2e7487ddb3d82b150b47b8c6e9e5e03e0caf6":
    "0x95e380db63e9f3e20b2bca6e421c6aaba3c57d87418d95ee14903d129d49c1eb",
};

async function populateUserHashes() {
  console.log("💾 Populating user topup hashes...\n");

  for (const [userId, hash] of Object.entries(USER_HASHES)) {
    console.log(`User: ${userId.substring(0, 30)}...`);
    console.log(`Hash: ${hash.substring(0, 20)}...`);

    // Upsert into canonical_users
    const { error } = await supabase.from("canonical_users").upsert(
      {
        canonical_user_id: userId,
        last_topup_tx_hash: hash,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "canonical_user_id",
      },
    );

    if (error) {
      console.log(`❌ Error:`, error.message);
    } else {
      console.log(`✅ Updated\n`);
    }
  }

  console.log("\n✅ Done! Now update all their tickets...\n");

  // Update all tickets for these users
  for (const [userId, hash] of Object.entries(USER_HASHES)) {
    console.log(`Updating tickets for ${userId.substring(0, 30)}...`);

    const { data: tickets } = await supabase
      .from("tickets")
      .select("ticket_number")
      .eq("canonical_user_id", userId)
      .gte("created_at", "2026-02-20")
      .lte("created_at", "2026-03-08");

    if (!tickets || tickets.length === 0) {
      console.log("  No tickets found\n");
      continue;
    }

    console.log(`  Found ${tickets.length} tickets`);

    // Update in batches
    const batchSize = 100;
    let updated = 0;

    for (let i = 0; i < tickets.length; i += batchSize) {
      const batch = tickets.slice(i, i + batchSize);
      const ticketNumbers = batch.map((t) => t.ticket_number);

      const { error } = await supabase
        .from("tickets")
        .update({ tx_id: hash })
        .eq("canonical_user_id", userId)
        .in("ticket_number", ticketNumbers);

      if (!error) {
        updated += batch.length;
      }
    }

    console.log(`  ✅ Updated ${updated} tickets\n`);
  }

  console.log("🎉 ALL DONE!");
}

populateUserHashes().catch(console.error);
