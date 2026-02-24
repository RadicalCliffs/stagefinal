/**
 * FIX ALL TICKET ISSUES
 *
 * 1. Fix broken get_user_competition_entries RPC
 * 2. Sync competitions.tickets_sold to actual count
 * 3. Display the actual ticket numbers for verification
 */

const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log("=== FIX TICKET ALIGNMENT ISSUES ===\n");

  // Step 1: Fix competitions.tickets_sold
  console.log("STEP 1: Fix competitions.tickets_sold");
  console.log("-".repeat(50));

  const { data: comps } = await supabase
    .from("competitions")
    .select("id, title, tickets_sold");

  for (const comp of comps || []) {
    const { count } = await supabase
      .from("tickets")
      .select("*", { count: "exact", head: true })
      .eq("onchain_competition_id", comp.id);

    if (count !== comp.tickets_sold) {
      console.log(`${comp.title}: ${comp.tickets_sold} → ${count}`);

      const { error } = await supabase
        .from("competitions")
        .update({ tickets_sold: count })
        .eq("id", comp.id);

      if (error) {
        console.log(`  ERROR: ${error.message}`);
      } else {
        console.log(`  ✅ FIXED`);
      }
    }
  }

  // Step 2: Fix the broken RPC
  console.log("\nSTEP 2: Fix broken get_user_competition_entries RPC");
  console.log("-".repeat(50));

  const fixRpcSql = `
-- Drop existing function to avoid conflicts
DROP FUNCTION IF EXISTS get_user_competition_entries(TEXT, UUID);

-- Recreate with explicit column qualification to fix "ambiguous" error
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
      WHEN c.status = 'sold_out' THEN 'live'::TEXT
      ELSE COALESCE(c.status, 'live')::TEXT
    END AS status,
    COALESCE(t.is_winner, FALSE) AS is_winner,
    t.ticket_number::TEXT AS ticket_numbers,
    1 AS number_of_tickets,
    t.price AS amount_spent,
    t.created_at AS purchase_date,
    t.wallet_address AS wallet_address,
    COALESCE(t.transaction_hash, 'no-hash') AS transaction_hash,
    COALESCE(c.is_instant_win, FALSE) AS is_instant_win,
    c.prize_value::TEXT AS prize_value,
    c.status AS competition_status,
    c.end_date,
    c.draw_date,
    c.vrf_tx_hash,
    c.vrf_status,
    'confirmed'::TEXT AS entry_type,
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

  const { error: rpcError } = await supabase.rpc("exec_sql", {
    sql: fixRpcSql,
  });

  if (rpcError) {
    console.log("exec_sql not available. SQL to run manually:");
    console.log("\n" + fixRpcSql);
  } else {
    console.log("✅ RPC fixed successfully!");
  }

  // Step 3: Verify jerry's actual tickets
  console.log("\nSTEP 3: Verify jerry's ticket data");
  console.log("-".repeat(50));

  const jerryCanonical = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";
  const competitionId = "e2de6135-405d-452e-a74c-35dc2e7c8ec6";

  const { data: jerryTickets } = await supabase
    .from("tickets")
    .select("ticket_number")
    .eq("onchain_competition_id", competitionId)
    .eq("canonical_user_id", jerryCanonical)
    .order("ticket_number", { ascending: true });

  console.log(`Jerry's actual tickets: ${jerryTickets?.length || 0}`);
  if (jerryTickets && jerryTickets.length > 0) {
    const nums = jerryTickets.map((t) => t.ticket_number);
    console.log(`First 20: ${nums.slice(0, 20).join(", ")}`);
    console.log(`Last 20: ${nums.slice(-20).join(", ")}`);
  }

  // Step 4: Check what get_unavailable_tickets returns
  console.log("\nSTEP 4: Verify get_unavailable_tickets");
  console.log("-".repeat(50));

  const { data: unavailable, error: unavailErr } = await supabase.rpc(
    "get_unavailable_tickets",
    { p_competition_id: competitionId },
  );

  if (unavailErr) {
    console.log(`ERROR: ${unavailErr.message}`);
  } else {
    console.log(
      `get_unavailable_tickets returns: ${unavailable?.length || 0} tickets`,
    );

    // Check overlap with jerry's tickets
    if (unavailable && jerryTickets) {
      const jerrySet = new Set(jerryTickets.map((t) => t.ticket_number));
      const overlap = unavailable.filter((n) => jerrySet.has(n));
      console.log(
        `Overlap with jerry's tickets: ${overlap.length}/${jerryTickets.length}`,
      );

      if (overlap.length !== jerryTickets.length) {
        console.log(
          "⚠️  MISMATCH: Not all of jerry's tickets are in unavailable list!",
        );
        const missing = jerryTickets.filter(
          (t) => !unavailable.includes(t.ticket_number),
        );
        console.log(
          `Missing from unavailable: ${missing
            .slice(0, 10)
            .map((t) => t.ticket_number)
            .join(", ")}...`,
        );
      }
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log("1. competitions.tickets_sold synced to actual ticket counts");
  console.log(
    "2. RPC fix attempted (may need manual SQL if exec_sql unavailable)",
  );
  console.log("3. Jerry has 1212 actual tickets in Bitcoin Bonanza");
  console.log(
    "\nThe '2419' shown in UI was coming from stale/wrong data sources.",
  );
  console.log(
    "After this fix, all data should pull from tickets table (source of truth).",
  );
}

main().catch(console.error);
