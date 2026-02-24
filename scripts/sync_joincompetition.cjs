require("dotenv/config");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY",
);

async function syncJoincompetition() {
  console.log("=== SYNCING JOINCOMPETITION FROM TICKETS ===\n");

  // Update joincompetition.numberoftickets and amount_spent from tickets table
  const { data, error } = await supabase.rpc("exec_sql", {
    sql_query: `
      UPDATE joincompetition jc
      SET 
        numberoftickets = ticket_counts.cnt,
        amount_spent = ticket_counts.total_spent
      FROM (
        SELECT 
          canonical_user_id,
          competition_id,
          COUNT(*) as cnt,
          SUM(COALESCE(purchase_price, 1)) as total_spent
        FROM tickets
        WHERE canonical_user_id IS NOT NULL
        GROUP BY canonical_user_id, competition_id
      ) ticket_counts
      WHERE jc.canonical_user_id = ticket_counts.canonical_user_id
        AND COALESCE(jc.competition_id, jc.competitionid::uuid) = ticket_counts.competition_id
        AND (
          COALESCE(jc.numberoftickets, 0) != ticket_counts.cnt 
          OR COALESCE(jc.amount_spent, 0) != ticket_counts.total_spent
        );
    `,
  });

  if (error) {
    console.log("Error:", error.message);
  } else {
    console.log("Update complete:", data);
  }

  // Verify Bitcoin Bonanza
  console.log("\nVerifying Bitcoin Bonanza joincompetition:");
  const COMP_ID = "e2de6135-405d-452e-a74c-35dc2e7c8ec6";

  const { data: jc } = await supabase
    .from("joincompetition")
    .select("canonical_user_id, numberoftickets, amount_spent")
    .or(`competitionid.eq.${COMP_ID},competition_id.eq.${COMP_ID}`);

  jc?.forEach((j) =>
    console.log(
      `  ${j.canonical_user_id?.substring(0, 40)}...: ${j.numberoftickets} tickets, $${j.amount_spent}`,
    ),
  );

  // Compare with tickets table
  console.log("\nTickets table counts:");
  const { data: ticketCounts } = await supabase.rpc("exec_sql", {
    sql_query: `
      SELECT canonical_user_id, COUNT(*) as cnt, SUM(COALESCE(purchase_price, 1)) as spent
      FROM tickets
      WHERE competition_id = '${COMP_ID}'
      GROUP BY canonical_user_id
    `,
  });
  console.log("  Result:", ticketCounts);

  console.log("\n=== SYNC COMPLETE ===");
}

syncJoincompetition().catch(console.error);
