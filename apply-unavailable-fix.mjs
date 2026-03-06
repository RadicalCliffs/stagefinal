// Apply the unavailable tickets fix
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  // Using service role key for admin operations
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczNTkxOTU3NCwiZXhwIjoyMDUxNDk1NTc0fQ.JfncYvQICTb7RjBP24LBiGFKHKMZPfFMZ4aXHX8xbYQ",
);

console.log("🔧 Applying get_unavailable_tickets fix...\n");

const sql = readFileSync("FIX_UNAVAILABLE_TICKETS_NOW.sql", "utf8");

// Split into individual statements and execute
const statements = sql
  .split(/;\s*$/gm)
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !s.startsWith("--"));

console.log(`Found ${statements.length} SQL statements to execute\n`);

for (let i = 0; i < statements.length; i++) {
  const stmt = statements[i] + ";";

  // Skip comment-only statements
  if (stmt.trim().startsWith("--")) continue;

  console.log(`Executing statement ${i + 1}/${statements.length}...`);

  try {
    const { data, error } = await supabase.rpc("exec_sql", { query: stmt });

    if (error) {
      console.error(`❌ Error:`, error.message);
      if (error.details) console.error(`   Details:`, error.details);
      if (error.hint) console.error(`   Hint:`, error.hint);
    } else {
      console.log(`✅ Success`);
      if (data) console.log(`   Result:`, data);
    }
  } catch (e) {
    console.error(`❌ Exception:`, e.message);
  }

  console.log("");
}

console.log("\n📊 Testing the fix...\n");

// Test with Win 25 SOL competition
const compId = "a879ba68-d098-42f6-a687-f70fd7109ee8";

try {
  const { data: unavailable, error } = await supabase.rpc(
    "get_unavailable_tickets",
    {
      competition_id: compId,
    },
  );

  if (error) {
    console.error("❌ RPC test failed:", error.message);
  } else {
    console.log(`✅ RPC test successful!`);
    console.log(`   Unavailable tickets: ${unavailable?.length || 0}`);

    // Compare with actual tickets in database
    const { data: tickets } = await supabase
      .from("tickets")
      .select("ticket_number")
      .eq("competition_id", compId);

    console.log(`   Tickets in database: ${tickets?.length || 0}`);

    if (tickets?.length === unavailable?.length) {
      console.log("\n🎉 SUCCESS: All tickets showing as unavailable!");
      console.log("   Other users will now see these tickets as unavailable.");
    } else {
      console.log(`\n⚠️  Warning: Mismatch detected`);
      console.log(
        `   Expected: ${tickets?.length}, Got: ${unavailable?.length}`,
      );
    }
  }
} catch (e) {
  console.error("❌ Test exception:", e.message);
}
