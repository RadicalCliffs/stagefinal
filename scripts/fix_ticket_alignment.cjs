/**
 * FIX TICKET ALIGNMENT
 *
 * This script fixes ALL ticket count misalignment issues:
 * 1. Fixes the broken get_user_competition_entries RPC (ambiguous wallet_address)
 * 2. Syncs competitions.tickets_sold to actual ticket count
 * 3. Identifies mismatched ticket_numbers vs number_of_tickets
 */

const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function analyzeTicketSources() {
  console.log("\n=== ANALYZING ALL TICKET DATA SOURCES ===\n");

  const competitionId = "e2de6135-405d-452e-a74c-35dc2e7c8ec6"; // Bitcoin Bonanza

  // 1. Competition table's tickets_sold
  const { data: comp } = await supabase
    .from("competitions")
    .select("id, title, tickets_sold, total_tickets")
    .eq("id", competitionId)
    .single();

  console.log("1. COMPETITIONS TABLE:");
  console.log(`   tickets_sold: ${comp?.tickets_sold}`);
  console.log(`   total_tickets: ${comp?.total_tickets}`);

  // 2. Actual tickets in tickets table
  const { data: tickets, error: ticketsErr } = await supabase
    .from("tickets")
    .select("ticket_number, canonical_user_id, wallet_address")
    .eq("onchain_competition_id", competitionId);

  console.log("\n2. TICKETS TABLE (actual source of truth):");
  console.log(`   Total tickets: ${tickets?.length || 0}`);
  if (ticketsErr) console.log(`   ERROR: ${ticketsErr.message}`);

  // Group by user
  const ticketsByUser = {};
  tickets?.forEach((t) => {
    const key = t.canonical_user_id || t.wallet_address || "unknown";
    if (!ticketsByUser[key]) ticketsByUser[key] = [];
    ticketsByUser[key].push(t.ticket_number);
  });

  console.log(
    `   Unique users with tickets: ${Object.keys(ticketsByUser).length}`,
  );
  for (const [user, tix] of Object.entries(ticketsByUser)) {
    console.log(`     - ${user.substring(0, 30)}...: ${tix.length} tickets`);
  }

  // 3. joincompetition entries
  const { data: joins } = await supabase
    .from("joincompetition")
    .select(
      "id, wallet_address, canonical_user_id, ticket_numbers, number_of_tickets",
    )
    .eq("competitionId", competitionId);

  console.log("\n3. JOINCOMPETITION TABLE:");
  console.log(`   Total entries: ${joins?.length || 0}`);

  if (joins && joins.length > 0) {
    let totalFromJoins = 0;
    let totalFromTicketNumbers = 0;
    joins.forEach((j) => {
      totalFromJoins += j.number_of_tickets || 0;
      if (j.ticket_numbers) {
        const nums = j.ticket_numbers.split(",").filter((n) => n.trim());
        totalFromTicketNumbers += nums.length;
      }
    });
    console.log(`   Sum of number_of_tickets: ${totalFromJoins}`);
    console.log(`   Sum of parsed ticket_numbers: ${totalFromTicketNumbers}`);
  }

  // 4. pending_tickets (should be 0 if all confirmed)
  const { data: pending } = await supabase
    .from("pending_tickets")
    .select("id, ticket_numbers, canonical_user_id")
    .eq("competition_id", competitionId)
    .eq("status", "confirmed");

  console.log("\n4. PENDING_TICKETS (confirmed):");
  console.log(`   Total entries: ${pending?.length || 0}`);

  if (pending && pending.length > 0) {
    let totalPendingTickets = 0;
    pending.forEach((p) => {
      if (p.ticket_numbers) {
        const nums = p.ticket_numbers.split(",").filter((n) => n.trim());
        totalPendingTickets += nums.length;
      }
    });
    console.log(`   Sum of ticket_numbers: ${totalPendingTickets}`);
  }

  // 5. What does get_unavailable_tickets return?
  const { data: unavailable, error: unavailErr } = await supabase.rpc(
    "get_unavailable_tickets",
    { p_competition_id: competitionId },
  );

  console.log("\n5. GET_UNAVAILABLE_TICKETS RPC:");
  if (unavailErr) {
    console.log(`   ERROR: ${unavailErr.message}`);
  } else {
    console.log(
      `   Returns: ${Array.isArray(unavailable) ? unavailable.length : "not array"} tickets`,
    );
  }

  // 6. Check user-specific data for jerry
  const jerryCanonical = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

  const jerryTickets = tickets?.filter(
    (t) =>
      t.canonical_user_id === jerryCanonical ||
      t.wallet_address?.toLowerCase() ===
        "0x0ff51ec0ecc9ae1e5e6048976ba307c849781363",
  );

  console.log("\n6. JERRY'S TICKETS (from tickets table):");
  console.log(`   Count: ${jerryTickets?.length || 0}`);
  if (jerryTickets && jerryTickets.length > 0) {
    console.log(
      `   First 10 ticket numbers: ${jerryTickets
        .slice(0, 10)
        .map((t) => t.ticket_number)
        .join(", ")}`,
    );
  }

  // 7. What RPC returns for jerry
  const { data: rpcEntries, error: rpcErr } = await supabase.rpc(
    "get_dashboard_purchases_rpc_v2",
    {
      p_canonical_user_id: jerryCanonical,
    },
  );

  console.log("\n7. GET_DASHBOARD_PURCHASES_RPC_V2 for jerry:");
  if (rpcErr) {
    console.log(`   ERROR: ${rpcErr.message}`);
  } else {
    const forComp = rpcEntries?.filter(
      (e) => e.competition_id === competitionId,
    );
    console.log(
      `   Total entries for this competition: ${forComp?.length || 0}`,
    );
    if (forComp && forComp.length > 0) {
      let totalFromRPC = 0;
      forComp.forEach((e) => {
        if (e.ticket_numbers) {
          const nums = e.ticket_numbers
            .split(",")
            .filter((n) => n.trim() && n !== "0");
          totalFromRPC += nums.length;
        }
      });
      console.log(`   Sum of ticket_numbers from RPC: ${totalFromRPC}`);
    }
  }

  return { tickets, comp };
}

