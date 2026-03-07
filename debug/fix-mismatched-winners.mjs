import pg from "pg";
import crypto from "crypto";
const { Client } = pg;

const client = new Client({
  host: "aws-1-ap-south-1.pooler.supabase.com",
  port: 5432,
  database: "postgres",
  user: "postgres.mthwfldcjvpxjtmrqkqm",
  password: "iamclaudeandiamafuckingretard",
  ssl: { rejectUnauthorized: false },
});

/**
 * Calculate winning ticket using SHA256
 */
function calculateWinningTicket(vrfSeed, competitionId, ticketsSold) {
  const message = `SELECT-WINNER-${vrfSeed}-${competitionId}`;
  const hash = crypto.createHash("sha256").update(message).digest("hex");
  const first16 = hash.substring(0, 16);
  const hashBigInt = BigInt("0x" + first16);
  return Number(hashBigInt % BigInt(ticketsSold)) + 1;
}

async function fixMismatchedCompetitions() {
  try {
    await client.connect();
    console.log("✅ Connected to database\n");

    // Get all finished competitions
    const result = await client.query(`
      SELECT  DISTINCT
        c.id,
        c.title,
        c.winner_address,
        c.outcomes_vrf_seed,
        c.tickets_sold
      FROM competitions c
      WHERE c.winner_address IS NOT NULL
        AND c.outcomes_vrf_seed IS NOT NULL
        AND c.is_instant_win = false
      ORDER BY c.id
    `);

    console.log(`Found ${result.rows.length} competitions to check\n`);

    let fixed = 0;

    for (const comp of result.rows) {
      const calculatedTicket = calculateWinningTicket(
        comp.outcomes_vrf_seed,
        comp.id,
        comp.tickets_sold,
      );

      // Check if ticket exists
      const ticketCheck = await client.query(
        `
        SELECT ticket_number, wallet_address,
               COALESCE(user_id, canonical_user_id, privy_user_id) as user_id
        FROM tickets
        WHERE competition_id = $1 AND ticket_number = $2
        LIMIT 1
      `,
        [comp.id, calculatedTicket],
      );

      let winningTicketNumber = calculatedTicket;
      let winnerUserId = null;
      let winnerAddress = null;

      if (ticketCheck.rows.length > 0) {
        winningTicketNumber = ticketCheck.rows[0].ticket_number;
        winnerUserId = ticketCheck.rows[0].user_id;
        winnerAddress = ticketCheck.rows[0].wallet_address;
      } else {
        // Find next available ticket
        const nextTicket = await client.query(
          `
          SELECT ticket_number, wallet_address,
                 COALESCE(user_id, canonical_user_id, privy_user_id) as user_id
          FROM tickets
          WHERE competition_id = $1 AND ticket_number >= $2
          ORDER BY ticket_number ASC LIMIT 1
        `,
          [comp.id, calculatedTicket],
        );

        if (nextTicket.rows.length > 0) {
          winningTicketNumber = nextTicket.rows[0].ticket_number;
          winnerUserId = nextTicket.rows[0].user_id;
          winnerAddress = nextTicket.rows[0].wallet_address;
        } else {
          // Wrap around to first ticket
          const firstTicket = await client.query(
            `
            SELECT ticket_number, wallet_address,
                   COALESCE(user_id, canonical_user_id, privy_user_id) as user_id
            FROM tickets
            WHERE competition_id = $1
            ORDER BY ticket_number ASC LIMIT 1
          `,
            [comp.id],
          );

          if (firstTicket.rows.length > 0) {
            winningTicketNumber = firstTicket.rows[0].ticket_number;
            winnerUserId = firstTicket.rows[0].user_id;
            winnerAddress = firstTicket.rows[0].wallet_address;
          }
        }
      }

      // Check current winner data
      const currentWinner = await client.query(
        `
        SELECT ticket_number FROM winners
        WHERE competition_id = $1 AND prize_position = 1
        LIMIT 1
      `,
        [comp.id],
      );

      const currentTicket = currentWinner.rows[0]?.ticket_number || null;

      if (currentTicket !== winningTicketNumber) {
        console.log(`🔧 Fixing: ${comp.title}`);
        console.log(
          `   Old ticket: #${currentTicket || "NULL"} → New ticket: #${winningTicketNumber}`,
        );

        // Begin transaction
        await client.query("BEGIN");

        try {
          // Clear old winners
          await client.query("DELETE FROM winners WHERE competition_id = $1", [
            comp.id,
          ]);
          await client.query(
            "DELETE FROM competition_winners WHERE competitionid = $1",
            [comp.id],
          );
          await client.query(
            "UPDATE joincompetition SET is_winner = false WHERE competition_id = $1",
            [comp.id],
          );

          // Insert new winner
          await client.query(
            `
            INSERT INTO winners (
              competition_id, user_id, wallet_address, ticket_number,
              prize_position, won_at, created_at, is_instant_win
            ) VALUES ($1, $2, $3, $4, 1, NOW(), NOW(), false)
          `,
            [comp.id, winnerUserId, winnerAddress, winningTicketNumber],
          );

          await client.query(
            `
            INSERT INTO competition_winners (
              competitionid, Winner, ticket_number,user_id, won_at
            ) VALUES ($1, $2, $3, $4, NOW())
          `,
            [comp.id, winnerAddress, winningTicketNumber, winnerUserId],
          );

          if (winnerUserId) {
            await client.query(
              `
              UPDATE joincompetition SET is_winner = true
              WHERE competition_id = $1 AND user_id = $2
            `,
              [comp.id, winnerUserId],
            );
          }

          await client.query("COMMIT");
          console.log(`   ✅ Fixed!\n`);
          fixed++;
        } catch (err) {
          await client.query("ROLLBACK");
          console.error(`   ❌ Error fixing ${comp.title}:`, err.message);
        }
      }
    }

    console.log(`\n✅ Fixed ${fixed} competitions`);
  } catch (err) {
    console.error("❌ Error:", err.message);
  } finally {
    await client.end();
  }
}

fixMismatchedCompetitions();
