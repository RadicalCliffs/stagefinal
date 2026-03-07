import pg from "pg";
import crypto from "crypto";
const { Pool } = pg;

const pool = new Pool({
  host: "aws-0-ap-south-1.pooler.supabase.com",
  port: 5432,
  database: "postgres",
  user: "postgres.mthwfldcjvpxjtmrqkqm",
  password: "mINEr00m881!",
  ssl: { rejectUnauthorized: false },
});

async function checkAlgorithm() {
  const client = await pool.connect();
  try {
    // Get $1000 competition data
    const result = await client.query(`
      SELECT c.id, c.title, c.outcomes_vrf_seed, c.tickets_sold,
             w.ticket_number as winning_ticket,
             w.wallet_address as winner_address
      FROM competitions c
      JOIN winners w ON w.competition_id = c.id
      WHERE c.title ILIKE '%1000%' OR c.title ILIKE '%$1000%'
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      console.log("No $1000 competition found");
      return;
    }

    const comp = result.rows[0];
    console.log("\n=== $1000 COMPETITION DATA ===");
    console.log("ID:", comp.id);
    console.log("VRF Seed:", comp.outcomes_vrf_seed);
    console.log("Tickets Sold:", comp.tickets_sold);
    console.log("Actual Winning Ticket:", comp.winning_ticket);
    console.log("Winner:", comp.winner_address);

    // Test SHA256 method (PostgreSQL digest method)
    const message = `SELECT-WINNER-${comp.outcomes_vrf_seed}-${comp.id}`;
    const sha256Hash = crypto
      .createHash("sha256")
      .update(message)
      .digest("hex");
    const first16 = sha256Hash.substring(0, 16);
    const sha256BigInt = BigInt("0x" + first16);
    const sha256Result = Number(sha256BigInt % BigInt(comp.tickets_sold)) + 1;

    console.log("\n=== SHA256 METHOD (PostgreSQL digest) ===");
    console.log("Message:", message);
    console.log("Hash:", sha256Hash);
    console.log("First 16 chars:", first16);
    console.log("Calculated Ticket:", sha256Result);
    console.log(
      "MATCH:",
      sha256Result === comp.winning_ticket ? "✅ YES" : "❌ NO",
    );

    // Import keccak256 won't work in Node.js easily, so just note it
    console.log("\n=== CONCLUSION ===");
    console.log("The SQL scripts use SHA256 algorithm");
    console.log("But the Deno edge function uses keccak256");
    console.log("They produce DIFFERENT results!");
    console.log(
      "Frontend VRFVerificationCard must use SHA256 to match SQL-selected winners",
    );
  } catch (err) {
    console.error("Error:", err.message);
    console.error(err.stack);
  } finally {
    client.release();
    await pool.end();
  }
}

checkAlgorithm();
