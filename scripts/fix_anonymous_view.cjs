const { Client } = require('pg');

const client = new Client({
  host: 'aws-1-ap-south-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.mthwfldcjvpxjtmrqkqm',
  password: 'LetsF4ckenGo!',
  ssl: { rejectUnauthorized: false },
});

(async () => {
  try {
    await client.connect();
    console.log('✅ Connected to Supabase!');
    
    // 1. Get current view definition
    console.log('\n📋 Current v_joincompetition_active view:');
    const viewDef = await client.query(`SELECT pg_get_viewdef('v_joincompetition_active'::regclass, true)`);
    console.log(viewDef.rows[0].pg_get_viewdef);
    
    // 2. Check if username column already exists
    const cols = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'v_joincompetition_active'
      ORDER BY ordinal_position
    `);
    console.log('\n📋 Current columns:', cols.rows.map(r => r.column_name).join(', '));
    
    const hasUsername = cols.rows.some(r => r.column_name === 'username');
    if (hasUsername) {
      console.log('\n✅ View already has username column!');
      
      // Update view to handle edge cases:
      // - wallet_address containing canonical_user_id format (prize:pid:...)
      console.log('📝 Updating view to handle edge cases...');
      await client.query(`
        CREATE OR REPLACE VIEW v_joincompetition_active AS
        SELECT 
            jc.id,
            jc.user_id,
            jc.user_id AS userid,
            jc.competition_id,
            jc.competition_id AS competitionid,
            jc.ticket_numbers,
            jc.ticket_numbers AS ticketnumbers,
            jc.purchase_date,
            jc.purchase_date AS purchasedate,
            jc.transaction_hash,
            jc.transaction_hash AS transactionhash,
            jc.canonical_user_id,
            jc.privy_user_id,
            jc.wallet_address,
            jc.status,
            COALESCE(
              cu1.username,                                          -- 1. Match by canonical_user_id
              cu2.username,                                          -- 2. Match wallet_address to canonical_users.wallet_address
              cu3.username                                           -- 3. Match wallet_address to canonical_users.canonical_user_id (edge case)
            ) AS username,
            COALESCE(cu1.avatar_url, cu2.avatar_url, cu3.avatar_url) AS avatar_url
        FROM joincompetition jc
        LEFT JOIN canonical_users cu1 ON cu1.canonical_user_id = jc.canonical_user_id
        LEFT JOIN canonical_users cu2 ON cu2.wallet_address = jc.wallet_address 
            AND jc.canonical_user_id IS NULL
        LEFT JOIN canonical_users cu3 ON cu3.canonical_user_id = jc.wallet_address 
            AND jc.canonical_user_id IS NULL
            AND jc.wallet_address LIKE 'prize:pid:%'
        WHERE jc.status = 'active'
      `);
      console.log('✅ View updated to handle edge cases!');
    } else {
      console.log('\n⚠️ View missing username column, applying fix...');
      
      // Apply the fix - recreate view with username from canonical_users
      // IMPORTANT: Keep original column types (id is uuid, not text)
      await client.query(`
        CREATE OR REPLACE VIEW v_joincompetition_active AS
        SELECT 
            jc.id,
            jc.user_id,
            jc.user_id AS userid,
            jc.competition_id,
            jc.competition_id AS competitionid,
            jc.ticket_numbers,
            jc.ticket_numbers AS ticketnumbers,
            jc.purchase_date,
            jc.purchase_date AS purchasedate,
            jc.transaction_hash,
            jc.transaction_hash AS transactionhash,
            jc.canonical_user_id,
            jc.privy_user_id,
            jc.wallet_address,
            jc.status,
            COALESCE(
              cu1.username,                                          -- 1. Match by canonical_user_id
              cu2.username,                                          -- 2. Match wallet_address to canonical_users.wallet_address
              cu3.username                                           -- 3. Match wallet_address to canonical_users.canonical_user_id (edge case)
            ) AS username,
            COALESCE(cu1.avatar_url, cu2.avatar_url, cu3.avatar_url) AS avatar_url
        FROM joincompetition jc
        LEFT JOIN canonical_users cu1 ON cu1.canonical_user_id = jc.canonical_user_id
        LEFT JOIN canonical_users cu2 ON cu2.wallet_address = jc.wallet_address 
            AND jc.canonical_user_id IS NULL
        LEFT JOIN canonical_users cu3 ON cu3.canonical_user_id = jc.wallet_address 
            AND jc.canonical_user_id IS NULL
            AND jc.wallet_address LIKE 'prize:pid:%'
        WHERE jc.status = 'active'
      `);
      console.log('✅ View updated with username and avatar_url!');
    }
    
    // 3. Verify - check how many entries now have usernames
    const stats = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(username) as with_username,
        COUNT(*) - COUNT(username) as without_username
      FROM v_joincompetition_active
    `);
    console.log('\n📊 Entry stats:');
    console.log(`  Total entries: ${stats.rows[0].total}`);
    console.log(`  With username: ${stats.rows[0].with_username}`);
    console.log(`  Without username: ${stats.rows[0].without_username}`);
    
    // 4. Sample entries
    const sample = await client.query(`
      SELECT wallet_address, canonical_user_id, username, avatar_url
      FROM v_joincompetition_active
      ORDER BY purchase_date DESC
      LIMIT 10
    `);
    console.log('\n📋 Sample recent entries:');
    sample.rows.forEach(r => {
      const wallet = r.wallet_address ? r.wallet_address.substring(0, 10) + '...' : 'null';
      const cuid = r.canonical_user_id ? r.canonical_user_id.substring(0, 15) + '...' : 'null';
      console.log(`  wallet: ${wallet} | cuid: ${cuid} | username: ${r.username || 'NULL'}`);
    });
    
    // 5. Check entries that still don't have username
    const missing = await client.query(`
      SELECT v.id, v.wallet_address, v.canonical_user_id
      FROM v_joincompetition_active v
      WHERE v.username IS NULL
    `);
    if (missing.rows.length > 0) {
      console.log('\n⚠️ Entries still without username:');
      for (const r of missing.rows) {
        console.log(`  Entry: ${r.id}`);
        console.log(`    wallet: ${r.wallet_address || 'null'}`);
        console.log(`    cuid: ${r.canonical_user_id || 'null'}`);
        
        // Get full entry details
        const fullEntry = await client.query(
          `SELECT * FROM joincompetition WHERE id = $1`,
          [r.id]
        );
        if (fullEntry.rows[0]) {
          const e = fullEntry.rows[0];
          console.log(`    user_id: ${e.user_id || 'null'}`);
          console.log(`    privy_user_id: ${e.privy_user_id || 'null'}`);
          console.log(`    ticket_numbers: ${e.ticket_numbers || 'null'}`);
          console.log(`    purchase_date: ${e.purchase_date || 'null'}`);
          
          // This is an orphan entry - delete it
          if (!e.wallet_address && !e.canonical_user_id && !e.user_id && !e.privy_user_id) {
            console.log('    ❌ ORPHAN ENTRY (no user identifiers) - deleting...');
            await client.query(`DELETE FROM joincompetition WHERE id = $1`, [r.id]);
            console.log('    ✅ Deleted orphan entry');
          }
        }
      }
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await client.end();
  }
})();
