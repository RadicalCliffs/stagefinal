const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTY4ODg0ODQ4MCwiZXhwIjoyMDA0NDI0NDgwfQ.BUSYu59Tfa_ztLrfGKTjlr_JscvlnY5M6Y4y0JfhX2o",
);

async function searchForCompetitionid() {
  console.log('Searching for functions that reference "competitionid"...\n');

  // Query all function definitions
  const { data, error } = await supabase.rpc("exec_sql", {
    sql: `
      SELECT 
        p.proname AS function_name,
        pg_get_functiondef(p.oid) AS function_definition
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
        AND p.prokind = 'f'
        AND lower(pg_get_functiondef(p.oid)) LIKE '%competitionid%'
      ORDER BY p.proname;
    `,
  });

  if (error) {
    console.error("Error:", error);

    // Try alternative approach with information_schema
    console.log("\n\nTrying alternative query...");
    const connString =
      "postgresql://postgres.mthwfldcjvpxjtmrqkqm:iamclaudeandiamafuckingretard@aws-0-us-west-1.pooler.supabase.com:6543/postgres";

    const { exec } = require("child_process");
    const cmd = `psql "${connString}" -c "SELECT proname FROM pg_proc WHERE lower(pg_get_functiondef(oid)) LIKE '%competitionid%' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');"`;

    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error("psql error:", stderr);
      } else {
        console.log("Functions with competitionid reference:", stdout);
      }
    });
  } else {
    console.log("Found functions referencing competitionid:");
    console.log(JSON.stringify(data, null, 2));
  }
}

searchForCompetitionid();
