import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "sb_publishable_w8xd4Fu4rqp0fnPpKPoR0Q_W9ykSBrx",
);

console.log(
  "=== Checking Triggers and Functions for competition_entries ===\n",
);

// 1. Check for triggers on tickets table
console.log("Step 1: Check triggers on tickets table");
console.log("-".repeat(80));

const { data: ticketTriggers, error: ttError } = await supabase.rpc(
  "exec_sql",
  {
    sql: `
    SELECT 
      t.tgname AS trigger_name,
      p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS args,
      pg_get_functiondef(p.oid) AS function_def
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    LEFT JOIN pg_proc p ON t.tgfoid = p.oid
    WHERE n.nspname = 'public' 
      AND c.relname = 'tickets'
      AND NOT t.tgisinternal
    ORDER BY t.tgname;
  `,
  },
);

if (ttError) {
  console.log("❌ Error:", ttError.message);
} else if (ticketTriggers && ticketTriggers.length > 0) {
  console.log(`Found ${ticketTriggers.length} trigger(s) on tickets table:\n`);
  ticketTriggers.forEach((t) => {
    console.log(`  - ${t.trigger_name}`);
    console.log(`    Function: ${t.function_name}`);
    if (t.function_def && t.function_def.includes("competition_entries")) {
      console.log(`    ⚠️  This trigger modifies competition_entries!`);
      console.log(`    Definition (first 500 chars):`);
      console.log(`    ${t.function_def.substring(0, 500)}`);
    }
    console.log();
  });
} else {
  console.log("No triggers found on tickets table\n");
}

// 2. Check for functions that INSERT/UPDATE competition_entries
console.log("\nStep 2: Find functions that modify competition_entries");
console.log("-".repeat(80));

const { data: funcs, error: funcsError } = await supabase.rpc("exec_sql", {
  sql: `
    SELECT 
      p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS args,
      SUBSTRING(pg_get_functiondef(p.oid) FROM 1 FOR 1000) AS function_start
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND pg_get_functiondef(p.oid) ILIKE '%competition_entries%'
      AND (
        pg_get_functiondef(p.oid) ILIKE '%INSERT INTO%competition_entries%'
        OR pg_get_functiondef(p.oid) ILIKE '%UPDATE%competition_entries%'
      )
    ORDER BY p.proname;
  `,
});

if (funcsError) {
  console.log("❌ Error:", funcsError.message);
} else if (funcs && funcs.length > 0) {
  console.log(
    `Found ${funcs.length} function(s) that modify competition_entries:\n`,
  );
  funcs.forEach((f) => {
    console.log(`  - ${f.function_name}(${f.args || ""})`);
    if (f.function_start.includes("amount_spent")) {
      console.log(`    ✅ References amount_spent`);
    } else {
      console.log(`    ❌ Does NOT reference amount_spent!`);
    }
    console.log();
  });
} else {
  console.log("No functions found that modify competition_entries\n");
}

// 3. Check the most recent entry that shows $0
console.log("\nStep 3: Analyze the recent $0 entry");
console.log("-".repeat(80));

const USER_ID = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

// Get most recent entry
const { data: recentEntries, error: reError } = await supabase
  .from("competition_entries")
  .select(
    "id, competition_id, tickets_count, amount_spent, created_at, updated_at",
  )
  .eq("canonical_user_id", USER_ID)
  .order("created_at", { ascending: false })
  .limit(3);

if (reError) {
  console.log("❌ Error:", reError.message);
} else if (recentEntries && recentEntries.length > 0) {
  console.log(`Found ${recentEntries.length} recent entries:\n`);

  recentEntries.forEach((entry, i) => {
    console.log(`Entry ${i + 1}:`);
    console.log(`  ID: ${entry.id}`);
    console.log(`  Competition: ${entry.competition_id}`);
    console.log(`  Tickets: ${entry.tickets_count}`);
    console.log(`  Amount: $${entry.amount_spent}`);
    console.log(`  Created: ${entry.created_at}`);

    if (entry.amount_spent === 0 || entry.amount_spent === null) {
      console.log(`  ⚠️  ISSUE: This entry has $0!`);

      // Check if there are tickets for this entry
      supabase
        .from("tickets")
        .select("id, ticket_number, purchase_price")
        .eq("competition_id", entry.competition_id)
        .eq("canonical_user_id", USER_ID)
        .limit(5)
        .then(({ data: ticketsData }) => {
          if (ticketsData && ticketsData.length > 0) {
            console.log(
              `  Found ${ticketsData.length} tickets for this competition`,
            );
            ticketsData.forEach((t) => {
              console.log(
                `    Ticket ${t.ticket_number}: $${t.purchase_price}`,
              );
            });
          }
        });
    }

    console.log();
  });
}

console.log("\n" + "=".repeat(80));
console.log("DIAGNOSIS COMPLETE");
console.log("=".repeat(80));
