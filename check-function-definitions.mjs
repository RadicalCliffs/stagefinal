import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY",
);

async function checkFunctionDefinition() {
  // Try to query pg_catalog to get the actual function definition
  const query = `
    SELECT 
      p.proname as function_name,
      pg_get_functiondef(p.oid) as function_definition
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname IN ('allocate_lucky_dip_tickets_batch', 'reserve_lucky_dip', 'get_competition_entries_bypass_rls')
    ORDER BY p.proname, p.oid;
  `;

  const { data, error } = await supabase.rpc("exec_sql", { sql_query: query });

  if (error) {
    console.log("exec_sql RPC not available, trying direct query...");
    // Try searching function source for the old column name
    const { data: searchResult, error: searchError } = await supabase.rpc(
      "search_function_source",
      { search_term: "competitionid" },
    );

    if (searchError) {
      console.log("Cannot query function definitions directly.");
      console.log("Error:", searchError);
    } else {
      console.log('Functions containing "competitionid":', searchResult);
    }
  } else {
    console.log("Function definitions:", JSON.stringify(data, null, 2));
  }
}

checkFunctionDefinition();
