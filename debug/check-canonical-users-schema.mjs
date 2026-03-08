import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

async function checkSchema() {
  console.log("📋 Checking ACTUAL canonical_users schema...\n");

  const { data, error } = await supabase
    .from("canonical_users")
    .select("*")
    .limit(1);

  if (error) {
    console.error("Error:", error);
    return;
  }

  if (data && data.length > 0) {
    console.log("Actual columns:");
    Object.keys(data[0]).forEach((col) => {
      console.log(`  - ${col}: ${typeof data[0][col]}`);
    });
  }
}

checkSchema().catch(console.error);
