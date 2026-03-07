const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY",
);

async function getFunctionSource() {
  console.log("Querying function definition...\n");

  // Query pg_proc directly for the function definition
  const { data, error } = await supabase.rpc("exec_sql", {
    sql: `
      SELECT pg_get_functiondef(oid) AS definition
      FROM pg_proc
      WHERE proname = 'allocate_lucky_dip_tickets_batch'
        AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      ORDER BY oid DESC
      LIMIT 1;
    `,
  });

  if (error || !data || data.length === 0) {
    console.error("Error fetching function via exec_sql:", error);
    console.log("\nTrying alternative approach - test call...\n");

    // Try CREATE FUNCTION approach - create temp function to read it
    const { data: testData, error: testError } = await supabase.rpc(
      "allocate_lucky_dip_tickets_batch",
      {
        p_user_id: "test",
        p_competition_id: "98ea9cbc-5d9b-409b-b757-acb9d0292a95", // Real competition ID
        p_count: 1,
      },
    );

    console.log("\nTest call result:", JSON.stringify(testData, null, 2));

    // The error message will tell us what column it's trying to use
    if (testData && testData.error) {
      if (testData.error.includes("competitionid")) {
        console.log(
          "\n⚠️  Function is still using OLD column name: competitionid",
        );
        console.log(
          "This means the CREATE OR REPLACE did not execute properly.",
        );
      } else if (testData.error.includes("competition_id")) {
        console.log("\n✅ Function is using NEW column name: competition_id");
        console.log("The error is legitimate (competition not found).");
      }
    }

    return;
  }

  const funcDef = data[0].definition;
  console.log("Function definition:");
  console.log(funcDef);

  // Check which column it references
  if (
    funcDef.includes(" competitionid ") ||
    funcDef.includes(".competitionid") ||
    funcDef.includes('="competitionid"')
  ) {
    console.log("\n⚠️  Function uses OLD column: competitionid");
  } else if (
    funcDef.includes(" competition_id ") ||
    funcDef.includes(".competition_id")
  ) {
    console.log("\n✅ Function uses NEW column: competition_id");
  }
}

getFunctionSource().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
