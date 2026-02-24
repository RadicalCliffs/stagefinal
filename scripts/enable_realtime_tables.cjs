/**
 * Enable Supabase Realtime on critical tables
 *
 * Tables that need realtime for the landing page:
 * - joincompetition (live entries)
 * - winners (recent wins)
 * - competition_entries (unified entries table)
 *
 * Run with: node scripts/enable_realtime_tables.cjs
 */

require("dotenv/config");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.PUBLIC_SUPABASE_URL || "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY",
);

async function enableRealtime() {
  // Tables that need realtime enabled
  const tables = [
    "joincompetition",
    "winners",
    "competition_entries",
    "competitions",
    "canonical_users",
  ];

  console.log("📋 Checking realtime configuration...\n");

  // Check which tables exist and have data
  for (const table of tables) {
    try {
      const { count, error } = await supabase
        .from(table)
        .select("*", { count: "exact", head: true });

      if (error) {
        console.log(`⚠️  ${table} - ${error.message}`);
      } else {
        console.log(`✅ ${table} - exists (${count || 0} rows)`);
      }
    } catch (err) {
      console.log(`❌ ${table} - error: ${err.message}`);
    }
  }

  console.log("");

  // Try to enable realtime via RPC (create the function if needed)
  const enableRealtimeSQL = `
    DO $$
    DECLARE
      tbl TEXT;
      tables_to_enable TEXT[] := ARRAY['joincompetition', 'winners', 'competition_entries', 'competitions', 'canonical_users'];
    BEGIN
      FOREACH tbl IN ARRAY tables_to_enable
      LOOP
        BEGIN
          EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
          RAISE NOTICE 'Enabled realtime for %', tbl;
        EXCEPTION
          WHEN duplicate_object THEN
            RAISE NOTICE 'Table % already in publication', tbl;
          WHEN undefined_table THEN
            RAISE NOTICE 'Table % does not exist', tbl;
        END;
      END LOOP;
    END $$;
  `;

  console.log("🔄 Enabling realtime via SQL...\n");

  const { error } = await supabase.rpc("exec_sql", { sql: enableRealtimeSQL });

  if (error) {
    // exec_sql RPC doesn't exist, provide manual instructions
    console.log("ℹ️  Cannot enable realtime programmatically.\n");
    console.log("To enable realtime, go to the Supabase Dashboard:");
    console.log("1. Open your project: https://supabase.com/dashboard");
    console.log("2. Go to Database > Replication");
    console.log(
      "3. Under 'Supabase Realtime', click 'Source' and enable these tables:",
    );
    tables.forEach((t) => console.log(`   - ${t}`));
    console.log("\nOr run this SQL in the SQL Editor:");
    console.log(`
ALTER PUBLICATION supabase_realtime ADD TABLE public.joincompetition;
ALTER PUBLICATION supabase_realtime ADD TABLE public.winners;
ALTER PUBLICATION supabase_realtime ADD TABLE public.competition_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE public.competitions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.canonical_users;
    `);
  } else {
    console.log("✅ Realtime enabled for all tables!");
  }

  console.log("\n✅ Done checking realtime configuration.");
}

enableRealtime().catch(console.error);
