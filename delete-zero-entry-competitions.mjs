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

async function deleteZeroEntryCompetitions() {
  try {
    await client.connect();
    console.log("✅ Connected\n");

    // Find competitions with 0 tickets
    console.log("Finding competitions with 0 entries...\n");

    const zeroEntryComps = await client.query(`
      SELECT c.id, c.title, c.status, c.tickets_sold, 
             COALESCE((SELECT COUNT(*) FROM tickets WHERE competition_id = c.id), 0) as actual_ticket_count
      FROM competitions c
      WHERE c.tickets_sold = 0
         OR NOT EXISTS (SELECT 1 FROM tickets WHERE competition_id = c.id)
      ORDER BY c.created_at DESC
    `);

    if (zeroEntryComps.rows.length === 0) {
      console.log("✅ No competitions with 0 entries found\n");
      return;
    }

    console.log(
      `Found ${zeroEntryComps.rows.length} competitions with 0 entries:\n`,
    );

    zeroEntryComps.rows.forEach((comp) => {
      console.log(`  ${comp.title}`);
      console.log(`    ID: ${comp.id}`);
      console.log(`    Status: ${comp.status}`);
      console.log(`    Tickets Sold: ${comp.tickets_sold}`);
      console.log(`    Actual Tickets: ${comp.actual_ticket_count}\n`);
    });

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("Deleting competitions...\n");

    // Delete from all related tables
    for (const comp of zeroEntryComps.rows) {
      console.log(`Deleting: ${comp.title}`);

      // Delete from related tables first
      await client.query(
        "DELETE FROM competition_entries WHERE competition_id = $1",
        [comp.id],
      );
      await client.query("DELETE FROM winners WHERE competition_id = $1", [
        comp.id,
      ]);
      await client.query(
        "DELETE FROM competition_winners WHERE competitionid = $1",
        [comp.id],
      );
      await client.query("DELETE FROM tickets WHERE competition_id = $1", [
        comp.id,
      ]);
      await client.query(
        "DELETE FROM joincompetition WHERE competition_id = $1",
        [comp.id],
      );

      // Delete the competition itself
      await client.query("DELETE FROM competitions WHERE id = $1", [comp.id]);

      console.log(`  ✅ Deleted\n`);
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(
      `✅ Deleted ${zeroEntryComps.rows.length} competitions with 0 entries`,
    );
  } catch (err) {
    console.error("❌ Error:", err.message);
    console.error(err);
  } finally {
    await client.end();
  }
}

deleteZeroEntryCompetitions();
