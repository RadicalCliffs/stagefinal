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
 * Calculate winning ticket using SHA256 (same as frontend and backend)
 */
function calculateWinningTicket(vrfSeed, competitionId, ticketsSold) {
  const message = `SELECT-WINNER-${vrfSeed}-${competitionId}`;
  const hash = crypto.createHash("sha256").update(message).digest("hex");
  const first16 = hash.substring(0, 16);
  const hashBigInt = BigInt("0x" + first16);
  return Number(hashBigInt % BigInt(ticketsSold)) + 1;
}

async function verifyConsistency() {
  try {
    await client.connect();
    console.log("✅ Connected to database\n");

    // Fetch all finished competitions with winners
    const result = await client.query(`
      SELECT 
        c.id,
        c.title,
        c.winner_address,
        c.outcomes_vrf_seed,
        c.tickets_sold,
        w.ticket_number as winner_ticket_from_winners,
        cw.ticket_number as winner_ticket_from_competition_winners
      FROM competitions c
      LEFT JOIN winners w ON c.id = w.competition_id AND w.prize_position = 1
      LEFT JOIN competition_winners cw ON c.id = cw.competitionid
      WHERE c.winner_address IS NOT NULL
        AND c.outcomes_vrf_seed IS NOT NULL
        AND c.is_instant_win = false
      ORDER BY c.end_date DESC
      LIMIT 20
    `);

    console.log(`Found ${result.rows.length} finished competitions\n`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    let allConsistent = true;
    let mismatches = 0;

    for (const comp of result.rows) {
      const calculatedTicket = calculateWinningTicket(
        comp.outcomes_vrf_seed,
        comp.id,
        comp.tickets_sold,
      );

      // Check ticket existence and get actual winning ticket
      const ticketResult = await client.query(
        `
        SELECT ticket_number, wallet_address
        FROM tickets
        WHERE competition_id = $1 AND ticket_number = $2
        LIMIT 1
      `,
        [comp.id, calculatedTicket],
      );

      let actualWinningTicket = calculatedTicket;

      // If calculated ticket doesn't exist, find next available (wraparound logic)
      if (ticketResult.rows.length === 0) {
        const nextTicket = await client.query(
          `
          SELECT ticket_number FROM tickets
          WHERE competition_id = $1 AND ticket_number >= $2
          ORDER BY ticket_number ASC LIMIT 1
        `,
          [comp.id, calculatedTicket],
        );

        if (nextTicket.rows.length > 0) {
          actualWinningTicket = nextTicket.rows[0].ticket_number;
        } else {
          const firstTicket = await client.query(
            `
            SELECT ticket_number FROM tickets
            WHERE competition_id = $1
            ORDER BY ticket_number ASC LIMIT 1
          `,
            [comp.id],
          );

          if (firstTicket.rows.length > 0) {
            actualWinningTicket = firstTicket.rows[0].ticket_number;
          }
        }
      }

      const winnersMatch =
        comp.winner_ticket_from_winners === actualWinningTicket;
      const competitionWinnersMatch =
        comp.winner_ticket_from_competition_winners === actualWinningTicket;
      const tablesMatch =
        comp.winner_ticket_from_winners ===
        comp.winner_ticket_from_competition_winners;

      console.log(`📋 ${comp.title}`);
      console.log(`   Competition ID: ${comp.id}`);
      console.log(`   Winner Address: ${comp.winner_address}`);
      console.log(`   Calculated Ticket (SHA256): #${calculatedTicket}`);
      console.log(`   Actual Winning Ticket: #${actualWinningTicket}`);
      console.log(
        `   Winners Table: #${comp.winner_ticket_from_winners || "NULL"}`,
      );
      console.log(
        `   Competition_Winners Table: #${comp.winner_ticket_from_competition_winners || "NULL"}`,
      );

      if (winnersMatch && competitionWinnersMatch && tablesMatch) {
        console.log(`   ✅ All consistent!`);
      } else {
        console.log(`   ❌ MISMATCH DETECTED:`);
        if (!winnersMatch) {
          console.log(
            `      - Winners table doesn't match: expected #${actualWinningTicket}, got #${comp.winner_ticket_from_winners}`,
          );
        }
        if (!competitionWinnersMatch) {
          console.log(
            `      - Competition_winners table doesn't match: expected #${actualWinningTicket}, got #${comp.winner_ticket_from_competition_winners}`,
          );
        }
        if (!tablesMatch) {
          console.log(`      - Tables don't match each other`);
        }
        allConsistent = false;
        mismatches++;
      }
      console.log("");
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    if (allConsistent) {
      console.log("✅ ALL COMPETITIONS ARE CONSISTENT!");
      console.log(
        'Frontend VRF verification will now show "Winner Verified" for all competitions.',
      );
    } else {
      console.log(`❌ Found ${mismatches} competitions with mismatches.`);
      console.log(
        "These competitions may show verification errors on the frontend.",
      );
    }

    console.log("\n🎯 Summary:");
    console.log(`   Total Checked: ${result.rows.length}`);
    console.log(`   Consistent: ${result.rows.length - mismatches}`);
    console.log(`   Mismatches: ${mismatches}`);
  } catch (err) {
    console.error("❌ Error:", err.message);
    console.error(err.stack);
  } finally {
    await client.end();
  }
}

verifyConsistency();
