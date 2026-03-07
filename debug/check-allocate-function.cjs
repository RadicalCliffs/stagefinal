const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTY4ODg0ODQ4MCwiZXhwIjoyMDA0NDI0NDgwfQ.BUSYu59Tfa_ztLrfGKTjlr_JscvlnY5M6Y4y0JfhX2o",
);

async function checkFunction() {
  const { data, error } = await supabase.rpc("temp_get_function_def", {
    p_function_name: "allocate_lucky_dip_tickets_batch",
  });

  if (error) {
    // Function doesn't exist, try direct query
    const { data: funcData, error: funcError } = await supabase
      .from("pg_proc")
      .select("*")
      .ilike("proname", "allocate_lucky_dip_tickets_batch")
      .limit(1);

    console.log(
      "Direct query result:",
      JSON.stringify(funcData || funcError, null, 2),
    );

    // Alternative: query information_schema
    const query = `
      SELECT routine_definition 
      FROM information_schema.routines 
      WHERE routine_name = 'allocate_lucky_dip_tickets_batch'
      AND routine_schema = 'public';
    `;

    console.log("\n\nAttempting to query function source via psql...");

    const { exec } = require("child_process");
    const cmd = `psql "postgresql://postgres.mthwfldcjvpxjtmrqkqm:iamclaudeandiamafuckingretard@aws-0-us-west-1.pooler.supabase.com:6543/postgres" -c "\\sf allocate_lucky_dip_tickets_batch"`;

    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error("Error:", err);
        console.error("stderr:", stderr);
      } else {
        console.log("Function definition:\n", stdout);
      }
    });
  } else {
    console.log("Function definition:", JSON.stringify(data, null, 2));
  }
}

checkFunction();
