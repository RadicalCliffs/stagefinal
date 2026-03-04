import pg from "pg";
const { Client } = pg;

// Database connection config
const client = new Client({
  host: "aws-0-ap-south-1.pooler.supabase.com",
  port: 6543,
  database: "postgres",
  user: "postgres.ymzafwwbijcxrvsmwnii",
  password: "ThePrize2024!WebApp",
  ssl: { rejectUnauthorized: false },
});

async function checkVRFCompletion() {
  try {
    await client.connect();
    console.log("✅ Connected to database\n");

    // Check the $1000 competition specifically
    const result = await client.query(`
      SELECT 
        id, 
        title, 
        status, 
        winner_address,
        vrf_draw_requested_at,
        vrf_draw_completed_at,
        drawn_at,
        competitionended
      FROM competitions
      WHERE title = '$1000'
    `);

    if (result.rows.length > 0) {
      console.log("$1000 Competition Details:");
      console.log(JSON.stringify(result.rows[0], null, 2));
    } else {
      console.log("❌ $1000 competition not found");
    }

    // Check winners table for this competition
    const winnersResult = await client.query(`
      SELECT 
        competition_id,
        user_id,
        wallet_address,
        ticket_number,
        won_at,
        created_at
      FROM winners
      WHERE competition_id = (SELECT id FROM competitions WHERE title = '$1000')
    `);

    console.log("\n\nWinners for $1000:");
    console.log(JSON.stringify(winnersResult.rows, null, 2));

    await client.end();
  } catch (error) {
    console.error("❌ Error:", error.message);
    await client.end();
  }
}

checkVRFCompletion();
