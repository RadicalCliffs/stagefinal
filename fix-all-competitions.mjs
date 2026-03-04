import pg from "pg";
import fs from "fs";
const { Client } = pg;

const client = new Client({
  host: "aws-1-ap-south-1.pooler.supabase.com",
  port: 5432,
  database: "postgres",
  user: "postgres.mthwfldcjvpxjtmrqkqm",
  password: "iamclaudeandiamafuckingretard",
  ssl: { rejectUnauthorized: false },
});

async function fixAll() {
  try {
    await client.connect();
    console.log("✅ Connected\n");

    // Step 1: Run the SQL script to complete all stuck competitions
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("STEP 1: Completing all stuck VRF competitions");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const sql = fs.readFileSync("FIX_ALL_STUCK_VRF_COMPETITIONS.sql", "utf8");
    await client.query(sql);
    console.log("\n✅ Completed stuck competitions\n");

    // Step 2: Fix vrf_tx_hash for all completed competitions
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("STEP 2: Fixing vrf_tx_hash for all competitions");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const nullVrfResult = await client.query(`
      UPDATE competitions
      SET vrf_tx_hash = COALESCE(vrf_tx_hash, outcomes_vrf_seed)
      WHERE status = 'completed'
        AND vrf_tx_hash IS NULL
        AND outcomes_vrf_seed IS NOT NULL
      RETURNING id, title
    `);

    console.log(
      `Fixed ${nullVrfResult.rowCount} competitions with NULL vrf_tx_hash\n`,
    );

    // Step 3: Fix is_winner flags for ALL competitions
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("STEP 3: Fixing is_winner flags for all competitions");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    // Get all completed competitions with winners
    const competitions = await client.query(`
      SELECT c.id, c.title, w.user_id as winner_user_id, w.wallet_address as winner_wallet
      FROM competitions c
      INNER JOIN winners w ON w.competition_id = c.id AND w.prize_position = 1
      WHERE c.status = 'completed'
    `);

    console.log(
      `Found ${competitions.rows.length} completed competitions with winners\n`,
    );

    for (const comp of competitions.rows) {
      // Set winner
      const winnerUpdate = await client.query(
        `
        UPDATE competition_entries
        SET is_winner = true
        WHERE competition_id = $1
          AND (canonical_user_id = $2 OR wallet_address ILIKE $3)
      `,
        [comp.id, comp.winner_user_id, comp.winner_wallet],
      );

      // Set losers
      const loserUpdate = await client.query(
        `
        UPDATE competition_entries
        SET is_winner = false
        WHERE competition_id = $1
          AND canonical_user_id != $2
          AND wallet_address NOT ILIKE $3
      `,
        [comp.id, comp.winner_user_id, comp.winner_wallet],
      );

      console.log(
        `✓ ${comp.title}: Set ${winnerUpdate.rowCount} winner(s), ${loserUpdate.rowCount} loser(s)`,
      );
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("✅ ALL COMPETITIONS FIXED!");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    // Verification
    console.log("Verification:");
    const pending = await client.query(`
      SELECT COUNT(*) as count
      FROM competitions
      WHERE end_date < NOW()
        AND outcomes_vrf_seed IS NOT NULL
        AND winner_address IS NULL
        AND is_instant_win = false
        AND tickets_sold > 0
    `);

    console.log(`Stuck competitions remaining: ${pending.rows[0].count}`);

    const nullVrf = await client.query(`
      SELECT COUNT(*) as count
      FROM competitions
      WHERE status = 'completed'
        AND vrf_tx_hash IS NULL
    `);

    console.log(`Competitions with NULL vrf_tx_hash: ${nullVrf.rows[0].count}`);

    const nullIsWinner = await client.query(`
      SELECT COUNT(*) as count
      FROM competition_entries ce
      INNER JOIN competitions c ON c.id = ce.competition_id
      WHERE c.status = 'completed'
        AND ce.is_winner IS NULL
    `);

    console.log(`Entries with NULL is_winner: ${nullIsWinner.rows[0].count}`);
  } catch (err) {
    console.error("❌ Error:", err.message);
    console.error(err);
  } finally {
    await client.end();
  }
}

fixAll();
