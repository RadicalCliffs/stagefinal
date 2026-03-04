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

async function checkDetailedState() {
  try {
    await client.connect();
    console.log("=== CHECKING $1000 DETAILED STATE ===\n");

    const compId = "98ea9cbc-5d9b-409b-b757-acb9d0292a95";

    // Get winner address from competitions
    const compResult = await client.query(
      `
      SELECT winner_address, status, vrf_draw_completed_at
      FROM competitions
      WHERE id = $1
    `,
      [compId],
    );

    console.log("1. COMPETITIONS TABLE:");
    console.log(`   Winner Address: ${compResult.rows[0].winner_address}`);
    console.log(`   Status: ${compResult.rows[0].status}`);
    console.log(
      `   VRF Completed: ${compResult.rows[0].vrf_draw_completed_at}\n`,
    );

    // Get competition_winners
    const cwResult = await client.query(
      `
      SELECT winner, ticket_number, user_id, won_at
      FROM competition_winners
      WHERE competitionid = $1
    `,
      [compId],
    );

    console.log("2. COMPETITION_WINNERS TABLE:");
    if (cwResult.rows.length > 0) {
      console.log(`   Winner: ${cwResult.rows[0].winner}`);
      console.log(`   Ticket: ${cwResult.rows[0].ticket_number}`);
      console.log(`   User ID: ${cwResult.rows[0].user_id}`);
      console.log(`   Won At: ${cwResult.rows[0].won_at}\n`);
    }

    // Get winners table
    const winnersResult = await client.query(
      `
      SELECT * FROM winners WHERE competition_id = $1
    `,
      [compId],
    );

    console.log("3. WINNERS TABLE:");
    console.log(`   Records: ${winnersResult.rows.length}`);
    if (winnersResult.rows.length > 0) {
      console.log(`   Data: ${JSON.stringify(winnersResult.rows[0], null, 2)}`);
    } else {
      console.log("   ❌ NO RECORDS\n");

      // Check if user_id from competition_winners exists
      if (cwResult.rows.length > 0 && cwResult.rows[0].user_id) {
        console.log(`   Checking if we can insert...`);
        console.log(`   User ID to insert: ${cwResult.rows[0].user_id}`);
      }
    }

    // Get joincompetition
    const joinResult = await client.query(
      `
      SELECT user_id, is_winner FROM joincompetition 
      WHERE competition_id = $1 AND is_winner = true
    `,
      [compId],
    );

    console.log("\n4. JOINCOMPETITION TABLE:");
    console.log(`   Winners marked: ${joinResult.rows.length}`);

    await client.end();
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error(error);
    await client.end();
  }
}

checkDetailedState();
