import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

// Based on what we found - MANUAL MAPPING for the 3 key users
// This is the PRODUCTION FIX - each user gets mapped to THEIR topup hashes by time
const USER_TOPUP_MAPPINGS = {
  "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363": [
    {
      before: "2026-02-22T00:00:00",
      hash: "0xac1dfe66d18919a0434793ee74e15e831babec126afedaa25df2d49d101fd901",
    },
    {
      before: "2026-03-08T23:59:59",
      hash: "0x95e380db63e9f3e20b2bca6e421c6aaba3c57d87418d95ee14903d129d49c1eb",
    },
  ],
  "prize:pid:0x543e8fb59312a2578f70152c79eae169e4f8fe9e": [
    {
      before: "2026-02-22T00:00:00",
      hash: "0xfcad0077ce00331021d7fd0fe0b55de69e33c6cd4c98e0fc5af06f52ccd4de41",
    },
    {
      before: "2026-02-23T00:00:00",
      hash: "0x271a504c9639c98e520bdd181a03370609313993e830d4f547ae1a68c61b768b",
    },
    {
      before: "2026-03-05T00:00:00",
      hash: "0x8d1e77439568bc8843d22d9a2c0e97dd92dd49baa3f89cbc2a88fba4f3b8d3f6",
    },
    {
      before: "2026-03-08T23:59:59",
      hash: "0xaadebf880a647478484a63ab05226787f8ec6eafc627daf897b17e4b3c2aebfb",
    },
  ],
  "prize:pid:0xe1a2e7487ddb3d82b19229dcb7f27a4ea3a032e87d9eb5": [
    {
      before: "2026-02-22T00:00:00",
      hash: "0x3623ad7c78fc3a91a525cdd63c5df30e97d37f751e2cda8e59e3b7098be3a3f5",
    },
    {
      before: "2026-02-24T00:00:00",
      hash: "0xc47c365fc185655b51dc1bc7aa2ceb2cc2bb1c7e448a22a83d2d66f24dc31d9b",
    },
    {
      before: "2026-03-08T23:59:59",
      hash: "0x95e380db63e9f3e20b2bca6e421c6aaba3c57d87418d95ee14903d129d49c1eb",
    },
  ],
};

async function applyUserHashMappings() {
  console.log("🔧 Applying MANUAL topup hash mappings for key users...\n");

  for (const [userId, mappings] of Object.entries(USER_TOPUP_MAPPINGS)) {
    console.log(`\n👤 User: ${userId.substring(0, 40)}...`);
    console.log(
      `   ${mappings.length} time periods with different topup hashes`,
    );

    for (let i = 0; i < mappings.length; i++) {
      const mapping = mappings[i];
      const prevTime = i > 0 ? mappings[i - 1].before : "2026-02-20T00:00:00";

      console.log(`\n   📅 Tickets from ${prevTime} to ${mapping.before}`);
      console.log(`   🔗 Hash: ${mapping.hash.substring(0, 30)}...`);

      // Get tickets in this time range
      const { data: tickets } = await supabase
        .from("tickets")
        .select("ticket_number, created_at, tx_id")
        .eq("canonical_user_id", userId)
        .gte("created_at", prevTime)
        .lt("created_at", mapping.before);

      if (!tickets || tickets.length === 0) {
        console.log(`   ⚠️ No tickets found in this range`);
        continue;
      }

      console.log(`   📋 Found ${tickets.length} tickets`);

      // Update in batches
      const ticketNumbers = tickets.map((t) => t.ticket_number);
      const batchSize = 100;
      let updated = 0;

      for (let j = 0; j < ticketNumbers.length; j += batchSize) {
        const batch = ticketNumbers.slice(j, j + batchSize);

        const { error } = await supabase
          .from("tickets")
          .update({ tx_id: mapping.hash })
          .in("ticket_number", batch);

        if (!error) {
          updated += batch.length;
        }
      }

      console.log(`   ✅ Updated ${updated} tickets`);
    }
  }

  console.log(
    "\n\n✅ DONE! All key users now have their correct topup hashes by time period",
  );
}

applyUserHashMappings().catch(console.error);
