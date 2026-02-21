const { Client } = require('pg');
const fs = require('fs');

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
  
  // Get function bodies for all usdc_balance functions
  console.log('=== Function bodies (checking UPDATE canonical_users SET usdc_balance) ===');
  const funcBodies = await client.query(`
    SELECT proname, prosrc
    FROM pg_proc p 
    JOIN pg_namespace n ON p.pronamespace = n.oid 
    WHERE n.nspname = 'public' 
    AND prosrc ILIKE '%usdc_balance%' 
    ORDER BY proname
  `);
  
  const criticalFuncs = [];
  funcBodies.rows.forEach(r => {
    const updates = (r.prosrc.match(/SET\s+usdc_balance/gi) || []).length;
    const selects = (r.prosrc.match(/\.usdc_balance|usdc_balance\s*,/gi) || []).length;
    if (updates > 0) {
      console.log('  ⚠️', r.proname, '- UPDATES usdc_balance', updates, 'times');
      criticalFuncs.push({ name: r.proname, src: r.prosrc });
    } else if (selects > 0) {
      console.log('  📖', r.proname, '- READS usdc_balance', selects, 'times');
    }
  });
  console.log('');
  
  // Write critical functions to file for review
  if (criticalFuncs.length > 0) {
    fs.writeFileSync('scripts/critical_funcs.txt', criticalFuncs.map(f => 
      `== ${f.name} ==\n${f.src}\n\n`
    ).join(''));
    console.log('Critical function bodies written to scripts/critical_funcs.txt\n');
  }
  
  // Find all functions referencing usdc_balance
  console.log('=== Functions referencing usdc_balance ===');
  const funcs = await client.query(`
    SELECT proname 
    FROM pg_proc p 
    JOIN pg_namespace n ON p.pronamespace = n.oid 
    WHERE n.nspname = 'public' 
    AND prosrc ILIKE '%usdc_balance%' 
    ORDER BY proname
  `);
  funcs.rows.forEach(r => console.log('  -', r.proname));
  console.log('Total:', funcs.rows.length, '\n');

  // Find all triggers referencing usdc_balance
  console.log('=== Triggers on canonical_users.usdc_balance ===');
  const triggers = await client.query(`
    SELECT tgname, relname 
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE c.relname = 'canonical_users'
    AND NOT tgisinternal
    ORDER BY tgname
  `);
  triggers.rows.forEach(r => console.log('  -', r.tgname, 'on', r.relname));
  console.log('Total:', triggers.rows.length, '\n');

  // Check if usdc_balance column exists
  console.log('=== Column check ===');
  const col = await client.query(`
    SELECT column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_name = 'canonical_users'
    AND column_name IN ('usdc_balance', 'available_balance')
  `);
  col.rows.forEach(r => console.log('  -', r.column_name, ':', r.data_type, 'DEFAULT', r.column_default));
  console.log('');

  // Check currency defaults
  console.log('=== Currency column defaults ===');
  const currCols = await client.query(`
    SELECT table_name, column_name, column_default
    FROM information_schema.columns
    WHERE column_name = 'currency'
    AND table_name IN ('user_transactions', 'orders', 'sub_account_balances')
  `);
  currCols.rows.forEach(r => console.log('  -', r.table_name + '.currency DEFAULT', r.column_default));
  console.log('');

  // Check for USDC rows
  console.log('=== USDC row counts ===');
  const usdcSab = await client.query(`SELECT COUNT(*) FROM sub_account_balances WHERE currency = 'USDC'`);
  console.log('  - sub_account_balances USDC rows:', usdcSab.rows[0].count);
  const usdcTx = await client.query(`SELECT COUNT(*) FROM user_transactions WHERE currency = 'USDC'`);
  console.log('  - user_transactions USDC rows:', usdcTx.rows[0].count);
  const usdcOrd = await client.query(`SELECT COUNT(*) FROM orders WHERE currency = 'USDC'`);
  console.log('  - orders USDC rows:', usdcOrd.rows[0].count);

  await client.end();
}

run().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
