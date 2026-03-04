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

async function fixRemaining() {
  try {
    await client.connect();
    console.log("✅ Connected\n");

    // Fix the 19 stuck competitions that have status=completed but no winner
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("FIXING 19 STUCK COMPETITIONS");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const stuck = await client.query(`
      SELECT id, title, outcomes_vrf_seed, tickets_sold
      FROM competitions
      WHERE end_date < NOW()
        AND outcomes_vrf_seed IS NOT NULL
        AND winner_address IS NULL
        AND is_instant_win = false
        AND tickets_sold > 0
      ORDER BY end_date DESC
    `);

    console.log(`Found ${stuck.rows.length} stuck competitions\n`);

    for (const comp of stuck.rows) {
      console.log(`Processing: ${comp.title}`);

      const vrfSeed = comp.outcomes_vrf_seed;
      const ticketsSold = comp.tickets_sold;

      // Calculate winning ticket
      const hash = crypto
        .createHash("sha256")
        .update(`SELECT-WINNER-${vrfSeed}-${comp.id}`)
        .digest("hex");
      const winningTicketNumber =
        (parseInt(hash.substring(0, 16), 16) % ticketsSold) + 1;

      console.log(`  Winning ticket: #${winningTicketNumber}`);

      // Find winner
      let winner = await client.query(
        `
        SELECT COALESCE(user_id, canonical_user_id, privy_user_id) as user_id,
               wallet_address, ticket_number
        FROM tickets
        WHERE competition_id = $1 AND ticket_number = $2
        LIMIT 1
      `,
        [comp.id, winningTicketNumber],
      );

      // If exact ticket doesn't exist, find next available
      if (winner.rows.length === 0) {
        console.log(
          `  ⚠️ Ticket #${winningTicketNumber} doesn't exist, finding next...`,
        );

        winner = await client.query(
          `
          SELECT COALESCE(user_id, canonical_user_id, privy_user_id) as user_id,
                 wallet_address, ticket_number
          FROM tickets
          WHERE competition_id = $1 AND ticket_number >= $2
          ORDER BY ticket_number ASC
          LIMIT 1
        `,
          [comp.id, winningTicketNumber],
        );

        if (winner.rows.length === 0) {
          winner = await client.query(
            `
            SELECT COALESCE(user_id, canonical_user_id, privy_user_id) as user_id,
                   wallet_address, ticket_number
            FROM tickets
            WHERE competition_id = $1
            ORDER BY ticket_number ASC
            LIMIT 1
          `,
            [comp.id],
          );
        }
      }

      if (winner.rows.length === 0) {
        console.log(`  ❌ No tickets found!\n`);
        continue;
      }

      const w = winner.rows[0];

      // Skip if winner data is incomplete
      if (!w.user_id || !w.wallet_address) {
        console.log(
          `  ❌ Winner data incomplete (user_id: ${w.user_id}, wallet: ${w.wallet_address})\n`,
        );
        continue;
      }

      console.log(`  Winner: ${w.wallet_address} (Ticket #${w.ticket_number})`);

      const now = new Date().toISOString();

      // Update competition
      await client.query(
        `
        UPDATE competitions
        SET winner_address = $1,
            status = 'completed',
            competitionended = 1,
            drawn_at = $2,
            vrf_draw_completed_at = $2,
            vrf_tx_hash = $3,
            updated_at = $2
        WHERE id = $4
      `,
        [w.wallet_address, now, vrfSeed, comp.id],
      );

      // Insert into winners table
      await client.query(
        `
        INSERT INTO winners (
          competition_id, user_id, wallet_address, ticket_number,
          prize_position, won_at, created_at, is_instant_win
        )
        SELECT $1, $2, $3, $4, 1, $5, $5, false
        WHERE NOT EXISTS (
          SELECT 1 FROM winners 
          WHERE competition_id = $1 AND prize_position = 1
        )
      `,
        [comp.id, w.user_id, w.wallet_address, w.ticket_number, now],
      );

      // Set is_winner flags for all entries
      await client.query(
        `
        UPDATE competition_entries
        SET is_winner = true
        WHERE competition_id = $1
          AND (canonical_user_id = $2 OR wallet_address ILIKE $3)
      `,
        [comp.id, w.user_id, w.wallet_address],
      );

      await client.query(
        `
        UPDATE competition_entries
        SET is_winner = false
        WHERE competition_id = $1
          AND canonical_user_id != $2
          AND wallet_address NOT ILIKE $3
      `,
        [comp.id, w.user_id, w.wallet_address],
      );

      console.log(`  ✅ Fixed\n`);
    }

    // Fix the 6 NULL is_winner entries
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("FIXING 6 NULL IS_WINNER ENTRIES");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const nullEntries = await client.query(`
      SELECT ce.competition_id, c.title, ce.canonical_user_id, ce.wallet_address
      FROM competition_entries ce
      INNER JOIN competitions c ON c.id = ce.competition_id
      WHERE c.status = 'completed'
        AND ce.is_winner IS NULL
    `);

    console.log(
      `Found ${nullEntries.rows.length} entries with NULL is_winner\n`,
    );

    for (const entry of nullEntries.rows) {
      console.log(`Competition: ${entry.title}`);
      console.log(`  User: ${entry.canonical_user_id}`);

      // Check if they're a winner
      const isWinner = await client.query(
        `
        SELECT 1 FROM winners
        WHERE competition_id = $1
          AND (user_id = $2 OR wallet_address ILIKE $3)
        LIMIT 1
      `,
        [entry.competition_id, entry.canonical_user_id, entry.wallet_address],
      );

      const winnerFlag = isWinner.rows.length > 0;
      console.log(`  Is Winner: ${winnerFlag}`);

      await client.query(
        `
        UPDATE competition_entries
        SET is_winner = $1
        WHERE competition_id = $2
          AND canonical_user_id = $3
      `,
        [winnerFlag, entry.competition_id, entry.canonical_user_id],
      );

      console.log(`  ✅ Updated\n`);
    }

    // Final verification
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("FINAL VERIFICATION");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const stuckCount = await client.query(`
      SELECT COUNT(*) as count
      FROM competitions
      WHERE end_date < NOW()
        AND outcomes_vrf_seed IS NOT NULL
        AND winner_address IS NULL
        AND is_instant_win = false
        AND tickets_sold > 0
    `);

    const nullIsWinnerCount = await client.query(`
      SELECT COUNT(*) as count
      FROM competition_entries ce
      INNER JOIN competitions c ON c.id = ce.competition_id
      WHERE c.status = 'completed'
        AND ce.is_winner IS NULL
    `);

    console.log(`✅ Stuck competitions remaining: ${stuckCount.rows[0].count}`);
    console.log(
      `✅ Entries with NULL is_winner: ${nullIsWinnerCount.rows[0].count}`,
    );
  } catch (err) {
    console.error("❌ Error:", err.message);
    console.error(err);
  } finally {
    await client.end();
  }
}

fixRemaining();
