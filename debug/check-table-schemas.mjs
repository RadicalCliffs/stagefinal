import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg",
);

console.log("=== CHECKING TABLE SCHEMAS ===\n");

// Check competition_winners columns
console.log("1. competition_winners table:\n");
const { data: compWinners, error: e1 } = await supabase
  .from("competition_winners")
  .select("*")
  .limit(1);

if (!e1 && compWinners && compWinners.length > 0) {
  console.log("Columns:", Object.keys(compWinners[0]).join(", "));
} else {
  console.log("Error or no data:", e1?.message || "No records");
}

// Check competitions columns for winner fields
console.log("\n2. competitions table (winner-related columns):\n");
const { data: comps, error: e2 } = await supabase
  .from("competitions")
  .select("*")
  .not("winner_address", "is", null)
  .limit(1);

if (!e2 && comps && comps.length > 0) {
  const winnerKeys = Object.keys(comps[0]).filter(
    (k) => k.includes("winner") || k.includes("drawn") || k.includes("vrf"),
  );
  console.log("Winner-related columns:", winnerKeys.join(", "));
} else {
  console.log("Error or no data:", e2?.message || "No winners yet");
}

console.log("\n=== DONE ===\n");
