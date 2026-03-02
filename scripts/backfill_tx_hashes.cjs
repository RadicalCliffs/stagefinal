require("dotenv/config");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY",
);

async function backfillTxHashes() {
  console.log("=== BACKFILL MISSING TRANSACTION HASHES ===\n");

  // 1. Check current status
  console.log("1. Current status of joincompetition transactionhash:");
  const { data: preStats } = await supabase
    .from("joincompetition")
    .select("transactionhash", { count: "exact", head: false });

  const total = preStats?.length || 0;
  const missing =
    preStats?.filter((r) => !r.transactionhash || r.transactionhash === "")
      .length || 0;
  const balancePayment =
    preStats?.filter((r) => r.transactionhash?.startsWith("balance_payment_"))
      .length || 0;
  const blockchain =
    preStats?.filter((r) => r.transactionhash?.startsWith("0x")).length || 0;

  console.log(`   Total entries: ${total}`);
  console.log(`   Missing tx hash: ${missing}`);
  console.log(`   Balance payment: ${balancePayment}`);
  console.log(`   Blockchain (0x): ${blockchain}`);

  if (missing === 0) {
    console.log("\n✅ No entries with missing transaction hashes!");
    return;
  }

  // 2. Get entries that need backfill
  console.log(`\n2. Fetching ${missing} entries to backfill...`);
  const { data: toBackfill, error: fetchError } = await supabase
    .from("joincompetition")
    .select("id, uid, transactionhash")
    .or("transactionhash.is.null,transactionhash.eq.");

  if (fetchError) {
    console.error("   Error fetching:", fetchError);
    return;
  }

  console.log(`   Found ${toBackfill?.length || 0} entries to update`);

  // 3. Update each entry
  let updated = 0;
  let errors = 0;

  for (const entry of toBackfill || []) {
    const newTxHash = `balance_payment_${entry.uid || entry.id}`;

    const { error: updateError } = await supabase
      .from("joincompetition")
      .update({
        transactionhash: newTxHash,
        updated_at: new Date().toISOString(),
      })
      .eq("id", entry.id);

    if (updateError) {
      console.error(`   ❌ Failed to update ${entry.id}:`, updateError.message);
      errors++;
    } else {
      updated++;
    }
  }

  console.log(`\n3. Backfill complete:`);
  console.log(`   ✅ Updated: ${updated}`);
  console.log(`   ❌ Errors: ${errors}`);

  // 4. Verify
  console.log("\n4. Post-backfill status:");
  const { data: postStats } = await supabase
    .from("joincompetition")
    .select("transactionhash", { count: "exact", head: false });

  const postMissing =
    postStats?.filter((r) => !r.transactionhash || r.transactionhash === "")
      .length || 0;
  const postBalancePayment =
    postStats?.filter((r) => r.transactionhash?.startsWith("balance_payment_"))
      .length || 0;

  console.log(`   Still missing: ${postMissing}`);
  console.log(`   Balance payment entries: ${postBalancePayment}`);
}

backfillTxHashes().catch(console.error);
