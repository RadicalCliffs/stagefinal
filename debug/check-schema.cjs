const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://mthwfldcjvpxjtmrqkqm.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY';

const supabase = createClient(supabaseUrl, serviceKey);

async function checkSchema() {
  console.log('Calling RPC function...');
  const { data, error } = await supabase.rpc('check_competition_column_types');
  
  if (error) {
    console.error('Error:', JSON.stringify(error, null, 2));
  } else {
    console.log('\n=== PRODUCTION DATABASE SCHEMA ===\n');
    console.log(JSON.stringify(data, null, 2));
    console.table(data);
  }
  
  process.exit(0);
}

checkSchema().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
