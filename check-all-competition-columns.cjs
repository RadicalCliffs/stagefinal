const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://mthwfldcjvpxjtmrqkqm.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY';

const supabase = createClient(supabaseUrl, serviceKey);

async function checkAllCompetitionColumns() {
  const { data, error } = await supabase.rpc('check_competition_column_types');
  
  if (error) {
    console.error('Error:', JSON.stringify(error, null, 2));
    process.exit(1);
  } else {
    console.log('\n=== ALL COMPETITION COLUMNS IN PRODUCTION ===\n');
    console.table(data);
    
    console.log('\n=== SUMMARY ===');
    const byType = {};
    data.forEach(row => {
      const key = `${row.table_name}.${row.column_name}`;
      byType[key] = row.data_type;
    });
    
    console.log('\nColumn Types:');
    Object.entries(byType).forEach(([col, type]) => {
      console.log(`  ${col.padEnd(50)} = ${type.toUpperCase()}`);
    });
  }
  
  process.exit(0);
}

checkAllCompetitionColumns().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
