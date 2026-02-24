const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function investigate() {
  console.log("=== INVESTIGATING TICKET COUNT MISALIGNMENT ===\n");

  // Find Bitcoin Bonanza competition - check all competitions first
  const { data: allComps } = await supabase
    .from("competitions")
    .select("id, title, tickets_sold, total_tickets")
    .order("created_at", { ascending: false })
    .limit(20);

  console.log("Recent competitions:");
  allComps?.forEach((c) =>
    console.log(`  - ${c.title} (${c.tickets_sold}/${c.total_tickets})`),
  );

  // Find Bitcoin Bonanza
  const comp = allComps?.find(
    (c) =>
      c.title?.toLowerCase().includes("bitcoin") ||
      c.title?.toLowerCase().includes("bonanza"),
  );

  if (!comp) {
    console.log("\nBitcoin Bonanza not found, using first competition");
    return;
  }

  console.log("Competition:", comp.title);
  console.log("Competition ID:", comp.id);
  console.log("competitions.tickets_sold (UI source):", comp.tickets_sold);
  console.log("competitions.total_tickets:", comp.total_tickets);
  console.log("");

  // Count from tickets table (actual tickets)
  const { count: ticketsTableCount } = await supabase
    .from("tickets")
    .select("*", { count: "exact", head: true })
    .eq("competition_id", comp.id);

  console.log("tickets table count (actual sold tickets):", ticketsTableCount);

  // Count from pending_tickets table
  const { count: pendingCount } = await supabase
    .from("pending_tickets")
    .select("*", { count: "exact", head: true })
    .eq("competition_id", comp.id);

  console.log("pending_tickets table count:", pendingCount);

  // Count from joincompetition table (entries)
  const { data: joinData, error: joinErr } = await supabase
    .from("joincompetition")
    .select("id, numberoftickets, wallet_address, canonical_user_id")
    .eq("onchain_competition_id", comp.id);

  const joincompetitionSum =
    joinData?.reduce((sum, e) => sum + (e.numberoftickets || 0), 0) || 0;
  console.log("joincompetition entries:", joinData?.length || 0);
  console.log("joincompetition sum(numberoftickets):", joincompetitionSum);

  // Now check USER-specific data
  console.log("\n=== USER-SPECIFIC DATA (maxmi / yammy) ===\n");

  // Find the canonical user
  const { data: canonicalUsers } = await supabase
    .from("canonical_users")
    .select("id, primary_identifier")
    .or("primary_identifier.ilike.%maxmi%,primary_identifier.ilike.%yammy%");

  console.log("Found canonical users:", canonicalUsers?.length);

  for (const user of canonicalUsers || []) {
    console.log(`\n--- User: ${user.primary_identifier} (${user.id}) ---`);

    // User's tickets in tickets table
    const { count: userTicketsCount, data: userTickets } = await supabase
      .from("tickets")
      .select("ticket_number", { count: "exact" })
      .eq("competition_id", comp.id)
      .eq("canonical_user_id", user.id);

    console.log("tickets table for this user:", userTicketsCount);

    // User's pending_tickets
    const { count: userPendingCount } = await supabase
      .from("pending_tickets")
      .select("*", { count: "exact", head: true })
      .eq("competition_id", comp.id)
      .eq("canonical_user_id", user.id);

    console.log("pending_tickets for this user:", userPendingCount);

    // User's joincompetition entries
    const { data: userJoin } = await supabase
      .from("joincompetition")
      .select("id, numberoftickets, ticket_numbers, created_at")
      .eq("onchain_competition_id", comp.id)
      .eq("canonical_user_id", user.id)
      .order("created_at", { ascending: false });

    const userJoinSum =
      userJoin?.reduce((sum, e) => sum + (e.numberoftickets || 0), 0) || 0;
    console.log("joincompetition entries for this user:", userJoin?.length);
    console.log("joincompetition sum(numberoftickets):", userJoinSum);

    // Parse actual ticket numbers from joincompetition
    const allTicketNumbers = new Set();
    for (const entry of userJoin || []) {
      if (entry.ticket_numbers) {
        const nums = entry.ticket_numbers
          .split(",")
          .map((t) => t.trim())
          .filter((t) => t);
        nums.forEach((n) => allTicketNumbers.add(n));
      }
    }
    console.log(
      "Unique ticket numbers from joincompetition.ticket_numbers:",
      allTicketNumbers.size,
    );

    // Compare with actual tickets table
    if (userTickets) {
      const ticketTableNumbers = new Set(
        userTickets.map((t) => String(t.ticket_number)),
      );
      console.log(
        "Unique ticket numbers from tickets table:",
        ticketTableNumbers.size,
      );

      // Find discrepancies
      const inJoinNotTickets = [...allTicketNumbers].filter(
        (n) => !ticketTableNumbers.has(n),
      );
      const inTicketsNotJoin = [...ticketTableNumbers].filter(
        (n) => !allTicketNumbers.has(n),
      );

      if (inJoinNotTickets.length > 0) {
        console.log(
          "In joincompetition but NOT in tickets table:",
          inJoinNotTickets.length,
          "tickets",
        );
        if (inJoinNotTickets.length <= 10)
          console.log("  Examples:", inJoinNotTickets.slice(0, 10));
      }
      if (inTicketsNotJoin.length > 0) {
        console.log(
          "In tickets table but NOT in joincompetition:",
          inTicketsNotJoin.length,
          "tickets",
        );
        if (inTicketsNotJoin.length <= 10)
          console.log("  Examples:", inTicketsNotJoin.slice(0, 10));
      }
    }
  }

  // Check what the RPC returns
  console.log("\n=== RPC RESULTS ===\n");

  const { data: rpcEntries, error: rpcErr } = await supabase.rpc(
    "get_user_entries_by_competition",
    {
      p_canonical_user_id: canonicalUsers?.[0]?.id,
    },
  );

  if (rpcErr) {
    console.log("RPC error:", rpcErr.message);
  } else {
    const btcEntry = rpcEntries?.find((e) => e.competition_id === comp.id);
    if (btcEntry) {
      console.log("RPC get_user_entries_by_competition result:");
      console.log("  competition_id:", btcEntry.competition_id);
      console.log("  number_of_tickets:", btcEntry.number_of_tickets);
      console.log(
        "  ticket_numbers length:",
        btcEntry.ticket_numbers?.split(",").filter((t) => t.trim()).length || 0,
      );
    }
  }

  console.log("\n=== SUMMARY ===\n");
  console.log(
    "UI shows '1816 tickets sold' - this comes from: competitions.tickets_sold",
  );
  console.log("User dashboard shows '2419 tickets' - need to trace source");
  console.log(
    "'Show all 1212 tickets' - this comes from: parsed ticket_numbers string",
  );
  console.log("");
  console.log("THE FIX: Need to sync all these sources!");
}

investigate().catch(console.error);
