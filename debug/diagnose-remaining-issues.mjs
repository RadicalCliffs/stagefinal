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

async function diagnose() {
  try {
    await client.connect();
    console.log("✅ Connected\n");

    // Check stuck competitions
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("Stuck Competitions (19):");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const stuck = await client.query(`
      SELECT id, title, end_date, outcomes_vrf_seed, tickets_sold, status
      FROM competitions
      WHERE end_date < NOW()
        AND outcomes_vrf_seed IS NOT NULL
        AND winner_address IS NULL
        AND is_instant_win = false
        AND tickets_sold > 0
      ORDER BY end_date DESC
      LIMIT 20
    `);

    stuck.rows.forEach((c) => {
      console.log(`${c.title}`);
      console.log(
        `  Status: ${c.status}, Tickets: ${c.tickets_sold}, End: ${c.end_date}`,
      );
      console.log(`  VRF Seed: ${c.outcomes_vrf_seed ? "Yes" : "No"}\n`);
    });

    // Check NULL vrf_tx_hash
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("Competitions with NULL vrf_tx_hash (46):");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const nullVrf = await client.query(`
      SELECT id, title, status, outcomes_vrf_seed, vrf_tx_hash
      FROM competitions
      WHERE status = 'completed'
        AND vrf_tx_hash IS NULL
      LIMIT 20
    `);

    nullVrf.rows.forEach((c) => {
      console.log(`${c.title}`);
      console.log(
        `  Status: ${c.status}, VRF Seed: ${c.outcomes_vrf_seed ? "Yes" : "No"}`,
      );
      console.log(`  VRF TX Hash: ${c.vrf_tx_hash || "NULL"}\n`);
    });

    // Check NULL is_winner entries
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("Entries with NULL is_winner (6):");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const nullIsWinner = await client.query(`
      SELECT ce.competition_id, c.title, c.status, ce.canonical_user_id, ce.wallet_address, ce.is_winner
      FROM competition_entries ce
      INNER JOIN competitions c ON c.id = ce.competition_id
      WHERE c.status = 'completed'
        AND ce.is_winner IS NULL
    `);

    nullIsWinner.rows.forEach((e) => {
      console.log(`${e.title}`);
      console.log(`  User: ${e.canonical_user_id}`);
      console.log(`  Wallet: ${e.wallet_address}`);
      console.log(`  is_winner: ${e.is_winner}\n`);
    });
  } catch (err) {
    console.error("❌ Error:", err.message);
  } finally {
    await client.end();
  }
}

diagnose();
