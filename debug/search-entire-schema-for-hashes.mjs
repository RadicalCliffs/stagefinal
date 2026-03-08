import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

// The 3 main users we need to fix
const KEY_USERS = [
  "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363",
  "prize:pid:0x543e8fb59312a2578f70152c79eae169e4f8fe9e",
  "prize:pid:0xe1a2e7487ddb3d82b1603a7297a3a032e87d9eb5",
];

async function searchEverywhereForHashes() {
  console.log(
    "🔍 Searching ENTIRE schema for blockchain hashes for key users...\n",
  );

  for (const userId of KEY_USERS) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`👤 User: ${userId}`);
    console.log("=".repeat(80));

    // 1. Check user_transactions
    console.log("\n1️⃣ user_transactions:");
    const { data: transactions } = await supabase
      .from("user_transactions")
      .select("*")
      .eq("canonical_user_id", userId)
      .eq("type", "topup")
      .order("created_at", { ascending: false });

    console.log(`   Found ${transactions?.length || 0} topups`);
    transactions?.slice(0, 5).forEach((t) => {
      console.log(
        `   ${t.created_at}: tx_id=${t.tx_id?.substring(0, 30) || "NULL"}, provider=${t.payment_provider}`,
      );
    });

    // 2. Check payment_webhook_events by payer_address (extract wallet from user ID)
    const walletMatch = userId.match(/0x[a-fA-F0-9]+/);
    if (walletMatch) {
      console.log("\n2️⃣ payment_webhook_events (by payer_address):");
      const { data: webhooks } = await supabase
        .from("payment_webhook_events")
        .select(
          "id, event_type, payer_address, transaction_id, payload, created_at",
        )
        .ilike("payer_address", `%${walletMatch[0]}%`)
        .order("created_at", { ascending: false })
        .limit(10);

      console.log(`   Found ${webhooks?.length || 0} webhooks`);
      webhooks?.forEach((w) => {
        const hash =
          w.transaction_id ||
          w.payload?.payments?.[0]?.transaction_id ||
          w.payload?.event?.data?.payments?.[0]?.transaction_id;
        console.log(
          `   ${w.created_at}: ${w.event_type}, hash=${hash?.substring(0, 30) || "NOT FOUND"}`,
        );
      });
    }

    // 3. Check joincompetition (might have tx hashes)
    console.log("\n3️⃣ joincompetition:");
    const { data: entries } = await supabase
      .from("joincompetition")
      .select("transactionhash, purchasedate")
      .eq("userid", userId)
      .not("transactionhash", "is", null)
      .order("purchasedate", { ascending: false })
      .limit(10);

    console.log(`   Found ${entries?.length || 0} entries with hashes`);
    const uniqueHashes = [...new Set(entries?.map((e) => e.transactionhash))];
    uniqueHashes.slice(0, 5).forEach((h) => {
      console.log(`   ${h?.substring(0, 40)}...`);
    });

    // 4. Check balance_ledger
    console.log("\n4️⃣ balance_ledger:");
    const { data: ledger } = await supabase
      .from("balance_ledger")
      .select("*")
      .eq("canonical_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10);

    console.log(`   Found ${ledger?.length || 0} ledger entries`);
    ledger?.slice(0, 3).forEach((l) => {
      console.log(
        `   ${l.created_at}: ${l.transaction_type}, ref=${l.reference_id?.substring(0, 30) || "NULL"}`,
      );
    });

    // 5. Check orders table
    console.log("\n5️⃣ orders:");
    const { data: orders } = await supabase
      .from("orders")
      .select("*")
      .eq("canonical_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10);

    console.log(`   Found ${orders?.length || 0} orders`);
    orders?.slice(0, 3).forEach((o) => {
      console.log(
        `   ${o.created_at}: status=${o.status}, session=${o.session_id?.substring(0, 30)}`,
      );
    });

    // 6. Search payment_webhook_events payload JSONB for any mention
    console.log("\n6️⃣ payment_webhook_events (full payload search):");
    const { data: webhooksFull } = await supabase
      .from("payment_webhook_events")
      .select("id, event_type, payload, created_at")
      .gte("created_at", "2026-02-20")
      .lte("created_at", "2026-03-08")
      .limit(500);

    const matching = webhooksFull?.filter(
      (w) =>
        JSON.stringify(w.payload).includes(walletMatch[0]) ||
        transactions?.some(
          (t) => t.tx_id && JSON.stringify(w.payload).includes(t.tx_id),
        ),
    );

    console.log(
      `   Found ${matching?.length || 0} webhooks mentioning this user`,
    );
    matching?.slice(0, 3).forEach((w) => {
      const hash =
        w.payload?.payments?.[0]?.transaction_id ||
        w.payload?.event?.data?.payments?.[0]?.transaction_id ||
        w.payload?.data?.payments?.[0]?.transaction_id;
      console.log(
        `   ${w.created_at}: ${w.event_type}, hash=${hash?.substring(0, 30) || "CHECK PAYLOAD"}`,
      );
    });
  }

  console.log("\n\n" + "=".repeat(80));
  console.log("✅ Search complete. Review above for blockchain hashes.");
}

searchEverywhereForHashes().catch(console.error);
