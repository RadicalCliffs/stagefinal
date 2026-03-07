const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY";

const supabase = createClient(supabaseUrl, serviceKey);

async function testDirectQueries() {
  console.log("Testing direct SQL queries to isolate the issue...\n");

  const testCompId = "98ea9cbc-5d9b-409b-b757-acb9d0292a95";
  const testUserId = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

  // Create a temporary test function
  const createTestFunc = `
CREATE OR REPLACE FUNCTION test_uuid_comparison(
  p_user_id TEXT,
  p_competition_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_test_count INTEGER;
BEGIN
  -- Test 1: Simple count from competitions
  SELECT COUNT(*)
  INTO v_test_count
  FROM competitions
  WHERE id = p_competition_id;
  
  IF v_test_count = 0 THEN
    RETURN jsonb_build_object('error', 'Test 1 failed: competition not found');
  END IF;
  
  -- Test 2: Query joincompetition with competitionid
  SELECT COUNT(*)
  INTO v_test_count
  FROM joincompetition
  WHERE competitionid = p_competition_id;
  
  -- Test 3: Query tickets with competition_id
  SELECT COUNT(*)
  INTO v_test_count
  FROM tickets
  WHERE competition_id = p_competition_id;
  
  -- Test 4: Query pending_tickets
  SELECT COUNT(*)
  INTO v_test_count
  FROM pending_tickets
  WHERE competition_id = p_competition_id
    AND user_id != p_user_id;
  
  RETURN jsonb_build_object('success', true, 'message', 'All tests passed');
  
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', SQLERRM, 'detail', SQLSTATE);
END;
$$;
  `;

  console.log("Creating test function...");
  const { error: createError } = await supabase.rpc("execute_raw_sql", {
    query: createTestFunc,
  });

  if (createError) {
    console.error(
      "Failed to create test function:",
      JSON.stringify(createError, null, 2),
    );
    return;
  }

  console.log("✅ Test function created\n");

  // Call the test function
  console.log("Calling test function...");
  const { data, error } = await supabase.rpc("test_uuid_comparison", {
    p_user_id: testUserId,
    p_competition_id: testCompId,
  });

  if (error) {
    console.error(
      "❌ Test function call failed:",
      JSON.stringify(error, null, 2),
    );
    return;
  }

  console.log("✅ Test function result:", JSON.stringify(data, null, 2));
}

testDirectQueries().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
