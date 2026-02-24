require("dotenv/config");
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY",
);

const JERRY = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";
const COMP_ID = "29e43249-d19d-436c-ad8d-656e7b05198f"; // Solana Slammer

(async () => {
  console.log("=== DEBUGGING ENTRY DETAILS ===\n");

  // 1. Check competition table for ticket_price
  console.log("1. Competition data:");
  const { data: comp } = await supabase
    .from("competitions")
    .select("id, title, ticket_price, total_tickets, tickets_sold")
    .eq("id", COMP_ID)
    .single();
  console.log(comp);

  // 2. Check RPC return for this competition
  console.log(
    "\n2. RPC get_user_competition_entries result for Solana Slammer:",
  );
  const { data: rpc } = await supabase.rpc("get_user_competition_entries", {
    p_user_identifier: JERRY,
  });
  const solEntry = rpc?.find((e) => e.competition_id === COMP_ID);
  console.log("Fields returned:", Object.keys(solEntry || {}));
  console.log("Key values:");
  console.log("  tickets_count:", solEntry?.tickets_count);
  console.log("  amount_spent:", solEntry?.amount_spent);
  console.log("  amount_paid:", solEntry?.amount_paid);
  console.log(
    "  competition_ticket_price:",
    solEntry?.competition_ticket_price,
  );
  console.log("  ticket_price:", solEntry?.ticket_price);

  // 3. Check competition_entries table
  console.log("\n3. competition_entries table:");
  const { data: ce } = await supabase
    .from("competition_entries")
    .select("tickets_count, amount_spent, amount_paid")
    .eq("competition_id", COMP_ID)
    .eq("canonical_user_id", JERRY)
    .single();
  console.log(ce);

  // 4. Check the RPC function definition for ticket_price
  console.log("\n4. Checking if RPC returns ticket_price...");
  const { data: funcDef } = await supabase.rpc("exec_sql", {
    sql_query:
      "SELECT pg_get_functiondef(oid) as def FROM pg_proc WHERE proname = 'get_user_competition_entries' LIMIT 1",
  });

  if (funcDef && funcDef[0]) {
    const def = funcDef[0].def;
    // Check if ticket_price is in the return columns
    const hasTicketPrice = def.includes("ticket_price");
    console.log("RPC function includes ticket_price:", hasTicketPrice);

    // Show the RETURNS TABLE section
    const returnsMatch = def.match(/RETURNS TABLE\s*\(([\s\S]*?)\)/i);
    if (returnsMatch) {
      console.log("\nRETURNS TABLE columns:");
      console.log(returnsMatch[1].substring(0, 500));
    }
  }

  // 5. Check purchase_groups view
  console.log("\n5. purchase_groups for Solana Slammer:");
  const { data: pg, error: pgErr } = await supabase
    .from("purchase_groups")
    .select("*")
    .eq("competition_id", COMP_ID)
    .eq("user_id", JERRY)
    .order("group_start_at", { ascending: false })
    .limit(3);

  if (pgErr) {
    console.log("Error:", pgErr.message);
  } else {
    console.log("Sessions found:", pg?.length);
    pg?.forEach((p) => {
      console.log(
        `  Session: ${p.events_in_group} events, total_amount: $${p.total_amount}`,
      );
    });
  }

  // 6. What SHOULD the total be?
  console.log("\n6. EXPECTED VALUES:");
  const ticketPrice = comp?.ticket_price || 0;
  const ticketCount = solEntry?.tickets_count || 0;
  const expectedTotal = ticketPrice * ticketCount;
  console.log(`  Ticket Price: $${ticketPrice}`);
  console.log(`  Ticket Count: ${ticketCount}`);
  console.log(`  Expected Total Spent: $${expectedTotal.toFixed(2)}`);
  console.log(`  Current Total Spent: $${solEntry?.amount_spent || 0}`);
})();
