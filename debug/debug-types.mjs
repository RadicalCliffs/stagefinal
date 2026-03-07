import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "sb_publishable_w8xd4Fu4rqp0fnPpKPoR0Q_W9ykSBrx",
);

console.log("=== Checking joincompetition.competitionid type ===\n");

const { data, error } = await supabase
  .from("joincompetition")
  .select("competitionid")
  .limit(1);

if (error) {
  console.error("Error:", error.message);
} else {
  console.log("Sample competitionid:", data?.[0]?.competitionid);
  console.log("JS typeof:", typeof data?.[0]?.competitionid);
}

// Check which tables exist
console.log("\n=== Checking what the error actually is ===");

const { data: d2, error: e2 } = await supabase.rpc("get_unavailable_tickets", {
  p_competition_id: "799a8e12-38f2-4989-ad24-15c995d673a6",
});

if (e2) {
  console.log("\nFull error object:");
  console.log(JSON.stringify(e2, null, 2));
}

process.exit(0);
