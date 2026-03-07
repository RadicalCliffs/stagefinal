import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

console.log("Checking actual table schema from Supabase...\n");

// Query competitions table columns
const { data: compData, error: compError } = await supabase.rpc("query", {
  query: `
      SELECT column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'competitions'
      ORDER BY ordinal_position;
    `,
});

if (compError) {
  console.error("Competitions error:", compError);
} else {
  console.log("=== COMPETITIONS TABLE ===");
  console.table(compData);
}

// Query joincompetition table columns
const { data: jcData, error: jcError } = await supabase.rpc("query", {
  query: `
      SELECT column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'joincompetition'
      ORDER BY ordinal_position;
    `,
});

if (jcError) {
  console.error("Joincompetition error:", jcError);
} else {
  console.log("\n=== JOINCOMPETITION TABLE ===");
  console.table(jcData);
}
