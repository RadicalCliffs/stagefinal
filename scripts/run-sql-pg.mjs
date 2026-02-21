// Script to execute SQL file against Supabase using pg
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Supabase connection string format:
// postgres://[user]:[password]@[host]:[port]/[database]
// For Supabase: postgres://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('ERROR: Set DATABASE_URL environment variable');
  console.error('Format: postgres://postgres.mthwfldcjvpxjtmrqkqm:[YOUR-PASSWORD]@aws-0-eu-west-1.pooler.supabase.com:6543/postgres');
  process.exit(1);
}

async function main() {
  const sqlFile = process.argv[2] || path.join(__dirname, '..', 'debug', 'CREATE_TEST_COMPETITIONS.sql');
  const sql = fs.readFileSync(path.resolve(sqlFile), 'utf-8');
  
  console.log(`Connecting to database...`);
  const client = new pg.Client({ connectionString: DATABASE_URL });
  
  try {
    await client.connect();
    console.log('Connected successfully!');
    
    // Execute the full SQL - pg can handle multiple statements
    console.log(`Executing SQL from ${sqlFile}...`);
    const result = await client.query(sql);
    
    // result.rows will contain the verification SELECT output
    if (Array.isArray(result)) {
      // Multiple statement results
      const lastResult = result[result.length - 1];
      if (lastResult.rows && lastResult.rows.length > 0) {
        console.log('\n=== Created Competitions ===');
        console.table(lastResult.rows.map(r => ({
          id: r.id?.substring(0, 8) + '...',
          title: r.title,
          price: `$${r.ticket_price}`,
          tickets: r.total_tickets,
          instant_win: r.is_instant_win ? 'YES' : 'NO',
          featured: r.is_featured ? 'YES' : 'NO',
          prize: `$${r.prize_value}`
        })));
      }
    } else if (result.rows && result.rows.length > 0) {
      console.log('\n=== Created Competitions ===');
      console.table(result.rows.map(r => ({
        id: r.id?.substring(0, 8) + '...',
        title: r.title,
        price: `$${r.ticket_price}`,
        tickets: r.total_tickets,
        instant_win: r.is_instant_win ? 'YES' : 'NO',
        featured: r.is_featured ? 'YES' : 'NO',
        prize: `$${r.prize_value}`
      })));
    }
    
    console.log('\n✓ SQL executed successfully!');
    
  } catch (err) {
    console.error('ERROR:', err.message);
    if (err.detail) console.error('Detail:', err.detail);
    if (err.hint) console.error('Hint:', err.hint);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
