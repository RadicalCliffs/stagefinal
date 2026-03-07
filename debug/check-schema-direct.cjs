const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://mthwfldcjvpxjtmrqkqm.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY';

const supabase = createClient(supabaseUrl, serviceKey);

async function checkSchema() {
  console.log('Querying production database...');
  
  const { data, error } = await supabase
    .from('information_schema.columns')
    .select('table_name, column_name, data_type, udt_name')
    .or('column_name.like.%competition%, column_name.eq.competitionid')
    .eq('table_schema', 'public')
    .order('table_name');
  
  if (error) {
    console.error('Error:', JSON.stringify(error, null, 2));
    
    // Try raw SQL instead
    console.log('\nTrying raw SQL query...');
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
    
    const { data: sqlData, error: sqlError } = await supabase.rpc('exec_sql', { query });
    
    if (sqlError) {
      console.error('SQL Error:', JSON.stringify(sqlError, null, 2));
      process.exit(1);
    }
    
    console.log('\n=== PRODUCTION DATABASE SCHEMA ===\n');
    console.table(sqlData);
  } else {
    console.log('\n=== PRODUCTION DATABASE SCHEMA ===\n');
    console.table(data);
  }
  
  process.exit(0);
}

checkSchema().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
