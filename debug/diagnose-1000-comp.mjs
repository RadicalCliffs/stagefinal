import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://ymzafwwbijcxrvsmwnii.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InltemFmd3diaWpjeHJ2c213bmlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDM4MDgzNDksImV4cCI6MjAxOTM4NDM0OX0.b5-YErLR28vfGIV2yxN1B1PHGd5P6Y6kfp2bXl_HQGE";

const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnose() {
  console.log("=== DIAGNOSING $1000 COMPETITION ===\n");

  // Get $1000 competition
  const { data: comp, error: compError } = await supabase
    .from("competitions")
    .select("*")
    .eq("title", "$1000")
    .single();

  if (compError) {
    console.error("Error getting competition:", compError);
    return;
  }

  console.log("1. COMPETITION TABLE:");
  console.log(`   ID: ${comp.id}`);
  console.log(`   Title: ${comp.title}`);
  console.log(`   Status: ${comp.status}`);
  console.log(`   Winner Address: ${comp.winner_address || "NULL ❌"}`);
  console.log(
    `   VRF Draw Requested At: ${comp.vrf_draw_requested_at || "NULL"}`,
  );
  console.log(
    `   VRF Draw Completed At: ${comp.vrf_draw_completed_at || "NULL ❌"}`,
  );
  console.log(`   Drawn At: ${comp.drawn_at || "NULL"}`);
  console.log(`   Competition Ended: ${comp.competitionended}`);
  console.log(`   Tickets Sold: ${comp.tickets_sold}`);
  console.log(
    `   Outcomes VRF Seed: ${comp.outcomes_vrf_seed ? "✅ EXISTS" : "NULL"}`,
  );
  console.log(`   Is Instant Win: ${comp.is_instant_win}`);
  console.log(`   End Date: ${comp.end_date}`);

  console.log("\n2. WINNERS TABLE:");
  const { data: winners, error: winnersError } = await supabase
    .from("winners")
    .select("*")
    .eq("competition_id", comp.id);

  if (winners && winners.length > 0) {
    console.log(`   ✅ Found ${winners.length} winner(s)`);
    winners.forEach((w, i) => {
      console.log(`   Winner ${i + 1}:`);
      console.log(`     - User ID: ${w.user_id}`);
      console.log(`     - Wallet: ${w.wallet_address}`);
      console.log(`     - Ticket #: ${w.ticket_number}`);
      console.log(`     - Prize Position: ${w.prize_position}`);
      console.log(`     - Won At: ${w.won_at}`);
    });
  } else {
    console.log("   ❌ NO WINNERS FOUND");
  }

  console.log("\n3. COMPETITION_WINNERS TABLE:");
  const { data: compWinners, error: compWinnersError } = await supabase
    .from("competition_winners")
    .select("*")
    .eq("competitionid", comp.id);

  if (compWinners && compWinners.length > 0) {
    console.log(`   ✅ Found ${compWinners.length} record(s)`);
    compWinners.forEach((w, i) => {
      console.log(`   Record ${i + 1}:`);
      console.log(`     - Winner: ${w.Winner}`);
      console.log(`     - Ticket: ${w.ticket_number}`);
      console.log(`     - User ID: ${w.user_id}`);
      console.log(`     - Won At: ${w.won_at}`);
    });
  } else {
    console.log("   ❌ NO RECORDS FOUND");
  }

  console.log("\n4. JOINCOMPETITION TABLE:");
  const { data: entries, error: entriesError } = await supabase
    .from("joincompetition")
    .select("user_id, is_winner, ticket_number")
    .eq("competition_id", comp.id)
    .eq("is_winner", true);

  if (entries && entries.length > 0) {
    console.log(`   ✅ Found ${entries.length} entry marked as winner`);
    entries.forEach((e) => {
      console.log(`     - User: ${e.user_id}`);
      console.log(`     - Ticket: ${e.ticket_number}`);
    });
  } else {
    console.log("   ❌ NO ENTRIES MARKED AS WINNER");
  }

  console.log("\n5. TICKETS TABLE:");
  if (comp.winner_address) {
    const { data: winnerTickets, error: ticketsError } = await supabase
      .from("tickets")
      .select("*")
      .eq("competition_id", comp.id)
      .eq("wallet_address", comp.winner_address);

    if (winnerTickets && winnerTickets.length > 0) {
      console.log(`   ✅ Winner has ${winnerTickets.length} ticket(s)`);
      winnerTickets.forEach((t) => {
        console.log(`     - Ticket #${t.ticket_number}`);
      });
    }
  } else {
    console.log("   ⚠️  No winner_address set, skipping tickets check");
  }

  console.log("\n=== DIAGNOSIS COMPLETE ===");
  console.log("\nFRONTEND REQUIREMENTS:");
  console.log(
    "  - status = 'completed' ?",
    comp.status === "completed" ? "✅" : "❌",
  );
  console.log("  - winner_address set ?", comp.winner_address ? "✅" : "❌");
  console.log(
    "  - vrf_draw_completed_at set ?",
    comp.vrf_draw_completed_at ? "✅" : "❌",
  );
  console.log(
    "  - winners table has entry ?",
    winners && winners.length > 0 ? "✅" : "❌",
  );
}

diagnose();
