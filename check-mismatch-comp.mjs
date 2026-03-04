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

async function checkMismatch() {
  const client = await pool.connect();
  try {
    // Find the competition with ticket #1 as winner and ticket #673 mismatch
    // VRF seed starts with 2ab19f12e056e83
    const compResult = await client.query(`
      SELECT c.id, c.title, c.outcomes_vrf_seed, c.tickets_sold, c.winner_address,
             w.ticket_number as winning_ticket,
             w.wallet_address as winner_wallet
      FROM competitions c
      LEFT JOIN winners w ON w.competition_id = c.id AND w.prize_position = 1
      WHERE c.outcomes_vrf_seed LIKE '2ab19f12e056e83%'
         OR (w.ticket_number = 1 AND c.tickets_sold > 600)
      LIMIT 5
    `);

    if (compResult.rows.length === 0) {
      console.log("No matching competition found. Trying broader search...");

      // Search for any recent competition with ticket #1
      const broadResult = await client.query(`
        SELECT c.id, c.title, c.outcomes_vrf_seed, c.tickets_sold, c.winner_address,
               w.ticket_number as winning_ticket,
               w.wallet_address as winner_wallet
        FROM competitions c
        LEFT JOIN winners w ON w.competition_id = c.id AND w.prize_position = 1
        WHERE w.ticket_number = 1
          AND c.tickets_sold BETWEEN 2000 AND 2200
        ORDER BY c.updated_at DESC
        LIMIT 5
      `);

      console.log("\nFound competitions:");
      console.log(JSON.stringify(broadResult.rows, null, 2));

      if (broadResult.rows.length === 0) {
        console.log("Still nothing. Exiting.");
        return;
      }
    }

    const rows = compResult.rows.length > 0 ? compResult.rows : [];

    for (const comp of rows) {
      console.log("\n=== CHECKING COMPETITION ===");
      console.log("ID:", comp.id);
      console.log("Title:", comp.title);
      console.log("VRF Seed:", comp.outcomes_vrf_seed);
      console.log("Tickets Sold:", comp.tickets_sold);
      console.log("Actual Winning Ticket:", comp.winning_ticket);
      console.log("Winner Address:", comp.winner_wallet);

      // Test SHA256 method (correct algorithm)
      const message = `SELECT-WINNER-${comp.outcomes_vrf_seed}-${comp.id}`;
      const sha256Hash = crypto
        .createHash("sha256")
        .update(message)
        .digest("hex");
      const first16 = sha256Hash.substring(0, 16);
      const sha256BigInt = BigInt("0x" + first16);
      const sha256Result = Number(sha256BigInt % BigInt(comp.tickets_sold)) + 1;

      console.log("\n=== SHA256 CALCULATION (CORRECT) ===");
      console.log("Message:", message);
      console.log("SHA256 Hash:", sha256Hash);
      console.log("First 16 chars:", first16);
      console.log("Calculated Ticket:", sha256Result);
      console.log(
        "MATCH:",
        sha256Result === comp.winning_ticket ? "✅ YES" : "❌ NO",
      );

      // Also check if ticket #1 actually exists
      const ticketCheck = await client.query(
        `
        SELECT ticket_number, wallet_address, 
               COALESCE(user_id, canonical_user_id, privy_user_id) as user_id
        FROM tickets
        WHERE competition_id = $1
          AND ticket_number = 1
      `,
        [comp.id],
      );

      console.log("\n=== TICKET #1 CHECK ===");
      if (ticketCheck.rows.length > 0) {
        console.log("✅ Ticket #1 EXISTS");
        console.log("Owner:", ticketCheck.rows[0].wallet_address);
        console.log("User ID:", ticketCheck.rows[0].user_id);
      } else {
        console.log("❌ Ticket #1 DOES NOT EXIST in tickets table");
      }

      // Check if calculated winning ticket exists
      const calcTicketCheck = await client.query(
        `
        SELECT ticket_number, wallet_address
        FROM tickets
        WHERE competition_id = $1
          AND ticket_number = $2
      `,
        [comp.id, sha256Result],
      );

      console.log(`\n=== TICKET #${sha256Result} CHECK ===`);
      if (calcTicketCheck.rows.length > 0) {
        console.log(`✅ Ticket #${sha256Result} EXISTS`);
        console.log("Owner:", calcTicketCheck.rows[0].wallet_address);
      } else {
        console.log(
          `❌ Ticket #${sha256Result} DOES NOT EXIST (sparse numbering)`,
        );
      }
    }
  } catch (err) {
    console.error("Error:", err.message);
    console.error(err.stack);
  } finally {
    client.release();
    await pool.end();
  }
}

checkMismatch();
