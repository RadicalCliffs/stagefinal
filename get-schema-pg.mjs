import pg from 'pg';
const { Client } = pg;

const connectionString = 'postgresql://postgres.mthwfldcjvpxjtmrqkqm:iamclaudeandiamafuckingretard@aws-0-us-west-1.pooler.supabase.com:6543/postgres';

async function getSchema() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    console.log('Connected to database');
    
    const query = `
      SELECT 
        table_name,
        column_name, 
        data_type,
        udt_name
      FROM information_schema.columns 
      WHERE table_schema = 'public'
        AND (
          column_name LIKE '%competition%'
          OR column_name = 'competitionid'
        )
      ORDER BY table_name, column_name;
    `;
    
    const result = await client.query(query);
    console.log('\n=== ALL COMPETITION COLUMNS IN PRODUCTION ===\n');
    console.table(result.rows);
    console.log(`\nTotal: ${result.rows.length} columns\n`);
    
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

getSchema();
