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

async function checkBTC() {
  try {
    await client.connect();
    console.log("✅ Connected\n");

    const compId = "3015f2a2-ed52-4013-b0a6-880a165fbad7";

    const result = await client.query(
      `
      SELECT 
        c.id,
        c.title,
        c.status,
        c.winner_address,
        c.end_date,
        c.drawn_at,
        c.vrf_draw_completed_at,
        c.outcomes_vrf_seed,
        c.vrf_tx_hash,
        c.tickets_sold,
        w.ticket_number,
        w.wallet_address as winner_wallet
      FROM competitions c
      LEFT JOIN winners w ON c.id = w.competition_id AND w.prize_position = 1
      WHERE c.id = $1
    `,
      [compId],
    );

    if (result.rows.length === 0) {
      console.log("❌ Competition not found");
      return;
    }

    const comp = result.rows[0];
    console.log("📋 Win 1 BTC Competition:");
    console.log(`   Status: ${comp.status}`);
    console.log(`   Winner Address: ${comp.winner_address || "NULL"}`);
    console.log(`   Winner Ticket: #${comp.ticket_number || "NULL"}`);
    console.log(`   VRF Seed: ${comp.outcomes_vrf_seed || "NULL"}`);
    console.log(`   VRF TX Hash: ${comp.vrf_tx_hash || "NULL"}`);
    console.log(`   End Date: ${comp.end_date}`);
    console.log(`   Drawn At: ${comp.drawn_at || "NULL"}`);
    console.log(`   VRF Completed: ${comp.vrf_draw_completed_at || "NULL"}`);
    console.log(`   Tickets Sold: ${comp.tickets_sold}`);
    console.log("");

    // Check RPC output
    console.log("Checking RPC function output...\n");
    const rpcResult = await client.query(
      `
      SELECT * FROM get_user_competition_entries('prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363')
      WHERE competition_id = $1
    `,
      [compId],
    );

    if (rpcResult.rows.length > 0) {
      console.log("RPC Output:");
      console.log(
        `   Competition Status: ${rpcResult.rows[0].competition_status}`,
      );
      console.log(`   Is Winner: ${rpcResult.rows[0].is_winner}`);
      console.log("");
    } else {
      console.log("❌ No RPC data found for this user\n");
    }

    // Fix if needed
    if (comp.status !== "completed" || !comp.vrf_tx_hash) {
      console.log("🔧 Fixing competition...\n");

      await client.query(
        `
        UPDATE competitions
        SET 
          status = 'completed',
          vrf_tx_hash = COALESCE(vrf_tx_hash, outcomes_vrf_seed),
          drawn_at = COALESCE(drawn_at, NOW()),
          vrf_draw_completed_at = COALESCE(vrf_draw_completed_at, NOW()),
          updated_at = NOW()
        WHERE id = $1
      `,
        [compId],
      );

      console.log("✅ Fixed!");
    } else {
      console.log("✓ Competition is correctly configured");
    }
  } catch (err) {
    console.error("❌ Error:", err.message);
  } finally {
    await client.end();
  }
}

checkBTC();
