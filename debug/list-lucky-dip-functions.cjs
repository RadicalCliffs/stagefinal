const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY",
);

async function listLuckyDipFunctions() {
  try {
    const { data, error } = await supabase.rpc("exec_sql", {
      sql: `
        SELECT 
          p.proname AS function_name,
          pg_get_function_arguments(p.oid) AS arguments,
          pg_get_functiondef(p.oid) AS definition
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
          AND (p.proname ILIKE '%lucky%dip%' OR p.proname ILIKE '%luckydip%')
        ORDER BY p.proname;
      `,
    });

    if (error) {
      // Try direct query instead
      const { data: funcData, error: funcError } = await supabase.rpc("sql", {
        query: `
          SELECT proname, pg_get_function_arguments(oid) as args
          FROM pg_proc 
          WHERE proname ILIKE '%lucky%'
        `,
      });

      if (funcError) {
        console.log("Error querying functions:", funcError);
        return;
      }

      console.log('Functions with "lucky" in name:');
      console.log(JSON.stringify(funcData, null, 2));
      return;
    }

    console.log("Lucky Dip Functions Found:");
    console.log("=".repeat(80));
    data.forEach((func, idx) => {
      console.log(`\n${idx + 1}. ${func.function_name}(${func.arguments})`);
      console.log("-".repeat(80));
    });
  } catch (err) {
    console.error("Exception:", err.message);
  }
}

listLuckyDipFunctions();
