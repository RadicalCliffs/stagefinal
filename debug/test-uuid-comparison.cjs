const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY";

const supabase = createClient(supabaseUrl, serviceKey);

async function testComparison() {
  console.log("Testing UUID comparison in WHERE clause...\n");

  const testCompId = '98ea9cbc-5d9b-409b-b757-acb9d0292a95';
  
  // Test 1: Simple select with WHERE
  console.log("Test 1: SELECT from joincompetition WHERE competitionid = UUID");
  const { data: test1, error: err1 } = await supabase
    .from('joincompetition')
    .select('id, competitionid, ticket_count')
    .eq('competitionid', testCompId)
    .limit(1);
  
  if (err1) {
    console.error("  ❌ Error:", JSON.stringify(err1, null, 2));
  } else {
    console.log("  ✅ Success:", data: ${test1?.length || 0} rows);
    if (test1?.[0]) {
      console.log(`  Sample: id=${test1[0].id}, competitionid=${test1[0].competitionid}`);
    }
  }

  // Test 2: Test in string_to_array context
  console.log("\nTest 2: Complex query with ticketnumbers parsing");
  const { data: test2, error: err2 } = await supabase.rpc('execute_raw_sql', {
    query: `
      SELECT COUNT(*) as count
      FROM (
        SELECT CAST(trim(unnest(string_to_array(ticketnumbers, ','))) AS INTEGER) AS ticket_num
        FROM joincompetition
        WHERE competitionid = $1::UUID
          AND ticketnumbers IS NOT NULL
          AND trim(ticketnumbers) != ''
      ) jc_tickets
      WHERE ticket_num IS NOT NULL;
    `,
    params: [testCompId]
  });
  
  if (err2) {
    console.error("  ❌ Error:", JSON.stringify(err2, null, 2));
  } else {
    console.log("  ✅ Success:", JSON.stringify(test2, null, 2));
  }

  // Test 3: Direct comparison in subquery
  console.log("\nTest 3: Subquery with competitionid comparison");
  const query = `
    SELECT array_agg(DISTINCT ticket_num) as tickets
    FROM (
      SELECT CAST(trim(unnest(string_to_array(ticketnumbers, ','))) AS INTEGER) AS ticket_num
      FROM joincompetition
      WHERE competitionid = '${testCompId}'::UUID
        AND ticketnumbers IS NOT NULL
        AND trim(ticketnumbers) != ''
    ) jc_tickets
    WHERE ticket_num IS NOT NULL;
  `;
  
  console.log("  Running SQL:", query.replace(/\n/g, ' ').replace(/\s+/g, ' '));
  
  const { data: test3, error: err3 } = await supabase.rpc('execute_raw_sql', {
    query: query
  });
  
  if (err3) {
    console.error("  ❌ Error:", JSON.stringify(err3, null, 2));
  } else {
    console.log("  ✅ Success, tickets array length:", test3?.[0]?.tickets?.length || 0);
  }
}

testComparison().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
