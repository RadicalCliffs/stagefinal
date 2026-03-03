import { readFileSync } from "fs";

const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg";

// Read the SQL fix file
const sqlFix = readFileSync("supabase/SIMPLEST_FIX.sql", "utf-8");

console.log("Applying fix to Supabase database...\n");
console.log("SQL Length:", sqlFix.length, "characters\n");

// Try to execute via direct SQL endpoint
const applyFix = async () => {
  try {
    // The Management API endpoint for executing SQL
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ query: sqlFix }),
    });

    const result = await response.text();

    if (!response.ok) {
      console.error("❌ Failed to apply fix:");
      console.error("Status:", response.status, response.statusText);
      console.error("Response:", result);
      console.log("\n\n=== MANUAL FIX REQUIRED ===");
      console.log(
        "1. Go to https://supabase.com/dashboard/project/mthwfldcjvpxjtmrqkqm/sql/new",
      );
      console.log("2. Copy the contents of supabase/SIMPLEST_FIX.sql");
      console.log('3. Paste and click "Run"');
      console.log("============================\n");
      return false;
    }

    console.log("✓ Fix applied successfully!");
    console.log("Response:", result);
    return true;
  } catch (error) {
    console.error("❌ Exception:", error.message);
    console.log("\n\n=== MANUAL FIX REQUIRED ===");
    console.log(
      "1. Go to https://supabase.com/dashboard/project/mthwfldcjvpxjtmrqkqm/sql/new",
    );
    console.log("2. Copy the contents of supabase/SIMPLEST_FIX.sql");
    console.log('3. Paste and click "Run"');
    console.log("============================\n");
    return false;
  }
};

const success = await applyFix();

if (success) {
  // Test the fix
  console.log("\n\nTesting the fixed function...");

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { data, error } = await supabase.rpc("get_unavailable_tickets", {
      competition_id: "799a8e12-38f2-4989-ad24-15c995d673a6",
    });

    if (error) {
      console.error("❌ Still getting error:", error.code, error.message);
    } else {
      console.log("✓✓✓ SUCCESS! Function is working!");
      console.log("Returned", data.length, "unavailable tickets");
    }
  } catch (err) {
    console.error("❌ Test failed:", err.message);
  }
}
