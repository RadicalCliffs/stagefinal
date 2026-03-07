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

async function checkTickets() {
  try {
    await client.connect();
    console.log("=== CHECKING $1000 TICKETS ===\n");

    // Get competition
    const compResult = await client.query(`
      SELECT id, title, tickets_sold, outcomes_vrf_seed
      FROM competitions
      WHERE title = '$1000'
    `);

    if (compResult.rows.length === 0) {
      console.log("❌ Competition not found");
      await client.end();
      return;
    }

    const comp = compResult.rows[0];
    console.log(`Competition: ${comp.title}`);
    console.log(`Tickets Sold: ${comp.tickets_sold}`);
    console.log(`VRF Seed: ${comp.outcomes_vrf_seed ? comp.outcomes_vrf_seed.substring(0, 16) + '...' : 'NULL'}\n`);

    // Count actual tickets
    const ticketCountResult = await client.query(`
      SELECT COUNT(*) as count, MIN(ticket_number) as min_ticket, MAX(ticket_number) as max_ticket
      FROM tickets
      WHERE competition_id = $1
    `, [comp.id]);

    console.log("Tickets in database:");
    console.log(`  Count: ${ticketCountResult.rows[0].count}`);
    console.log(`  Range: ${ticketCountResult.rows[0].min_ticket} to ${ticketCountResult.rows[0].max_ticket}\n`);

    // Get sample tickets
    const sampleResult = await client.query(`
      SELECT ticket_number, user_id, wallet_address
      FROM tickets
      WHERE competition_id = $1
      ORDER BY ticket_number
      LIMIT 5
    `, [comp.id]);

    console.log("Sample tickets:");
    sampleResult.rows.forEach((t) => {
      console.log(`  Ticket #${t.ticket_number}: ${t.wallet_address}`);
    });

    // Calculate what the winning ticket should be
    if (comp.outcomes_vrf_seed) {
      const crypto = await import('crypto');
      const hash = crypto.createHash('sha256')
        .update('SELECT-WINNER-' + comp.outcomes_vrf_seed + '-' + comp.id)
        .digest('hex');
      
      const hashValue = BigInt('0x' + hash.substring(0, 16));
      const winningTicket = Number(hashValue % BigInt(comp.tickets_sold)) + 1;
      
      console.log(`\nCalculated winning ticket: #${winningTicket}`);
      
      // Check if this ticket exists
      const winnerResult = await client.query(`
        SELECT ticket_number, user_id, wallet_address
        FROM tickets
        WHERE competition_id = $1 AND ticket_number = $2
      `, [comp.id, winningTicket]);
      
      if (winnerResult.rows.length > 0) {
        console.log(`✅ Winner found:`);
        console.log(`   Ticket #${winnerResult.rows[0].ticket_number}`);
        console.log(`   User: ${winnerResult.rows[0].user_id}`);
        console.log(`   Wallet: ${winnerResult.rows[0].wallet_address}`);
      } else {
        console.log(`❌ Ticket #${winningTicket} does NOT exist in database`);
        
        // Find closest ticket
        const closestResult = await client.query(`
          SELECT ticket_number, user_id, wallet_address
          FROM tickets
          WHERE competition_id = $1
          ORDER BY ABS(ticket_number - $2)
          LIMIT 1
        `, [comp.id, winningTicket]);
        
        if (closestResult.rows.length > 0) {
          console.log(`   Closest ticket: #${closestResult.rows[0].ticket_number}`);
        }
      }
    }

    await client.end();
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error(error);
    await client.end();
  }
}

checkTickets();
