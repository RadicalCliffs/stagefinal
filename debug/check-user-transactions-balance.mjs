import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg",
);

const txId = "36d6366e-da18-44bf-b150-c89340b66ad3";

const { data: tx } = await supabase
  .from("user_transactions")
  .select("*")
  .eq("id", txId)
  .single();

console.log("USER_TRANSACTIONS has these columns:");
console.log(`  balance_before: ${tx.balance_before}`);
console.log(`  balance_after: ${tx.balance_after}`);
console.log(`  completed_at: ${tx.completed_at}`);
console.log(`  posted_to_balance: ${tx.posted_to_balance}`);

console.log(
  "\nSo the dashboard is showing balance data FROM user_transactions table itself,",
);
console.log("NOT from balance_ledger!");
console.log(
  "\nThe RPC should be JOINing with balance_ledger, but if balance_ledger is empty,",
);
console.log("it falls back to user_transactions.balance_before/balance_after");
