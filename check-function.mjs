import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg";

const supabase = createClient(supabaseUrl, supabaseKey);

console.log("Checking get_unavailable_tickets function...\n");

// Query the actual function definition from pg_proc
const checkQuery = `
SELECT 
    p.proname as function_name,
    pg_get_function_arguments(p.oid) as arguments,
    pg_get_function_result(p.oid) as return_type,
    pg_get_functiondef(p.oid) as function_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname = 'get_unavailable_tickets'
ORDER BY p.oid DESC;
`;

try {
  const { data, error } = await supabase.rpc("exec_sql", {
    sql: checkQuery,
  });

  if (error) {
    console.error("Error querying function:", error);

    // Try alternative: query pg_proc directly via PostgREST
    const { data: procData, error: procError } = await supabase
      .from("pg_proc")
      .select("*")
      .eq("proname", "get_unavailable_tickets");

    if (procError) {
      console.error("Alternative query failed:", procError);
    } else {
      console.log("Function records found:", procData);
    }
  } else {
    console.log("Function definitions:");
    console.log(JSON.stringify(data, null, 2));
  }
} catch (err) {
  console.error("Exception:", err);
}

// Also try to call the function and see what error we get
console.log("\n\nTrying to call get_unavailable_tickets...\n");
try {
  const { data, error } = await supabase.rpc("get_unavailable_tickets", {
    competition_id: "799a8e12-38f2-4989-ad24-15c995d673a6",
  });

  if (error) {
    console.error("RPC Error:", JSON.stringify(error, null, 2));
  } else {
    console.log("Success! Result:", data);
  }
} catch (err) {
  console.error("Exception calling RPC:", err);
}
