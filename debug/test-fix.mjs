import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg";

const supabase = createClient(supabaseUrl, supabaseKey);

console.log("Testing get_unavailable_tickets fix...\n");

// Test the current broken function first
console.log("1. Testing BROKEN function (should fail with stack depth error):");
try {
  const { data, error } = await supabase.rpc("get_unavailable_tickets", {
    competition_id: "799a8e12-38f2-4989-ad24-15c995d673a6",
  });

  if (error) {
    console.error("❌ Expected error:", error.code, error.message);
  } else {
    console.log("✓ Unexpected success:", data);
  }
} catch (err) {
  console.error("❌ Exception:", err.message);
}

console.log(
  "\n2. Would you like to apply the fix? (This will run the SQL from SIMPLEST_FIX.sql)",
);
console.log("\nTo apply the fix:");
console.log(
  "  1. Open Supabase Dashboard (https://mthwfldcjvpxjtmrqkqm.supabase.co)",
);
console.log("  2. Go to SQL Editor");
console.log("  3. Copy the contents of supabase/SIMPLEST_FIX.sql");
console.log("  4. Paste and run");
console.log("\nOR use the Supabase CLI:");
console.log(
  "  npx supabase db execute -f supabase/SIMPLEST_FIX.sql --project-ref mthwfldcjvpxjtmrqkqm",
);
