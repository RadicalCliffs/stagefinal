import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY";
const supabase = createClient(supabaseUrl, supabaseKey);

const userId = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

async function fixAllAmounts() {
  console.log("🔍 Finding canonical_user_id...");

  const { data: user } = await supabase
    .from("canonical_users")
    .select("canonical_user_id, wallet_address")
    .ilike("wallet_address", "%0ff51ec0ecc9ae1e5e6048976ba307c849781363%")
    .single();

  if (!user) {
    console.error("❌ User not found");
    return;
  }

  console.log(`✅ Found user: ${user.canonical_user_id}`);

  // Get ALL entries for this user
  const { data: entries } = await supabase
    .from("competition_entries")
    .select(
      `
      id,
      competition_id,
      canonical_user_id,
      tickets_count,
      amount_spent,
      competitions (
        title,
        ticket_price
      )
    `,
    )
    .eq("canonical_user_id", user.canonical_user_id);

  console.log(`\n📊 Found ${entries.length} competition entries\n`);

  for (const entry of entries) {
    // Count actual tickets from tickets table
    const { data: tickets } = await supabase
      .from("tickets")
      .select("id, purchase_price, ticket_number")
      .eq("competition_id", entry.competition_id)
      .eq("canonical_user_id", user.canonical_user_id);

    const actualCount = tickets.length;
    const ticketPrice = entry.competitions.ticket_price;
    const actualAmount = tickets.reduce(
      (sum, t) => sum + (t.purchase_price || ticketPrice || 0),
      0,
    );

    const countMismatch = actualCount !== entry.tickets_count;
    const amountMismatch =
      Math.abs(actualAmount - (entry.amount_spent || 0)) > 0.01;

    if (countMismatch || amountMismatch) {
      console.log(`❌ MISMATCH: ${entry.competitions.title}`);
      console.log(
        `   DB says: ${entry.tickets_count} tickets, $${entry.amount_spent}`,
      );
      console.log(
        `   Reality: ${actualCount} tickets, $${actualAmount.toFixed(2)}`,
      );
      console.log(
        `   Ticket numbers: ${tickets
          .map((t) => t.ticket_number)
          .sort((a, b) => a - b)
          .join(", ")}`,
      );

      // FIX IT
      const { error } = await supabase
        .from("competition_entries")
        .update({
          tickets_count: actualCount,
          amount_spent: actualAmount,
        })
        .eq("id", entry.id);

      if (error) {
        console.log(`   ❌ Update failed: ${error.message}`);
      } else {
        console.log(
          `   ✅ FIXED to ${actualCount} tickets, $${actualAmount.toFixed(2)}\n`,
        );
      }
    } else {
      console.log(
        `✅ OK: ${entry.competitions.title} - ${actualCount} tickets, $${actualAmount.toFixed(2)}`,
      );
    }
  }

  console.log("\n✅ All amounts fixed!");
}

fixAllAmounts().catch(console.error);
