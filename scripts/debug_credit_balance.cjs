const { Client } = require('pg');

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
  console.log('Connected\n');

  // Get ALL credit_user_balance functions
  const funcs = await client.query(`
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args,
           pg_get_function_arguments(p.oid) as full_args
    FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'credit_user_balance'
  `);
  
  console.log('credit_user_balance functions found:');
  funcs.rows.forEach(r => console.log('  OID:', r.oid, 'Args:', r.full_args));

  // Drop literally EVERY credit_user_balance by OID
  console.log('\nDropping by pg_proc.oid...');
  for (const f of funcs.rows) {
    try {
      await client.query(`DROP FUNCTION public.credit_user_balance(uuid, numeric) CASCADE`);
      console.log('  ✅ Dropped direct (uuid, numeric)');
    } catch (e) {
      console.log('  ⚠️ Direct drop:', e.message);
    }
  }

  // Try using regprocedure
  const funcs2 = await client.query(`
    SELECT p.oid::regprocedure::text as sig
    FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'credit_user_balance'
  `);
  
  console.log('\nUsing regprocedure signatures:');
  for (const f of funcs2.rows) {
    console.log('  Sig:', f.sig);
    try {
      // Extract just the types from the signature
      const match = f.sig.match(/\(([^)]*)\)/);
      if (match) {
        const types = match[1].split(',').map(t => t.trim()).join(', ');
        await client.query(`DROP FUNCTION IF EXISTS public.credit_user_balance(${types}) CASCADE`);
        console.log('    ✅ Dropped');
      }
    } catch (e) {
      console.log('    ⚠️', e.message);
    }
  }

  // Verify
  const remaining = await client.query(`
    SELECT pg_get_function_arguments(p.oid) as args
    FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'credit_user_balance'
  `);
  console.log('\nRemaining credit_user_balance:', remaining.rows.length);
  remaining.rows.forEach(r => console.log('  ', r.args));

  await client.end();
}

run().catch(e => console.error('ERROR:', e.message));
