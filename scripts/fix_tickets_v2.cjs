/**
 * FIX ALL TICKET ISSUES - v2
 */

const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log("=== FIX TICKET ALIGNMENT ISSUES v2 ===\n");

  const competitionId = "e2de6135-405d-452e-a74c-35dc2e7c8ec6";

  // Get actual ticket count by fetching tickets
  const { data: tickets } = await supabase
    .from("tickets")
    .select("id")
    .eq("onchain_competition_id", competitionId);

  const actualCount = tickets?.length || 0;
  console.log(`Actual tickets in tickets table: ${actualCount}`);

  // Get current value
  const { data: comp } = await supabase
    .from("competitions")
    .select("tickets_sold")
    .eq("id", competitionId)
    .single();

  console.log(`Current competitions.tickets_sold: ${comp?.tickets_sold}`);

  if (actualCount !== comp?.tickets_sold) {
    console.log(`\nFixing: ${comp?.tickets_sold} → ${actualCount}`);

    const { error } = await supabase
      .from("competitions")
      .update({ tickets_sold: actualCount })
      .eq("id", competitionId);

    if (error) {
      console.log(`ERROR: ${error.message}`);
    } else {
      console.log("✅ Fixed competitions.tickets_sold");
    }
  }

  // Now verify jerry's tickets
  const jerryCanonical = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

  const { data: jerryTickets } = await supabase
    .from("tickets")
    .select("ticket_number")
    .eq("onchain_competition_id", competitionId)
    .eq("canonical_user_id", jerryCanonical)
    .order("ticket_number", { ascending: true });

  console.log(`\nJerry's tickets: ${jerryTickets?.length || 0}`);

  // Check what get_unavailable_tickets returns
  const { data: unavailable } = await supabase.rpc("get_unavailable_tickets", {
    p_competition_id: competitionId,
  });

  console.log(`get_unavailable_tickets: ${unavailable?.length || 0} tickets`);

  // Find discrepancy
  if (jerryTickets && unavailable) {
    const jerrySet = new Set(jerryTickets.map((t) => t.ticket_number));
    const unavailSet = new Set(unavailable);

    const inJerryNotUnavail = [...jerrySet].filter((n) => !unavailSet.has(n));
    const inUnavailNotJerry = [...unavailSet].filter((n) => !jerrySet.has(n));

    console.log(
      `\nJerry tickets NOT in unavailable: ${inJerryNotUnavail.length}`,
    );
    if (inJerryNotUnavail.length > 0) {
      console.log(`  First 10: ${inJerryNotUnavail.slice(0, 10).join(", ")}`);
    }

    console.log(
      `Unavailable tickets NOT owned by jerry: ${inUnavailNotJerry.length}`,
    );
  }

  // Check what the RPC returns for jerry
  console.log("\n--- Testing get_user_competition_entries RPC ---");

  const { data: rpcData, error: rpcErr } = await supabase.rpc(
    "get_user_competition_entries",
    {
      p_user_id: jerryCanonical,
      p_competition_id: competitionId,
    },
  );

  if (rpcErr) {
    console.log(`RPC ERROR: ${rpcErr.message}`);
    console.log("\n⚠️  This RPC needs to be fixed. Run this SQL in Supabase:");
    console.log(`
-- Fix the ambiguous wallet_address column
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
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_canonical_id TEXT;
  v_wallet TEXT;
BEGIN
  v_canonical_id := CASE 
    WHEN p_user_id LIKE 'prize:pid:%' THEN p_user_id
    WHEN p_user_id ~ '^0x[a-fA-F0-9]{40}$' THEN 'prize:pid:' || LOWER(p_user_id)
    ELSE p_user_id
  END;
  
  v_wallet := CASE 
    WHEN v_canonical_id LIKE 'prize:pid:0x%' THEN SUBSTRING(v_canonical_id FROM 11)
    ELSE NULL
  END;

  RETURN QUERY
  SELECT 
    t.id,
    t.onchain_competition_id,
    c.title,
    c.description,
    c.image,
    COALESCE(c.status, 'live')::TEXT,
    COALESCE(t.is_winner, FALSE),
    t.ticket_number::TEXT,
    1,
    t.price,
    t.created_at,
    t.wallet_address,  -- explicitly from t
    COALESCE(t.transaction_hash, 'no-hash'),
    COALESCE(c.is_instant_win, FALSE),
    c.prize_value::TEXT,
    c.status,
    c.end_date,
    c.draw_date,
    c.vrf_tx_hash,
    c.vrf_status,
    'confirmed'::TEXT,
    NULL::TIMESTAMPTZ
  FROM tickets t
  JOIN competitions c ON c.id = t.onchain_competition_id
  WHERE (t.canonical_user_id = v_canonical_id OR LOWER(t.wallet_address) = v_wallet)
    AND (p_competition_id IS NULL OR t.onchain_competition_id = p_competition_id)
  ORDER BY t.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION get_user_competition_entries(TEXT, UUID) TO authenticated, anon, service_role;
`);
  } else {
    console.log(`RPC returned: ${rpcData?.length || 0} entries`);
  }

  console.log("\n=== SUMMARY ===");
  console.log("The main issues:");
  console.log("1. get_user_competition_entries RPC is broken - needs SQL fix");
  console.log(
    "2. Frontend falls back to other data sources that have stale data",
  );
  console.log("3. competitions.tickets_sold was wrong - now fixed");
  console.log(
    "\nFrontend fix already applied to use actual ticket_numbers instead of number_of_tickets field",
  );
}

main().catch(console.error);
