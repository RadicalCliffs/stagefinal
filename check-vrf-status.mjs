import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg",
);

console.log("=== CHECKING VRF SYSTEM STATUS ===\n");

// 1. Check for competitions past end date that should be drawn
console.log("1. Competitions Past End Date:\n");
const { data: pastEndDate, error: e1 } = await supabase
  .from("competitions")
  .select(
    "id, title, status, end_date, onchain_competition_id, vrf_draw_requested_at, vrf_draw_completed_at",
  )
  .lt("end_date", new Date().toISOString())
  .in("status", ["active", "ended", "drawing"])
  .eq("is_instant_win", false)
  .order("end_date", { ascending: false })
  .limit(5);

if (!e1 && pastEndDate) {
  console.log(`Found ${pastEndDate.length} competitions past end date:`);
  pastEndDate.forEach((c) => {
    console.log(`  - ${c.title}`);
    console.log(`    Status: ${c.status}`);
    console.log(`    End Date: ${c.end_date}`);
    console.log(`    Onchain ID: ${c.onchain_competition_id}`);
    console.log(`    VRF Requested: ${c.vrf_draw_requested_at || "NO"}`);
    console.log(`    VRF Completed: ${c.vrf_draw_completed_at || "NO"}`);
    console.log("");
  });
}

// 2. Check winners table structure
console.log("\n2. Winners Table Check:\n");
const { data: winnersData, error: e2 } = await supabase
  .from("winners")
  .select("*")
  .limit(3);

if (e2) {
  console.log(`❌ Winners table error: ${e2.message}`);
  console.log("   CODE:", e2.code);
} else {
  console.log(`✅ Winners table exists`);
  console.log(`   ${winnersData?.length || 0} recent winners found`);
  if (winnersData && winnersData.length > 0) {
    console.log("   Sample:", JSON.stringify(winnersData[0], null, 2));
  }
}

// 3. Check competition_winners table
console.log("\n3. Competition Winners Table Check:\n");
const { data: compWinners, error: e3 } = await supabase
  .from("competition_winners")
  .select("*")
  .limit(3);

if (e3) {
  console.log(`❌ Competition winners table error: ${e3.message}`);
} else {
  console.log(`✅ Competition_winners table exists`);
  console.log(`   ${compWinners?.length || 0} records found`);
}

// 4. Check if there are competitions stuck in drawing status
console.log("\n4. Competitions Stuck in Drawing:\n");
const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const { data: stuck, error: e4 } = await supabase
  .from("competitions")
  .select("id, title, status, vrf_draw_requested_at")
  .eq("status", "drawing")
  .lt("vrf_draw_requested_at", oneHourAgo);

if (!e4 && stuck) {
  if (stuck.length > 0) {
    console.log(`⚠️  Found ${stuck.length} competitions stuck in drawing:`);
    stuck.forEach((c) => {
      console.log(`  - ${c.title}: requested ${c.vrf_draw_requested_at}`);
    });
  } else {
    console.log("✅ No competitions stuck in drawing");
  }
}

// 5. Check Netlify VRF Scheduler logs (via competitions)
console.log("\n5. Recent VRF Activity:\n");
const { data: recentDraws, error: e5 } = await supabase
  .from("competitions")
  .select("id, title, vrf_draw_requested_at, vrf_draw_completed_at, status")
  .not("vrf_draw_requested_at", "is", null)
  .order("vrf_draw_requested_at", { ascending: false })
  .limit(5);

if (!e5 && recentDraws) {
  console.log(`Recent VRF draws (${recentDraws.length}):`);
  recentDraws.forEach((c) => {
    const timeSinceRequest = c.vrf_draw_requested_at
      ? Math.floor(
          (Date.now() - new Date(c.vrf_draw_requested_at).getTime()) /
            1000 /
            60,
        )
      : null;
    console.log(`  - ${c.title}`);
    console.log(
      `    Requested: ${c.vrf_draw_requested_at} (${timeSinceRequest} mins ago)`,
    );
    console.log(`    Completed: ${c.vrf_draw_completed_at || "PENDING"}`);
    console.log(`    Status: ${c.status}`);
    console.log("");
  });
}

console.log("\n=== VRF STATUS CHECK COMPLETE ===\n");
