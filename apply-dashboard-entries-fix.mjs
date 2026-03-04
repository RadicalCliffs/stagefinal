import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// STAGE database credentials
const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "sb_publishable_w8xd4Fu4rqp0fnPpKPoR0Q_W9ykSBrx",
);

console.log("=== Applying Dashboard Entries Amount Fix ===\n");

// Read the SQL file
const sqlFile = join(__dirname, "supabase", "FIX_DASHBOARD_ENTRIES_AMOUNT_ISSUE.sql");
console.log(`Reading SQL file: ${sqlFile}\n`);

let sqlContent;
try {
  sqlContent = readFileSync(sqlFile, "utf-8");
  console.log(`✅ SQL file loaded (${sqlContent.length} characters)\n`);
} catch (error) {
  console.error("❌ Failed to read SQL file:", error.message);
  process.exit(1);
}

console.log("Applying fix to staging database...\n");
console.log("This will:");
console.log("1. Fix get_user_competition_entries RPC function (add amount_spent field)");
console.log("2. Backfill amount_spent in competition_entries table");
console.log("3. Fix tickets.purchase_price for NULL/0 values\n");

// Execute the SQL
const { data, error } = await supabase.rpc("exec_sql", { sql: sqlContent });

if (error) {
  console.error("❌ Error applying fix:", error.message);
  console.error("Full error:", JSON.stringify(error, null, 2));
  
  // Try alternative approach: execute via direct query
  console.log("\n⚠️  Trying alternative method...\n");
  
  // Split into individual statements and execute
  const statements = sqlContent
    .split(";")
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith("--"));
  
  let successCount = 0;
  let failCount = 0;
  
  for (const statement of statements) {
    if (statement.toLowerCase().includes("do $$") || statement.toLowerCase().includes("begin")) {
      // Skip DO blocks for now, they need special handling
      continue;
    }
    
    const { error: stmtError } = await supabase.rpc("exec_sql", { sql: statement + ";" });
    if (stmtError) {
      console.error(`❌ Failed: ${statement.substring(0, 50)}...`);
      failCount++;
    } else {
      successCount++;
    }
  }
  
  console.log(`\nExecuted ${successCount} statements successfully, ${failCount} failed`);
} else {
  console.log("✅ Fix applied successfully!\n");
  if (data) {
    console.log("Result:", data);
  }
}

// Verify the fix
console.log("\n" + "=".repeat(80));
console.log("VERIFYING FIX");
console.log("=".repeat(80) + "\n");

const USER_IDENTIFIER = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

console.log("Step 1: Test get_user_competition_entries RPC");
const { data: entries, error: entriesError } = await supabase.rpc(
  "get_user_competition_entries",
  { p_user_identifier: USER_IDENTIFIER }
);

if (entriesError) {
  console.log("❌ RPC still has errors:", entriesError.message);
} else {
  console.log(`✅ RPC works! Found ${entries?.length || 0} entries\n`);
  
  if (entries && entries.length > 0) {
    const entriesWithZero = entries.filter(e => 
      e.amount_spent === 0 || e.amount_spent === "0.00" || e.amount_spent === null
    );
    
    if (entriesWithZero.length > 0) {
      console.log(`⚠️  WARNING: ${entriesWithZero.length} entries still show $0`);
      entriesWithZero.forEach(e => {
        console.log(`   - ${e.competition_title}: ${e.tickets_count} tickets, $${e.amount_spent}`);
      });
    } else {
      console.log("✅ All entries have non-zero amounts!");
    }
    
    console.log("\nSample entry:");
    const sample = entries[0];
    console.log(`  Title: ${sample.competition_title}`);
    console.log(`  Tickets: ${sample.tickets_count}`);
    console.log(`  Amount Spent: $${sample.amount_spent}`);
    console.log(`  Has individual_purchases: ${sample.individual_purchases ? 'Yes' : 'No'}`);
  }
}

console.log("\nStep 2: Check competition_entries table");
const { data: ceEntries, error: ceError } = await supabase
  .from("competition_entries")
  .select("id, competition_id, tickets_count, amount_spent")
  .eq("canonical_user_id", USER_IDENTIFIER)
  .order("created_at", { ascending: false })
  .limit(5);

if (ceError) {
  console.log("❌ Error:", ceError.message);
} else {
  console.log(`✅ Found ${ceEntries?.length || 0} entries in competition_entries\n`);
  
  if (ceEntries && ceEntries.length > 0) {
    const withZero = ceEntries.filter(e => e.amount_spent === 0 || e.amount_spent === null);
    
    if (withZero.length > 0) {
      console.log(`⚠️  ${withZero.length} entries still have $0 amount_spent`);
    } else {
      console.log("✅ All entries have non-zero amount_spent!");
    }
    
    ceEntries.forEach((entry, i) => {
      console.log(`  Entry ${i + 1}: ${entry.tickets_count} tickets, $${entry.amount_spent}`);
    });
  }
}

console.log("\n" + "=".repeat(80));
console.log("FIX APPLICATION COMPLETE");
console.log("=".repeat(80));
console.log("\nPlease test at: https://stage.theprize.io/dashboard/entries");
