const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY",
);

async function reloadSchema() {
  console.log("Reloading PostgREST schema cache...\n");

  // Send NOTIFY to reload schema
  const { data, error } = await supabase.rpc("pgrst_reload_schema_cache");

  if (error) {
    console.error("Error reloading schema:", error);

    // Try alternative - send NOTIFY directly
    console.log("\nTrying direct NOTIFY...");
    const { data: notifyData, error: notifyError } = await supabase.rpc(
      "exec_sql_query",
      {
        sql_query: "NOTIFY pgrst, 'reload schema';",
      },
    );

    if (notifyError) {
      console.error("NOTIFY also failed:", notifyError);
    } else {
      console.log("NOTIFY sent successfully");
    }
  } else {
    console.log("Schema cache reloaded:", data);
  }
}

reloadSchema();
