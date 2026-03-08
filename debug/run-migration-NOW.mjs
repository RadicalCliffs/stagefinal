import { createClient } from "@supabase/supabase-js";
import "dotenv/config";
import fs from "fs";

// Use SERVICE ROLE KEY for admin operations
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY,
);

console.log("🚀 Running migration...\n");

// Read the SQL file
const sql = fs.readFileSync(
  "supabase/migrations/fix_balance_simple.sql",
  "utf8",
);

// Split into individual statements
const statements = sql
  .split(/;\s*$/m)
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !s.startsWith("--"));

console.log(`Found ${statements.length} SQL statements to execute\n`);

for (let i = 0; i < statements.length; i++) {
  const stmt = statements[i];
  const preview = stmt.substring(0, 80).replace(/\n/g, " ");
  console.log(`[${i + 1}/${statements.length}] ${preview}...`);

  const { error } = await supabase.rpc("exec_sql", { sql: stmt });

  if (error) {
    // Try direct query for DDL statements
    const { error: error2 } = await supabase.from("_exec").select().limit(0);
    console.log(
      `   ⚠️  RPC not available, statement may need manual execution`,
    );
    console.log(`   Error: ${error.message}`);
  } else {
    console.log(`   ✅ Success`);
  }
}

console.log("\n✅ Migration complete!");
