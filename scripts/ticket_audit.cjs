const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function investigate() {
  console.log("=== TICKET COUNT INVESTIGATION ===\n");

  // Get Bitcoin Bonanza
  const { data: comps } = await supabase
    .from("competitions")
    .select("id, title, tickets_sold, total_tickets")
    .ilike("title", "%bitcoin bonanza%")
    .eq("total_tickets", 100000);

  const comp = comps?.[0];
  if (!comp) {
    console.log("Bitcoin Bonanza (100k) not found!");
    return;
  }

  console.log("Competition:", comp.title);
  console.log("Competition ID:", comp.id);
  console.log("");

  // SOURCE 1: competitions.tickets_sold
  console.log("=== SOURCE 1: competitions.tickets_sold ===");
  console.log("Value:", comp.tickets_sold);
  console.log("");

  // SOURCE 2: tickets table count
  const { count: ticketsCount } = await supabase
    .from("tickets")
    .select("*", { count: "exact", head: true })
    .eq("competition_id", comp.id);

  console.log("=== SOURCE 2: tickets table COUNT ===");
  console.log("Value:", ticketsCount);
  console.log("");

  // SOURCE 3: pending_tickets count
  const { count: pendingCount } = await supabase
    .from("pending_tickets")
    .select("*", { count: "exact", head: true })
    .eq("competition_id", comp.id);

  console.log("=== SOURCE 3: pending_tickets COUNT ===");
  console.log("Value:", pendingCount);
  console.log("");

  // SOURCE 4: joincompetition
  const { data: joinEntries } = await supabase
    .from("joincompetition")
    .select(
      "id, numberoftickets, ticket_numbers, wallet_address, canonical_user_id",
    )
    .eq("onchain_competition_id", comp.id);

  console.log("=== SOURCE 4: joincompetition ===");
  console.log("Entries count:", joinEntries?.length || 0);
  const joinSum =
    joinEntries?.reduce((s, e) => s + (e.numberoftickets || 0), 0) || 0;
  console.log("sum(numberoftickets):", joinSum);

  // Parse ticket_numbers
  const joinTicketNumbers = new Set();
  joinEntries?.forEach((e) => {
    if (e.ticket_numbers) {
      e.ticket_numbers
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t)
        .forEach((t) => joinTicketNumbers.add(t));
    }
  });
  console.log("Unique parsed ticket_numbers:", joinTicketNumbers.size);
  console.log("");

  // Find who owns tickets
  console.log("=== TICKET OWNERS ===");
  const { data: owners } = await supabase
    .from("tickets")
    .select("canonical_user_id, wallet_address")
    .eq("competition_id", comp.id);

  const uniqueCanonical = [
    ...new Set(owners?.map((o) => o.canonical_user_id).filter(Boolean)),
  ];
  const uniqueWallets = [
    ...new Set(owners?.map((o) => o.wallet_address).filter(Boolean)),
  ];

  console.log("Unique canonical_user_ids:", uniqueCanonical.length);
  console.log("Unique wallets:", uniqueWallets.length);

  // Check each canonical user
  for (const userId of uniqueCanonical.slice(0, 3)) {
    console.log(`\n--- User: ${userId} ---`);

    const { count: userTickets } = await supabase
      .from("tickets")
      .select("*", { count: "exact", head: true })
      .eq("competition_id", comp.id)
      .eq("canonical_user_id", userId);

    console.log("tickets table:", userTickets);

    const { data: userJoin } = await supabase
      .from("joincompetition")
      .select("id, numberoftickets, ticket_numbers")
      .eq("onchain_competition_id", comp.id)
      .eq("canonical_user_id", userId);

    console.log("joincompetition entries:", userJoin?.length || 0);
    const userJoinSum =
      userJoin?.reduce((s, e) => s + (e.numberoftickets || 0), 0) || 0;
    console.log("joincompetition sum:", userJoinSum);

    // Parse their ticket_numbers
    const userTicketNums = new Set();
    userJoin?.forEach((e) => {
      if (e.ticket_numbers) {
        e.ticket_numbers
          .split(",")
          .map((t) => t.trim())
          .filter((t) => t)
          .forEach((t) => userTicketNums.add(t));
      }
    });
    console.log("joincompetition parsed tickets:", userTicketNums.size);
  }

  // Check what the RPC returns
  console.log("\n=== RPC: get_user_competition_entries ===");
  const mainUserId = uniqueCanonical[0];
  if (mainUserId) {
    const { data: rpcData, error: rpcErr } = await supabase.rpc(
      "get_user_competition_entries",
      {
        p_user_identifier: mainUserId,
      },
    );

    if (rpcErr) {
      console.log("RPC error:", rpcErr.message);
    } else {
      console.log("Total entries from RPC:", rpcData?.length);
      const btcData = rpcData?.filter((d) => d.competition_id === comp.id);
      console.log("Entries for Bitcoin Bonanza:", btcData?.length);

      if (btcData?.length > 0) {
        console.log("\nSample entry:");
        const sample = btcData[0];
        console.log("  tickets_count:", sample.tickets_count);
        console.log(
          "  ticket_numbers snippet:",
          sample.ticket_numbers?.substring(0, 100),
        );
        console.log("  amount_spent:", sample.amount_spent);

        // Sum all entries
        const rpcSum = btcData.reduce((s, e) => s + (e.tickets_count || 0), 0);
        console.log("\nSUM of tickets_count:", rpcSum);

        // Parse all ticket numbers
        const rpcTickets = new Set();
        btcData.forEach((e) => {
          if (e.ticket_numbers) {
            e.ticket_numbers
              .split(",")
              .map((t) => t.trim())
              .filter((t) => t)
              .forEach((t) => rpcTickets.add(t));
          }
        });
        console.log("Unique ticket_numbers from RPC:", rpcTickets.size);
      }
    }
  }

  console.log("\n=== DIAGNOSIS ===");
  console.log("competitions.tickets_sold:", comp.tickets_sold);
  console.log("tickets table count:", ticketsCount);
  console.log("pending_tickets count:", pendingCount);
  console.log("joincompetition sum:", joinSum);
  console.log("joincompetition parsed tickets:", joinTicketNumbers.size);
  console.log("");
  console.log("Discrepancies:");
  if (comp.tickets_sold !== ticketsCount) {
    console.log(
      `  - competitions.tickets_sold (${comp.tickets_sold}) != tickets count (${ticketsCount})`,
    );
  }
  if (joinSum !== ticketsCount && joinSum > 0) {
    console.log(
      `  - joincompetition sum (${joinSum}) != tickets count (${ticketsCount})`,
    );
  }
  if (joinTicketNumbers.size !== ticketsCount && joinTicketNumbers.size > 0) {
    console.log(
      `  - joincompetition parsed (${joinTicketNumbers.size}) != tickets count (${ticketsCount})`,
    );
  }
}

investigate().catch(console.error);
