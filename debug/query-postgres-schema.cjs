const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY";

const supabase = createClient(supabaseUrl, serviceKey);

async function querySchema() {
  console.log("Querying PostgreSQL information_schema for exact types...\n");

  const query = `
    SELECT 
      table_name,
      column_name,
      udt_name as data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('joincompetition', 'pending_tickets', 'tickets', 'competitions')
      AND column_name LIKE '%competition%'
    ORDER BY table_name, column_name;
  `;

  const { data, error } = await supabase.rpc("execute_sql", {
    query: query,
  });

  if (error) {
    console.error("execute_sql not available. Creating test function...\n");

    // Create a simple RPC function to query the schema
    const createFunc = `
      CREATE OR REPLACE FUNCTION get_competition_column_info()
      RETURNS TABLE(table_name text, column_name text, data_type text)
      LANGUAGE sql
      AS $$
        SELECT 
          table_name::text,
          column_name::text,
          udt_name::text
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('joincompetition', 'pending_tickets', 'tickets', 'competitions')
          AND column_name LIKE '%competition%'
        ORDER BY table_name, column_name;
      $$;
    `;

    console.log("Creating helper function...");
    const { error: createError } = await supabase.rpc("execute_sql", {
      query: createFunc,
    });

    if (createError) {
      console.error("Can't create function either. Manual query needed.");
      console.log("\nRun this in Supabase SQL Editor:");
      console.log(query);
      return;
    }

    const { data: data2, error: error2 } = await supabase.rpc(
      "get_competition_column_info",
    );

    if (error2) {
      console.error("Error:", JSON.stringify(error2, null, 2));
      return;
    }

    console.log("PostgreSQL Column Types:");
    data2.forEach((row) => {
      console.log(
        `  ${row.table_name}.${row.column_name} = ${row.data_type.toUpperCase()}`,
      );
    });
    return;
  }

  console.log("PostgreSQL Column Types:");
  data.forEach((row) => {
    console.log(
      `  ${row.table_name}.${row.column_name} = ${row.data_type.toUpperCase()}`,
    );
  });
}

querySchema().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
