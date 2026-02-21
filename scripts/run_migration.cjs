const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const client = new Client({
  host: 'aws-1-ap-south-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.mthwfldcjvpxjtmrqkqm',
  password: 'LetsF4ckenGo!',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  console.log('Connected to Supabase\n');

  // Read the migration file
  const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260221100000_unify_balance_system.sql');
  const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
  
  console.log('=== Running Migration ===\n');
  console.log('Migration file:', migrationPath);
  console.log('SQL length:', migrationSQL.length, 'chars\n');

  try {
    // Run the migration
    await client.query(migrationSQL);
    console.log('✅ Migration completed successfully!\n');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    if (err.detail) console.error('Detail:', err.detail);
    if (err.hint) console.error('Hint:', err.hint);
    if (err.position) {
      const lines = migrationSQL.slice(0, parseInt(err.position)).split('\n');
      console.error('At line:', lines.length);
      console.error('Context:', migrationSQL.slice(Math.max(0, parseInt(err.position) - 100), parseInt(err.position) + 100));
    }
    process.exit(1);
  }

  // Verify results
  console.log('=== Post-Migration Verification ===\n');

  // Check column rename
  const col = await client.query(`
    SELECT column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_name = 'canonical_users'
    AND column_name IN ('usdc_balance', 'available_balance')
  `);
  console.log('canonical_users columns:');
  col.rows.forEach(r => console.log('  -', r.column_name, ':', r.data_type, 'DEFAULT', r.column_default));
  console.log('');

  // Check currency defaults
  const currCols = await client.query(`
    SELECT table_name, column_name, column_default
    FROM information_schema.columns
    WHERE column_name = 'currency'
    AND table_name IN ('user_transactions', 'orders', 'sub_account_balances')
  `);
  console.log('Currency column defaults:');
  currCols.rows.forEach(r => console.log('  -', r.table_name + '.currency DEFAULT', r.column_default));
  console.log('');

  // Check USDC row counts
  const usdcSab = await client.query(`SELECT COUNT(*) FROM sub_account_balances WHERE currency = 'USDC'`);
  const usdcTx = await client.query(`SELECT COUNT(*) FROM user_transactions WHERE currency = 'USDC'`);
  const usdcOrd = await client.query(`SELECT COUNT(*) FROM orders WHERE currency = 'USDC'`);
  console.log('USDC row counts (should all be 0):');
  console.log('  - sub_account_balances:', usdcSab.rows[0].count);
  console.log('  - user_transactions:', usdcTx.rows[0].count);
  console.log('  - orders:', usdcOrd.rows[0].count);
  console.log('');

  // Check functions still referencing usdc_balance
  const funcs = await client.query(`
    SELECT proname 
    FROM pg_proc p 
    JOIN pg_namespace n ON p.pronamespace = n.oid 
    WHERE n.nspname = 'public' 
    AND prosrc ILIKE '%usdc_balance%' 
    ORDER BY proname
  `);
  console.log('Functions still referencing usdc_balance (should be 0):');
  funcs.rows.forEach(r => console.log('  ⚠️', r.proname));
  console.log('Total:', funcs.rows.length);

  await client.end();
  console.log('\nDone!');
}

run().catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
