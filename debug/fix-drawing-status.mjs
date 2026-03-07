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

async function checkDrawingCompetitions() {
  try {
    await client.connect();
    console.log("✅ Connected\n");

    // Find competitions showing as "drawing" but with winners
    const result = await client.query(`
      SELECT 
        c.id,
        c.title,
        c.status,
        c.winner_address,
        c.end_date,
        c.drawn_at,
        c.outcomes_vrf_seed,
        w.ticket_number
      FROM competitions c
      LEFT JOIN winners w ON c.id = w.competition_id AND w.prize_position = 1
      WHERE c.status = 'drawing'
        OR (c.end_date < NOW() AND c.winner_address IS NOT NULL AND c.status != 'completed')
      ORDER BY c.end_date DESC
    `);

    console.log(
      `Found ${result.rows.length} competitions with incorrect status\n`,
    );

    for (const comp of result.rows) {
      console.log(`📋 ${comp.title}`);
      console.log(`   ID: ${comp.id}`);
      console.log(`   Status: ${comp.status}`);
      console.log(`   Winner: ${comp.winner_address || "NULL"}`);
      console.log(`   Winning Ticket: #${comp.ticket_number || "NULL"}`);
      console.log(`   End Date: ${comp.end_date}`);
      console.log(`   Drawn At: ${comp.drawn_at || "NULL"}`);
      console.log("");
    }

    // Fix all of them
    if (result.rows.length > 0) {
      console.log("🔧 Fixing statuses...\n");

      await client.query(`
        UPDATE competitions
        SET status = 'completed', updated_at = NOW()
        WHERE (status = 'drawing' OR status != 'completed')
          AND winner_address IS NOT NULL
          AND end_date < NOW()
      `);

      console.log('✅ All competitions with winners set to "completed" status');
    }
  } catch (err) {
    console.error("❌ Error:", err.message);
  } finally {
    await client.end();
  }
}

checkDrawingCompetitions();
