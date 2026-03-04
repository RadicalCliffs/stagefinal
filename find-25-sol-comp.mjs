import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  host: 'aws-0-ap-south-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.mthwfldcjvpxjtmrqkqm',
  password: 'mINEr00m881!',
  ssl: { rejectUnauthorized: false }
});

async function check25Sol() {
  const client = await pool.connect();
  try {
    // Find 25 SOL competition
    const compResult = await client.query(`
      SELECT id, title, outcomes_vrf_seed, tickets_sold, winner_address
      FROM competitions
      WHERE title ILIKE '%25%SOL%' OR title ILIKE '%25 SOL%'
      LIMIT 5
    `);
    
    console.log('\n=== 25 SOL COMPETITIONS ===\n');
    console.log(JSON.stringify(compResult.rows, null, 2));
    
    if (compResult.rows.length > 0) {
      const comp = compResult.rows[0];
      console.log('\n=== TESTING VRF CALCULATION ===');
      console.log('Competition ID:', comp.id);
      console.log('VRF Seed:', comp.outcomes_vrf_seed);
      console.log('Tickets Sold:', comp.tickets_sold);
      
      // Get winning ticket from winners table
      const winnerResult = await client.query(`
        SELECT ticket_number, wallet_address
        FROM winners
        WHERE competition_id = $1
      `, [comp.id]);
      
      if (winnerResult.rows.length > 0) {
        console.log('Winning Ticket:', winnerResult.rows[0].ticket_number);
        console.log('Winner Address:', winnerResult.rows[0].wallet_address);
      }
    }
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

check25Sol();
