import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

console.log("Checking live get_user_competition_entries function...\n");

// Query the actual function definition
const { data, error } = await supabase.rpc("get_user_competition_entries", {
  p_user_identifier:
    process.env.VITE_WALLET_ADDRESS ||
    "0x0000000000000000000000000000000000000000",
});

if (error) {
  console.error("ERROR:", error);
} else {
  console.log("Function returns these fields:");
  if (data && data.length > 0) {
    console.log(Object.keys(data[0]));
  } else {
    console.log(
      "No data returned, checking pg_catalog for function signature...",
    );

    const { data: funcData, error: funcError } = await supabase.rpc("query", {
      query: `
        SELECT 
          p.proname as function_name,
          pg_get_function_result(p.oid) as return_type,
          pg_get_function_arguments(p.oid) as arguments
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' 
        AND p.proname = 'get_user_competition_entries'
      `,
    });

    if (funcError) {
      console.error("Could not query function:", funcError);
    } else {
      console.log("Function signature:", funcData);
    }
  }
}
