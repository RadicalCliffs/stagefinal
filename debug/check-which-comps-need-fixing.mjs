import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://ymzafwwbijcxrvsmwnii.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InltemFmd3diaWpjeHJ2c213bmlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDM4MDgzNDksImV4cCI6MjAxOTM4NDM0OX0.b5-YErLR28vfGIV2yxN1B1PHGd5P6Y6kfp2bXl_HQGE";

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkCompetitions() {
  console.log("=== CHECKING WHICH COMPETITIONS NEED VRF FIXING ===\n");

  // Check competitions that match the SQL criteria
  const { data: needFixing, error: error1 } = await supabase
    .from("competitions")
    .select(
      "id, title, status, end_date, outcomes_vrf_seed, winner_address, tickets_sold, is_instant_win, vrf_draw_completed_at",
    )
    .lt("end_date", new Date().toISOString())
    .not("outcomes_vrf_seed", "is", null)
    .is("winner_address", null)
    .eq("is_instant_win", false)
    .gt("tickets_sold", 0);

  console.log("Competitions matching SQL criteria (should be fixed):");
  if (needFixing && needFixing.length > 0) {
    needFixing.forEach((c) => {
      console.log(`  - ${c.title}`);
      console.log(`    Status: ${c.status}`);
      console.log(`    Winner Address: ${c.winner_address || "NULL"}`);
      console.log(`    VRF Completed: ${c.vrf_draw_completed_at || "NULL"}`);
      console.log(`    Tickets Sold: ${c.tickets_sold}`);
      console.log("");
    });
  } else {
    console.log(
      "  ✅ NO competitions need fixing (all already have winners)\n",
    );
  }

  // Check $1000 specifically
  const { data: thousand, error: error2 } = await supabase
    .from("competitions")
    .select("*")
    .eq("title", "$1000")
    .single();

  if (thousand) {
    console.log("\n$1000 Competition Status:");
    console.log(`  Status: ${thousand.status}`);
    console.log(`  Winner Address: ${thousand.winner_address || "NULL"}`);
    console.log(
      `  VRF Draw Requested: ${thousand.vrf_draw_requested_at || "NULL"}`,
    );
    console.log(
      `  VRF Draw Completed: ${thousand.vrf_draw_completed_at || "NULL"}`,
    );
    console.log(`  Outcomes VRF Seed: ${thousand.outcomes_vrf_seed || "NULL"}`);
    console.log(`  Tickets Sold: ${thousand.tickets_sold}`);
    console.log(`  Competition Ended Flag: ${thousand.competitionended}`);
    console.log(`  Drawn At: ${thousand.drawn_at || "NULL"}`);
  }

  // Check winners table
  if (thousand) {
    const { data: winners, error: error3 } = await supabase
      .from("winners")
      .select("*")
      .eq("competition_id", thousand.id);

    console.log(`\n  Winners in winners table: ${winners?.length || 0}`);
    if (winners && winners.length > 0) {
      winners.forEach((w) => {
        console.log(`    - Ticket #${w.ticket_number}: ${w.wallet_address}`);
      });
    }
  }
}

checkCompetitions();
