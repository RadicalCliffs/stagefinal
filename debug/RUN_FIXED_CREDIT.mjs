import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMzkyNDgzOSwiZXhwIjoyMDQ5NTAwODM5fQ.VJ2sTMgr93X8jNMp6ZN3nzWY5ycbPQV-9Wbqf-zX1Vg";

const sql = readFileSync("./SIMPLE_CREDIT_TOPUPS.sql", "utf-8");

const supabase = createClient(supabaseUrl, supabaseKey, {
  db: { schema: "public" },
  auth: { persistSession: false },
});

console.log("🚀 Running SIMPLE_CREDIT_TOPUPS.sql...\n");

try {
  const { data, error } = await supabase.rpc("exec_sql", { sql_query: sql });

  if (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }

  console.log("\n✅ SUCCESS! Credits applied.");
  console.log("Data:", data);
} catch (err) {
  console.error("❌ Failed to run sql query:", err.message);
  process.exit(1);
}
