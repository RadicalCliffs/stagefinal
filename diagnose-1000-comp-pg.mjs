import pg from "pg";
const { Client } = pg;

const client = new Client({
  host: "aws-1-ap-south-1.pooler.supabase.com",
  port: 5432,
  database: "postgres",
  user: "postgres.mthwfldcjvpxjtmrqkqm",
  password: "iamclaudeandiamafuckingretard",
  ssl: { rejectUnauthorized: false },
});

async function diagnose() {
  try {
    await client.connect();
    console.log("=== DIAGNOSING $1000 COMPETITION ===\n");

    // Get competition
    const compResult = await client.query(`
      SELECT 
        id, title, status, winner_address, 
        vrf_draw_requested_at, vrf_draw_completed_at, 
        drawn_at, competitionended, tickets_sold,
        outcomes_vrf_seed, is_instant_win, end_date
      FROM competitions
      WHERE title = '$1000'
    `);

    if (compResult.rows.length === 0) {
      console.log("❌ $1000 competition not found");
      await client.end();
      return;
    }

    const comp = compResult.rows[0];
    console.log("1. COMPETITION TABLE:");
    console.log(`   ID: ${comp.id}`);
    console.log(`   Title: ${comp.title}`);
    console.log(`   Status: ${comp.status}`);
    console.log(`   Winner Address: ${comp.winner_address || "NULL ❌"}`);
    console.log(
      `   VRF Draw Requested: ${comp.vrf_draw_requested_at || "NULL"}`,
    );
    console.log(
      `   VRF Draw Completed: ${comp.vrf_draw_completed_at || "NULL ❌"}`,
    );
    console.log(`   Drawn At: ${comp.drawn_at || "NULL"}`);
    console.log(`   Competition Ended: ${comp.competitionended}`);
    console.log(`   Tickets Sold: ${comp.tickets_sold}`);
    console.log(`   VRF Seed: ${comp.outcomes_vrf_seed ? "✅" : "NULL"}`);
    console.log(`   Is Instant Win: ${comp.is_instant_win}`);

    // Check winners table
    const winnersResult = await client.query(
      `
      SELECT user_id, wallet_address, ticket_number, prize_position, won_at
      FROM winners
      WHERE competition_id = $1
    `,
      [comp.id],
    );

    console.log("\n2. WINNERS TABLE:");
    if (winnersResult.rows.length > 0) {
      console.log(`   ✅ Found ${winnersResult.rows.length} winner(s)`);
      winnersResult.rows.forEach((w, i) => {
        console.log(`   Winner ${i + 1}:`);
        console.log(`     - Wallet: ${w.wallet_address}`);
        console.log(`     - Ticket #: ${w.ticket_number}`);
        console.log(`     - Won At: ${w.won_at}`);
      });
    } else {
      console.log("   ❌ NO WINNERS FOUND");
    }

    // Check competition_winners
    const compWinnersResult = await client.query(
      `
      SELECT winner, ticket_number, user_id, won_at
      FROM competition_winners
      WHERE competitionid = $1
    `,
      [comp.id],
    );

    console.log("\n3. COMPETITION_WINNERS TABLE:");
    if (compWinnersResult.rows.length > 0) {
      console.log(`   ✅ Found ${compWinnersResult.rows.length} record(s)`);
      compWinnersResult.rows.forEach((w, i) => {
        console.log(`   Record ${i + 1}:`);
        console.log(`     - Winner: ${w.Winner}`);
        console.log(`     - Ticket: ${w.ticket_number}`);
        console.log(`     - Won At: ${w.won_at}`);
      });
    } else {
      console.log("   ❌ NO RECORDS FOUND");
    }

    // Check joincompetition
    const joinResult = await client.query(
      `
      SELECT user_id, is_winner
      FROM joincompetition
      WHERE competition_id = $1 AND is_winner = true
    `,
      [comp.id],
    );

    console.log("\n4. JOINCOMPETITION TABLE:");
    if (joinResult.rows.length > 0) {
      console.log(
        `   ✅ Found ${joinResult.rows.length} entry marked as winner`,
      );
      joinResult.rows.forEach((e) => {
        console.log(`     - User: ${e.user_id}`);
      });
    } else {
      console.log("   ❌ NO ENTRIES MARKED AS WINNER");
    }

    console.log("\n=== DIAGNOSIS COMPLETE ===");
    console.log("\nFRONTEND REQUIREMENTS:");
    console.log(
      `  - status = 'completed' ? ${comp.status === "completed" ? "✅" : "❌ (currently: " + comp.status + ")"}`,
    );
    console.log(
      `  - winner_address set ? ${comp.winner_address ? "✅" : "❌"}`,
    );
    console.log(
      `  - vrf_draw_completed_at ? ${comp.vrf_draw_completed_at ? "✅" : "❌"}`,
    );
    console.log(
      `  - winners table entry ? ${winnersResult.rows.length > 0 ? "✅" : "❌"}`,
    );

    await client.end();
  } catch (error) {
    console.error("❌ Error:", error.message);
    await client.end();
  }
}

diagnose();
