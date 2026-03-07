const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY";

const supabase = createClient(supabaseUrl, serviceKey);

async function checkTriggers() {
  console.log("Checking triggers on pending_tickets table...\n");

  const createQuery = `
    CREATE OR REPLACE FUNCTION temp_check_triggers()
    RETURNS TABLE(
      trigger_name text,
      event_manipulation text,
      action_timing text,
      function_name text,
      function_def text
    )
    LANGUAGE sql
    AS $$
      SELECT 
        t.trigger_name::text,
        em.event_manipulation::text,
        t.action_timing::text,
        p.proname::text,
        pg_get_functiondef(p.oid)::text
      FROM information_schema.triggers t
      JOIN pg_trigger pgt ON pgt.tgname = t.trigger_name
      JOIN pg_proc p ON p.oid = pgt.tgfoid
      CROSS JOIN information_schema.triggered_update_columns em
      WHERE t.event_object_table = 'pending_tickets'
        AND t.event_object_schema = 'public'
      ORDER BY t.action_order;
    $$;
  `;

  const { error: createError } = await supabase.rpc("exec_sql", {
    sql_query: createQuery,
  });

  if (createError) {
    console.error("Failed:", JSON.stringify(createError, null, 2));
    console.log("\nRun this in Supabase SQL Editor:\n");
    console.log(`
SELECT 
  t.tgname as trigger_name,
  p.proname as function_name,
  pg_get_functiondef(p.oid) as function_body
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE c.relname = 'pending_tickets'
  AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
    `);
    return;
  }

  const { data, error } = await supabase.rpc("temp_check_triggers");

  if (error) {
    console.error("Error:", JSON.stringify(error, null, 2));
    return;
  }

  console.log(`Found ${data.length} trigger(s):\n`);
  data.forEach((row, i) => {
    console.log(
      `[${i + 1}] ${row.trigger_name} (${row.action_timing} ${row.event_manipulation})`,
    );
    console.log(`    Calls: ${row.function_name}`);

    if (row.function_def.includes("check_and_mark_competition_sold_out")) {
      console.log(`    ⚠️  Calls check_and_mark_competition_sold_out!`);
      const match = row.function_def.match(
        /check_and_mark_competition_sold_out\([^)]+\)/,
      );
      if (match) {
        console.log(`    Call: ${match[0]}`);
      }
    }
    console.log("");
  });
}

checkTriggers().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
