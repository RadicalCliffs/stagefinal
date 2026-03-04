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

async function deleteZeroEntryCompetitionsBatch() {
  try {
    await client.connect();
    console.log("✅ Connected\n");

    // Find competitions with 0 tickets
    console.log("Finding competitions with 0 entries...\n");

    const zeroEntryComps = await client.query(`
      SELECT c.id, c.title
      FROM competitions c
      WHERE NOT EXISTS (SELECT 1 FROM tickets WHERE competition_id = c.id)
      ORDER BY c.created_at DESC
    `);

    if (zeroEntryComps.rows.length === 0) {
      console.log("✅ No competitions with 0 entries found\n");
      return;
    }

    console.log(
      `Found ${zeroEntryComps.rows.length} competitions with 0 entries\n`,
    );
    zeroEntryComps.rows.slice(0, 10).forEach((comp) => {
      console.log(`  - ${comp.title}`);
    });
    if (zeroEntryComps.rows.length > 10) {
      console.log(`  ... and ${zeroEntryComps.rows.length - 10} more\n`);
    }

    const compIds = zeroEntryComps.rows.map((c) => c.id);

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("Deleting in batch...\n");

    // Delete from related tables in batch
    const deleteResults = await Promise.all([
      client.query(
        "DELETE FROM competition_entries WHERE competition_id = ANY($1::uuid[])",
        [compIds],
      ),
      client.query(
        "DELETE FROM winners WHERE competition_id = ANY($1::uuid[])",
        [compIds],
      ),
      client.query(
        "DELETE FROM competition_winners WHERE competitionid = ANY($1::uuid[])",
        [compIds],
      ),
      client.query(
        "DELETE FROM tickets WHERE competition_id = ANY($1::uuid[])",
        [compIds],
      ),
      client.query(
        "DELETE FROM joincompetition WHERE competition_id = ANY($1::uuid[])",
        [compIds],
      ),
    ]);

    console.log(`Deleted from related tables`);

    // Delete the competitions
    const result = await client.query(
      "DELETE FROM competitions WHERE id = ANY($1::uuid[])",
      [compIds],
    );

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`✅ Deleted ${result.rowCount} competitions with 0 entries`);
  } catch (err) {
    console.error("❌ Error:", err.message);
    console.error(err);
  } finally {
    await client.end();
  }
}

deleteZeroEntryCompetitionsBatch();
