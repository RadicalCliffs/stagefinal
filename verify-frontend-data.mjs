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

async function checkFrontendData() {
  try {
    await client.connect();
    console.log("=== VERIFYING FRONTEND WILL SEE WINNER DATA ===\n");

    const compId = "98ea9cbc-5d9b-409b-b757-acb9d0292a95";

    // Query exactly what the frontend queries
    console.log(
      "1. COMPETITIONS TABLE (what FinishedCompetitionHeroSection queries):",
    );
    const compResult = await client.query(
      `
      SELECT 
        winner_address, 
        outcomes_vrf_seed, 
        tickets_sold, 
        vrf_tx_hash,
        status, 
        vrf_draw_completed_at
      FROM competitions
      WHERE id = $1
    `,
      [compId],
    );

    if (compResult.rows[0]) {
      console.log("   ✅ Found competition data:");
      console.log(
        `      - winner_address: ${compResult.rows[0].winner_address ? "✅ SET" : "❌ NULL"}`,
      );
      console.log(
        `      - outcomes_vrf_seed: ${compResult.rows[0].outcomes_vrf_seed ? "✅ SET" : "❌ NULL"}`,
      );
      console.log(
        `      - vrf_tx_hash: ${compResult.rows[0].vrf_tx_hash ? "✅ SET" : "❌ NULL"}`,
      );
      console.log(`      - status: ${compResult.rows[0].status}`);
      console.log(`      - tickets_sold: ${compResult.rows[0].tickets_sold}`);
    }

    console.log("\n2. WINNERS TABLE (primary source for frontend):");
    const winnersResult = await client.query(
      `
      SELECT 
        wallet_address, 
        ticket_number, 
        user_id, 
        username,
        won_at,
        prize_position
      FROM winners
      WHERE competition_id = $1 AND prize_position = 1
    `,
      [compId],
    );

    if (winnersResult.rows.length > 0) {
      console.log("   ✅ Found winner data:");
      console.log(
        `      - wallet_address: ${winnersResult.rows[0].wallet_address}`,
      );
      console.log(
        `      - ticket_number: ${winnersResult.rows[0].ticket_number}`,
      );
      console.log(
        `      - user_id: ${winnersResult.rows[0].user_id || "NULL"}`,
      );
      console.log(
        `      - username: ${winnersResult.rows[0].username || "NULL"}`,
      );
      console.log(`      - won_at: ${winnersResult.rows[0].won_at}`);
    } else {
      console.log("   ❌ NO DATA IN WINNERS TABLE");
    }

    console.log("\n3. COMPETITION_WINNERS TABLE (fallback):");
    const cwResult = await client.query(
      `
      SELECT 
        winner,
        ticket_number,
        user_id,
        username,
        won_at
      FROM competition_winners
      WHERE competitionid = $1
    `,
      [compId],
    );

    if (cwResult.rows.length > 0) {
      console.log(`   ✅ Found ${cwResult.rows.length} record(s)`);
      console.log(`      - winner: ${cwResult.rows[0].winner}`);
      console.log(`      - ticket_number: ${cwResult.rows[0].ticket_number}`);
    } else {
      console.log("   ❌ NO DATA");
    }

    console.log("\n4. FRONTEND WILL SEE:");
    const winner = winnersResult.rows[0] || cwResult.rows[0];
    if (compResult.rows[0].winner_address || winner) {
      console.log("   ✅ WINNER ANNOUNCED SECTION");
      console.log(
        `      - Winner Address: ${compResult.rows[0].winner_address || winner?.winner || "NULL"}`,
      );
      console.log(
        `      - Winning Ticket: #${winner?.ticket_number || "NULL"}`,
      );
      console.log(
        `      - VRF TX Hash: ${compResult.rows[0].vrf_pregenerated_tx_hash ? "YES (link to BaseScan)" : "NULL"}`,
      );
      console.log(
        `      - VRF Seed: ${compResult.rows[0].outcomes_vrf_seed ? "YES (verification formula)" : "NULL"}`,
      );
    } else {
      console.log("   ❌ DRAWING IN PROGRESS STATE");
    }

    console.log("\n=== VERIFICATION COMPLETE ===");

    await client.end();
  } catch (error) {
    console.error("❌ Error:", error.message);
    await client.end();
  }
}

checkFrontendData();
