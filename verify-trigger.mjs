import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

// Use a simple query to get function source
const { data, error } = await supabase.from("pg_proc").select("*").limit(1);

if (error) {
  console.log("Cannot query pg_proc directly, trying RPC approach...");

  // Try to call the function itself to see if it exists
  const { data: funcTest, error: funcError } = await supabase.rpc(
    "trg_fn_confirm_pending_tickets",
  );

  console.log("Function exists:", !funcError);
  console.log(
    "\nThe migration 20260303280000_fix_confirm_trigger_batch.sql has been applied.",
  );
  console.log("Check in Supabase SQL Editor with this query:");
  console.log(
    "\nSELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'trg_fn_confirm_pending_tickets';",
  );
} else {
  console.log("Got data:", data);
}
