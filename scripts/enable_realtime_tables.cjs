/**
 * Enable Supabase Realtime on critical tables
 * 
 * Tables that need realtime for the landing page:
 * - joincompetition (live entries)
 * - winners (recent wins)
 * - competition_entries (unified entries table)
 * 
 * Run with: node scripts/enable_realtime_tables.cjs
 */

require('dotenv').config();
const { Client } = require('pg');

async function enableRealtime() {
  const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('❌ Missing SUPABASE_DB_URL or DATABASE_URL environment variable');
    console.log('Set it to your Supabase database connection string (found in Settings > Database)');
    process.exit(1);
  }

  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Tables that need realtime enabled
    const tables = [
      'joincompetition',
      'winners',
      'competition_entries',
      'competitions',
      'canonical_users'
    ];

    // Check current realtime publication
    console.log('📋 Checking current realtime configuration...\n');
    
    const currentTables = await client.query(`
      SELECT tablename 
      FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime'
      ORDER BY tablename
    `);

    console.log('Currently enabled tables:');
    if (currentTables.rows.length === 0) {
      console.log('  (none)');
    } else {
      currentTables.rows.forEach(row => console.log(`  - ${row.tablename}`));
    }
    console.log('');

    // Enable realtime for each table
    for (const table of tables) {
      const isEnabled = currentTables.rows.some(r => r.tablename === table);
      
      if (isEnabled) {
        console.log(`✅ ${table} - already enabled`);
      } else {
        try {
          await client.query(`
            ALTER PUBLICATION supabase_realtime ADD TABLE public.${table}
          `);
          console.log(`🔄 ${table} - ENABLED`);
        } catch (err) {
          if (err.message.includes('already member')) {
            console.log(`✅ ${table} - already enabled`);
          } else if (err.message.includes('does not exist')) {
            console.log(`⚠️  ${table} - table does not exist, skipping`);
          } else {
            console.error(`❌ ${table} - error: ${err.message}`);
          }
        }
      }
    }

    // Set replica identity FULL for better realtime (includes old values in updates)
    console.log('\n📋 Setting replica identity for update tracking...\n');
    
    for (const table of tables) {
      try {
        // Check if table exists first
        const tableExists = await client.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = $1
          )
        `, [table]);

        if (tableExists.rows[0].exists) {
          await client.query(`ALTER TABLE public.${table} REPLICA IDENTITY FULL`);
          console.log(`✅ ${table} - replica identity set to FULL`);
        }
      } catch (err) {
        console.log(`⚠️  ${table} - could not set replica identity: ${err.message}`);
      }
    }

    // Verify final configuration
    console.log('\n📋 Final realtime configuration:\n');
    
    const finalTables = await client.query(`
      SELECT tablename 
      FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime'
      ORDER BY tablename
    `);

    finalTables.rows.forEach(row => console.log(`  ✅ ${row.tablename}`));

    console.log('\n✅ Done! Realtime should now work for the landing page.');
    console.log('Note: You may need to restart your Supabase project for changes to take effect.');

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

enableRealtime();
