import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

const client = new Client({
  host: 'aws-1-ap-south-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.mthwfldcjvpxjtmrqkqm',
  password: 'iamclaudeandiamafuckingretard',
  ssl: { rejectUnauthorized: false }
});

async function applyFix() {
  try {
    await client.connect();
    console.log('✅ Connected\n');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('FIXING RPC PERFORMANCE ISSUE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const sql = fs.readFileSync('FIX_RPC_PERFORMANCE.sql', 'utf8');
    await client.query(sql);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ RPC OPTIMIZED SUCCESSFULLY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error(err);
  } finally {
    await client.end();
  }
}

applyFix();
