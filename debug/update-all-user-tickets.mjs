import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

async function updateAllUserTickets() {
  console.log(
    "🔧 Updating ALL tickets with fake hashes to their topup blockchain hashes...\n",
  );

  // User 1 - already found the hash
  const user1 = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";
  const user1Hash =
    "0x7542cd73a56e95732724291fb336549231fc596f47531fec67b746abe8d76854";

  // User 2 - already found the hash
  const user2 = "prize:pid:0x543e8fb59312a2578f70152c79eae169e4f8fe9e";
  const user2Hash =
    "0x271a504c9639c98e520bdd181a03370609313993e830d4f547ae1a68c61b768b";

  console.log(`👤 User 1: Updating to ${user1Hash.substring(0, 20)}...`);

  // Get all March 4 tickets with fake hashes for user 1
  const { data: user1Tickets } = await supabase
    .from("tickets")
    .select("ticket_number, tx_id")
    .eq("canonical_user_id", user1)
    .gte("created_at", "2026-03-04T00:00:00")
    .lte("created_at", "2026-03-04T23:59:59");

  if (user1Tickets) {
    const fakeHashTickets = user1Tickets.filter(
      (t) =>
        t.tx_id?.startsWith("0x") &&
        t.tx_id.length === 66 &&
        t.tx_id !== user1Hash,
    );

    if (fakeHashTickets.length > 0) {
      console.log(`   Found ${fakeHashTickets.length} tickets to update`);

      const ticketNumbers = fakeHashTickets.map((t) => t.ticket_number);
      const batchSize = 100;
      let updated = 0;

      for (let i = 0; i < ticketNumbers.length; i += batchSize) {
        const batch = ticketNumbers.slice(i, i + batchSize);

        const { error } = await supabase
          .from("tickets")
          .update({ tx_id: user1Hash })
          .in("ticket_number", batch);

        if (error) {
          console.log(
            `   ❌ Batch ${Math.floor(i / batchSize) + 1} error:`,
            error.message,
          );
        } else {
          updated += batch.length;
          if (updated % 500 === 0 || updated === ticketNumbers.length) {
            console.log(
              `   ✅ Updated ${updated} / ${ticketNumbers.length} tickets...`,
            );
          }
        }
      }

      console.log(`   ✅ Done! Updated ${updated} tickets total`);
    } else {
      console.log(`   ✅ All tickets already have correct hash`);
    }
  }

  console.log(`\n👤 User 2: Updating to ${user2Hash.substring(0, 20)}...`);

  // Get all March 4 tickets with fake hashes for user 2
  const { data: user2Tickets } = await supabase
    .from("tickets")
    .select("ticket_number, tx_id")
    .eq("canonical_user_id", user2)
    .gte("created_at", "2026-03-04T00:00:00")
    .lte("created_at", "2026-03-04T23:59:59");

  if (user2Tickets) {
    const fakeHashTickets = user2Tickets.filter(
      (t) =>
        t.tx_id?.startsWith("0x") &&
        t.tx_id.length === 66 &&
        t.tx_id !== user2Hash,
    );

    if (fakeHashTickets.length > 0) {
      console.log(`   Found ${fakeHashTickets.length} tickets to update`);

      const ticketNumbers = fakeHashTickets.map((t) => t.ticket_number);
      const batchSize = 100;
      let updated = 0;

      for (let i = 0; i < ticketNumbers.length; i += batchSize) {
        const batch = ticketNumbers.slice(i, i + batchSize);

        const { error } = await supabase
          .from("tickets")
          .update({ tx_id: user2Hash })
          .in("ticket_number", batch);

        if (error) {
          console.log(
            `   ❌ Batch ${Math.floor(i / batchSize) + 1} error:`,
            error.message,
          );
        } else {
          updated += batch.length;
          console.log(
            `   ✅ Updated ${updated} / ${ticketNumbers.length} tickets`,
          );
        }
      }
    } else {
      console.log(`   ✅ All tickets already have correct hash`);
    }
  }

  console.log("\n✅ Done!");
}

updateAllUserTickets().catch(console.error);
