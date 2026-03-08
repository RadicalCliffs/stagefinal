import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

async function debugUserTopups() {
  const testUsers = [
    "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363",
    "prize:pid:0x543e8fb59312a2578f70152c79eae169e4f8fe9e",
  ];

  for (const userId of testUsers) {
    console.log(`\n👤 ${userId.substring(0, 50)}...`);

    const { data: topups } = await supabase
      .from("user_transactions")
      .select("tx_id, created_at, amount")
      .eq("canonical_user_id", userId)
      .eq("type", "topup")
      .gte("created_at", "2026-02-15")
      .lte("created_at", "2026-03-09")
      .order("created_at", { ascending: false })
      .limit(3);

    console.log(`Topups:`);
    topups?.forEach((t) => {
      console.log(
        `  ${t.created_at}: $${t.amount}, tx_id: ${t.tx_id || "NULL"}`,
      );
    });

    // Check if any webhooks exist at all for these dates
    if (topups && topups[0]) {
      const topupDate = new Date(topups[0].created_at);
      const startDate = new Date(topupDate.getTime() - 2 * 24 * 60 * 60 * 1000);
      const endDate = new Date(topupDate.getTime() + 2 * 24 * 60 * 60 * 1000);

      const { count } = await supabase
        .from("payment_webhook_events")
        .select("*", { count: "exact", head: true })
        .gte("created_at", startDate.toISOString())
        .lte("created_at", endDate.toISOString());

      console.log(`  Webhooks in date range: ${count}`);
    }
  }
}

debugUserTopups().catch(console.error);