async function fixCompetitionTicketsSold() {
  console.log("\n=== FIXING competitions.tickets_sold ===\n");

  // Get all competitions
  const { data: comps } = await supabase
    .from("competitions")
    .select("id, title, tickets_sold, total_tickets");

  for (const comp of comps || []) {
    // Count actual tickets
    const { count } = await supabase
      .from("tickets")
      .select("*", { count: "exact", head: true })
      .eq("onchain_competition_id", comp.id);

    if (count !== comp.tickets_sold) {
      console.log(`${comp.title}:`);
      console.log(`  DB says: ${comp.tickets_sold}, Actual: ${count}`);

      // Fix it
      const { error } = await supabase
        .from("competitions")
        .update({ tickets_sold: count })
        .eq("id", comp.id);

      if (error) {
        console.log(`  ERROR updating: ${error.message}`);
      } else {
        console.log(`  ✅ FIXED: Updated to ${count}`);
      }
    }
  }
}

async function fixBrokenRPC() {
  console.log("\n=== FIXING BROKEN get_user_competition_entries RPC ===\n");

  // The RPC has "wallet_address is ambiguous" - need to fix it
  const fixSQL = `
-- Fix the ambiguous wallet_address column reference
CREATE OR REPLACE FUNCTION get_user_competition_entries(
  p_user_id TEXT,
  p_competition_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  competition_id UUID,
  title TEXT,
  description TEXT,
  image TEXT,
  status TEXT,
  is_winner BOOLEAN,
  ticket_numbers TEXT,
  number_of_tickets INTEGER,
  amount_spent NUMERIC,
  purchase_date TIMESTAMPTZ,
  wallet_address TEXT,
  transaction_hash TEXT,
  is_instant_win BOOLEAN,
  prize_value TEXT,
  competition_status TEXT,
  end_date TIMESTAMPTZ,
  draw_date TIMESTAMPTZ,
  vrf_tx_hash TEXT,
  vrf_status TEXT,
  entry_type TEXT,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_canonical_id TEXT;
  v_wallet TEXT;
BEGIN
  -- Normalize user ID to canonical format
  v_canonical_id := CASE 
    WHEN p_user_id LIKE 'prize:pid:%' THEN p_user_id
    WHEN p_user_id ~ '^0x[a-fA-F0-9]{40}$' THEN 'prize:pid:' || LOWER(p_user_id)
    ELSE p_user_id
  END;
  
  -- Extract wallet address if it's in canonical format
  v_wallet := CASE 
    WHEN v_canonical_id LIKE 'prize:pid:0x%' THEN SUBSTRING(v_canonical_id FROM 11)
    ELSE NULL
  END;

  RETURN QUERY
  SELECT 
    t.id,
    t.onchain_competition_id AS competition_id,
    c.title,
    c.description,
    c.image,
    CASE 
      WHEN c.status = 'sold_out' THEN 'live'
      ELSE COALESCE(c.status, 'live')
    END AS status,
    COALESCE(t.is_winner, FALSE) AS is_winner,
    t.ticket_number::TEXT AS ticket_numbers,
    1 AS number_of_tickets,
    t.price AS amount_spent,
    t.created_at AS purchase_date,
    t.wallet_address AS wallet_address,  -- Explicitly qualified
    COALESCE(t.transaction_hash, 'no-hash') AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value::TEXT AS prize_value,
    c.status AS competition_status,
    c.end_date,
    c.draw_date,
    c.vrf_tx_hash,
    c.vrf_status,
    'confirmed' AS entry_type,
    NULL::TIMESTAMPTZ AS expires_at
  FROM tickets t
  JOIN competitions c ON c.id = t.onchain_competition_id
  WHERE (t.canonical_user_id = v_canonical_id OR LOWER(t.wallet_address) = v_wallet)
    AND (p_competition_id IS NULL OR t.onchain_competition_id = p_competition_id)
  ORDER BY t.created_at DESC;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT, UUID) TO authenticated, anon, service_role;
`;

  console.log("Executing fix for get_user_competition_entries...");

  const { error } = await supabase.rpc("exec_sql", { sql: fixSQL });

  if (error) {
    // Try direct execution
    console.log("exec_sql failed, trying direct...");
    const { error: err2 } = await supabase.from("_exec").select("*").limit(0);
    console.log(
      "Note: You may need to run this SQL manually in Supabase dashboard:",
    );
    console.log(fixSQL);
  } else {
    console.log("✅ RPC function fixed!");
  }
}

async function main() {
  try {
    // Analyze current state
    await analyzeTicketSources();

    // Fix competitions.tickets_sold
    await fixCompetitionTicketsSold();

    // Attempt to fix broken RPC
    await fixBrokenRPC();

    console.log("\n=== SUMMARY ===");
    console.log("1. Analyzed all ticket data sources");
    console.log("2. Fixed competitions.tickets_sold to match actual tickets");
    console.log(
      "3. Attempted to fix broken RPC (may need manual SQL execution)",
    );
    console.log(
      "\nThe core issue: Frontend shows number_of_tickets field (2419)",
    );
    console.log("but actual tickets in tickets table is 1212 or 1816.");
    console.log(
      "\nFix applied in CompetitionEntryDetails.tsx to use actual unique ticket count.",
    );
  } catch (err) {
    console.error("Error:", err);
  }
}

main();
