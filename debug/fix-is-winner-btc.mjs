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

async function fixIsWinner() {
  console.log("Starting...");
  try {
    console.log("Connecting to database...");
    await client.connect();
    console.log("✅ Connected\n");

    const compId = "3015f2a2-ed52-4013-b0a6-880a165fbad7";

    // Get winner info
    const winner = await client.query(
      `
      SELECT user_id, wallet_address
      FROM winners
      WHERE competition_id = $1 AND prize_position = 1
    `,
      [compId],
    );

    if (winner.rows.length === 0) {
      console.log("❌ No winner found\n");
      return;
    }

    const winnerUserId = winner.rows[0].user_id;
    const winnerWallet = winner.rows[0].wallet_address;

    console.log(`Winner: ${winnerWallet}`);
    console.log(`Winner User ID: ${winnerUserId}\n`);

    // Check competition_entries table
    const entries = await client.query(
      `
      SELECT id, canonical_user_id, wallet_address, is_winner
      FROM competition_entries
      WHERE competition_id = $1
    `,
      [compId],
    );

    console.log(`Found ${entries.rows.length} entries in competition_entries:`);
    entries.rows.forEach((e) => {
      console.log(
        `   User: ${e.canonical_user_id}, Wallet: ${e.wallet_address}, is_winner: ${e.is_winner}`,
      );
    });
    console.log("");

    // Update is_winner for all entries
    console.log("Updating is_winner flags...\n");

    // Set winner
    await client.query(
      `
      UPDATE competition_entries
      SET is_winner = true
      WHERE competition_id = $1
        AND (canonical_user_id = $2 OR wallet_address ILIKE $3)
    `,
      [compId, winnerUserId, winnerWallet],
    );

    // Set losers
    await client.query(
      `
      UPDATE competition_entries
      SET is_winner = false
      WHERE competition_id = $1
        AND canonical_user_id != $2
        AND wallet_address NOT ILIKE $3
    `,
      [compId, winnerUserId, winnerWallet],
    );

    console.log("✅ Updated is_winner flags");

    // Verify
    const updated = await client.query(
      `
      SELECT canonical_user_id, wallet_address, is_winner
      FROM competition_entries
      WHERE competition_id = $1
    `,
      [compId],
    );

    console.log("\nAfter update:");
    updated.rows.forEach((e) => {
      console.log(
        `   User: ${e.canonical_user_id}, Wallet: ${e.wallet_address}, is_winner: ${e.is_winner}`,
      );
    });
  } catch (err) {
    console.error("❌ Error:", err.message);
    console.error(err);
  } finally {
    await client.end();
  }
}

fixIsWinner();
