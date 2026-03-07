import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "sb_publishable_w8xd4Fu4rqp0fnPpKPoR0Q_W9ykSBrx",
);

console.log("=== Dashboard Entries Diagnosis ===\n");
console.log("Checking stage.theprize.io/dashboard/entries for $0 amounts issue");
console.log("=".repeat(80));

// You'll need to provide your user identifier - common patterns:
// Format: prize:pid:0x<your_wallet>
// Or just: 0x<your_wallet>
const USER_IDENTIFIER = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363"; // Replace with your actual user ID

console.log(`\nStep 1: Checking entries via get_user_competition_entries RPC`);
console.log("-".repeat(80));

const { data: entries, error: entriesError } = await supabase.rpc(
  "get_user_competition_entries",
  { p_user_identifier: USER_IDENTIFIER }
);

if (entriesError) {
  console.log("❌ Error fetching entries:", entriesError.message);
  console.log("Full error:", JSON.stringify(entriesError, null, 2));
} else {
  console.log(`✅ Found ${entries?.length || 0} entries\n`);
  
  if (entries && entries.length > 0) {
    entries.forEach((entry, index) => {
      console.log(`Entry ${index + 1}:`);
      console.log(`  Competition ID: ${entry.competition_id}`);
      console.log(`  Title: ${entry.competition_title}`);
      console.log(`  Tickets Count: ${entry.tickets_count}`);
      console.log(`  Amount Spent: ${entry.amount_spent}`);
      console.log(`  Amount Paid: ${entry.amount_paid}`);
      console.log(`  Individual Purchases: ${entry.individual_purchases ? JSON.stringify(entry.individual_purchases).substring(0, 100) : 'null'}...`);
      console.log(`  Status: ${entry.entry_status}`);
      console.log(`  Created: ${entry.created_at}`);
      
      // Check for $0 amounts
      if (entry.amount_spent === 0 || entry.amount_spent === "0.00" || entry.amount_spent === null) {
        console.log(`  ⚠️  WARNING: Amount spent is $0 or null!`);
        
        if (entry.individual_purchases && Array.isArray(entry.individual_purchases)) {
          console.log(`  Individual purchases breakdown:`);
          entry.individual_purchases.forEach((purchase, pIdx) => {
            console.log(`    Purchase ${pIdx + 1}:`);
            console.log(`      Amount: ${purchase.amount_spent || purchase.amount_paid || 'N/A'}`);
            console.log(`      Tickets: ${purchase.tickets_count}`);
            console.log(`      Ticket Numbers: ${purchase.ticket_numbers}`);
          });
        }
      }
      
      console.log();
    });
  }
}

console.log("\nStep 2: Checking competition_entries table directly");
console.log("-".repeat(80));

const { data: ceEntries, error: ceError } = await supabase
  .from("competition_entries")
  .select("*")
  .eq("canonical_user_id", USER_IDENTIFIER)
  .order("created_at", { ascending: false })
  .limit(10);

if (ceError) {
  console.log("❌ Error:", ceError.message);
} else {
  console.log(`✅ Found ${ceEntries?.length || 0} entries in competition_entries\n`);
  
  if (ceEntries && ceEntries.length > 0) {
    ceEntries.forEach((entry, index) => {
      console.log(`Entry ${index + 1}:`);
      console.log(`  Competition ID: ${entry.competition_id}`);
      console.log(`  Tickets Count: ${entry.tickets_count}`);
      console.log(`  Amount Spent: ${entry.amount_spent}`);
      console.log(`  Ticket Numbers CSV: ${entry.ticket_numbers_csv ? entry.ticket_numbers_csv.substring(0, 50) : 'null'}...`);
      console.log(`  Created: ${entry.created_at}`);
      
      if (entry.amount_spent === 0 || entry.amount_spent === null) {
        console.log(`  ⚠️  WARNING: Amount spent is $0 or null!`);
      }
      
      console.log();
    });
  }
}

console.log("\nStep 3: Check if RPC function includes amount_spent in SELECT");
console.log("-".repeat(80));

const { data: funcInfo, error: funcError } = await supabase
  .rpc('_get_current_function_definition', { 
    function_name: 'get_user_competition_entries' 
  })
  .single();

if (funcError) {
  console.log("❌ Could not fetch function definition:", funcError.message);
  console.log("   (This RPC might not exist, which is okay)");
} else if (funcInfo) {
  const definition = funcInfo.definition || funcInfo.prosrc || '';
  if (definition.includes('amount_spent')) {
    console.log("✅ Function definition includes 'amount_spent'");
  } else {
    console.log("❌ Function definition does NOT include 'amount_spent'");
    console.log("   This is likely the root cause!");
  }
}

console.log("\n" + "=".repeat(80));
console.log("DIAGNOSIS COMPLETE");
console.log("=".repeat(80));
console.log("\nIf you see $0 amounts above, the issue is either:");
console.log("1. competition_entries.amount_spent field is not populated correctly");
console.log("2. get_user_competition_entries RPC is not returning amount_spent");
console.log("3. Individual purchases don't have amount_spent populated");
