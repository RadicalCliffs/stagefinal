require("dotenv/config");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY",
);

const COMP_ID = "e2de6135-405d-452e-a74c-35dc2e7c8ec6";
const JERRY = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

async function checkDuplicates() {
  console.log("=== DUPLICATE CHECK ACROSS ALL TABLES ===\n");

  // 1. Check tickets table for duplicate ticket numbers
  console.log("1. TICKETS TABLE - Duplicate ticket numbers per competition");
  const { data: ticketDupes } = await supabase.rpc("exec_sql", {
    sql_query: `
      SELECT competition_id, ticket_number, COUNT(*) as cnt
      FROM tickets
      GROUP BY competition_id, ticket_number
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC
      LIMIT 20
    `,
  });
  console.log("   Result:", ticketDupes);

  // 2. Check joincompetition for duplicate user+competition rows
  console.log("\n2. JOINCOMPETITION - Duplicate user+competition entries");
  const { data: jcDupes } = await supabase.rpc("exec_sql", {
    sql_query: `
      SELECT canonical_user_id, competition_id, COUNT(*) as cnt
      FROM joincompetition
      WHERE canonical_user_id IS NOT NULL
      GROUP BY canonical_user_id, competition_id
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC
      LIMIT 20
    `,
  });
  console.log("   Result:", jcDupes);

  // 3. Check competition_entries for duplicate user+competition rows
  console.log("\n3. COMPETITION_ENTRIES - Duplicate user+competition entries");
  const { data: ceDupes } = await supabase.rpc("exec_sql", {
    sql_query: `
      SELECT canonical_user_id, competition_id, COUNT(*) as cnt
      FROM competition_entries
      WHERE canonical_user_id IS NOT NULL
      GROUP BY canonical_user_id, competition_id
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC
      LIMIT 20
    `,
  });
  console.log("   Result:", ceDupes);

  // 4. Compare counts between sources for Bitcoin Bonanza
  console.log("\n4. BITCOIN BONANZA DATA COMPARISON");

  // Tickets count
  const { count: ticketsTotal } = await supabase
    .from("tickets")
    .select("*", { count: "exact", head: true })
    .eq("competition_id", COMP_ID);

  const { count: ticketsJerry } = await supabase
    .from("tickets")
    .select("*", { count: "exact", head: true })
    .eq("competition_id", COMP_ID)
    .eq("canonical_user_id", JERRY);

  // Joincompetition
  const { data: jcData } = await supabase
    .from("joincompetition")
    .select("canonical_user_id, numberoftickets")
    .or(`competitionid.eq.${COMP_ID},competition_id.eq.${COMP_ID}`);

  // competition_entries
  const { data: ceData } = await supabase
    .from("competition_entries")
    .select("canonical_user_id, tickets_count")
    .eq("competition_id", COMP_ID);

  // competitions.tickets_sold
  const { data: compData } = await supabase
    .from("competitions")
    .select("tickets_sold")
    .eq("id", COMP_ID)
    .single();

  console.log("   tickets table total:", ticketsTotal);
  console.log("   tickets table jerry:", ticketsJerry);
  console.log("   competitions.tickets_sold:", compData?.tickets_sold);
  console.log("   joincompetition entries:", jcData?.length);
  jcData?.forEach((j) =>
    console.log(
      `     - ${j.canonical_user_id?.substring(0, 30)}...: ${j.numberoftickets}`,
    ),
  );
  console.log("   competition_entries entries:", ceData?.length);
  ceData?.forEach((c) =>
    console.log(
      `     - ${c.canonical_user_id?.substring(0, 30)}...: ${c.tickets_count}`,
    ),
  );

  // 5. Check purchase_groups for duplicates
  console.log("\n5. PURCHASE_GROUPS - Check for issues");
  const { data: pgData } = await supabase
    .from("purchase_groups")
    .select("purchase_group_number, events_in_group, total_amount")
    .eq("user_id", JERRY)
    .eq("competition_id", COMP_ID)
    .order("purchase_group_number", { ascending: false })
    .limit(5);

  console.log("   Recent sessions for Jerry:");
  pgData?.forEach((p) =>
    console.log(
      `     Session #${p.purchase_group_number}: ${p.events_in_group} events, $${p.total_amount}`,
    ),
  );

  // 6. Sum of all purchase_groups amounts vs tickets
  const { data: pgSum } = await supabase.rpc("exec_sql", {
    sql_query: `
      SELECT SUM(total_amount) as total_spent
      FROM purchase_groups
      WHERE user_id = '${JERRY}'
      AND competition_id = '${COMP_ID}'
    `,
  });
  console.log("\n6. PURCHASE_GROUPS total_amount sum:", pgSum);

  const { data: ticketSum } = await supabase.rpc("exec_sql", {
    sql_query: `
      SELECT SUM(COALESCE(purchase_price, 1)) as total_spent
      FROM tickets
      WHERE canonical_user_id = '${JERRY}'
      AND competition_id = '${COMP_ID}'
    `,
  });
  console.log("   TICKETS purchase_price sum:", ticketSum);

  // 7. Check for orphaned data
  console.log("\n7. ORPHANED DATA CHECK");

  // Joincompetition entries without matching tickets
  const { data: orphanedJC } = await supabase.rpc("exec_sql", {
    sql_query: `
      SELECT jc.canonical_user_id, jc.competition_id, jc.numberoftickets
      FROM joincompetition jc
      WHERE jc.competition_id = '${COMP_ID}'::uuid
      AND NOT EXISTS (
        SELECT 1 FROM tickets t 
        WHERE t.competition_id = jc.competition_id
        AND t.canonical_user_id = jc.canonical_user_id
      )
    `,
  });
  console.log(
    "   Joincompetition entries with no matching tickets:",
    orphanedJC,
  );

  console.log("\n=== DUPLICATE CHECK COMPLETE ===");
}

checkDuplicates().catch(console.error);
