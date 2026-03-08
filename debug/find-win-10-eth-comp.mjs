import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

console.log("🔍 Finding Win 10 ETH competition\n");

const { data: comps } = await supabase
  .from("competitions")
  .select("id, uid, title, status")
  .ilike("title", "%10%ETH%")
  .order("created_at", { ascending: false });

if (comps && comps.length > 0) {
  console.log("Found competitions:");
  comps.forEach((c) => {
    console.log(`  ${c.title}`);
    console.log(`    ID: ${c.id}`);
    console.log(`    UID: ${c.uid}`);
    console.log(`    Status: ${c.status}\n`);
  });
} else {
  // Try broader search
  console.log("Trying broader search for ETH competitions...\n");
  const { data: ethComps } = await supabase
    .from("competitions")
    .select("id, uid, title, status")
    .ilike("title", "%ETH%")
    .order("created_at", { ascending: false })
    .limit(10);

  if (ethComps && ethComps.length > 0) {
    console.log("Found ETH competitions:");
    ethComps.forEach((c) => {
      console.log(`  ${c.title}`);
      console.log(`    ID: ${c.id}`);
      console.log(`    Status: ${c.status}\n`);
    });
  }
}
