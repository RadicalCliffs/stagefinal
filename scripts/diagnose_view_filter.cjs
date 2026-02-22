/**
 * FIX: v_joincompetition_active view filtering out 'sold' status entries
 * 
 * ROOT CAUSE: The view has WHERE jc.status = 'active'
 * But many purchase functions insert with status = 'sold'
 * This hides all recent entries from the landing page!
 */

const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function main() {
  console.log("🔍 Checking joincompetition status distribution...\n");
  
  // Check what statuses exist
  const { data: statusData, error: statusError } = await supabase
    .rpc('exec_sql', { 
      sql: `SELECT status, COUNT(*) as count FROM joincompetition GROUP BY status ORDER BY count DESC` 
    });
  
  if (statusError) {
    // Fallback: query directly
    const { data: entries } = await supabase
      .from('joincompetition')
      .select('status')
      .limit(1000);
    
    const statusCounts = {};
    for (const e of entries || []) {
      const s = e.status || 'NULL';
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    }
    console.log("Status distribution (sample):", statusCounts);
  } else {
    console.log("Status distribution:", statusData);
  }

  // Check most recent entries
  console.log("\n🔍 Most recent entries in joincompetition:");
  const { data: recent, error: recentError } = await supabase
    .from('joincompetition')
    .select('purchase_date, purchasedate, status, canonical_user_id')
    .order('purchase_date', { ascending: false, nullsFirst: false })
    .limit(5);
  
  if (recentError) {
    console.error("Error:", recentError.message);
  } else {
    for (const r of recent || []) {
      console.log(`  ${r.purchase_date || r.purchasedate} | status: ${r.status} | user: ${(r.canonical_user_id || '').slice(0, 30)}...`);
    }
  }

  // Check what v_joincompetition_active returns
  console.log("\n🔍 Most recent entries from v_joincompetition_active (what the landing page sees):");
  const { data: viewRecent, error: viewError } = await supabase
    .from('v_joincompetition_active')
    .select('purchasedate, status, username')
    .order('purchasedate', { ascending: false, nullsFirst: false })
    .limit(5);

  if (viewError) {
    console.error("Error:", viewError.message);
  } else {
    for (const r of viewRecent || []) {
      console.log(`  ${r.purchasedate} | status: ${r.status} | user: ${r.username || 'anonymous'}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("TO FIX: Run this SQL in Supabase SQL Editor:");
  console.log("=".repeat(60));
  console.log(`
CREATE OR REPLACE VIEW v_joincompetition_active AS
SELECT 
    jc.id,
    jc.user_id,
    jc.user_id AS userid,
    jc.competition_id,
    jc.competition_id AS competitionid,
    jc.ticket_numbers,
    jc.ticket_numbers AS ticketnumbers,
    jc.purchase_date,
    jc.purchase_date AS purchasedate,
    jc.transaction_hash,
    jc.transaction_hash AS transactionhash,
    jc.canonical_user_id,
    jc.privy_user_id,
    jc.wallet_address,
    jc.status,
    COALESCE(
      cu1.username,
      cu2.username,
      cu3.username
    ) AS username,
    COALESCE(cu1.avatar_url, cu2.avatar_url, cu3.avatar_url) AS avatar_url
FROM joincompetition jc
LEFT JOIN canonical_users cu1 ON cu1.canonical_user_id = jc.canonical_user_id
LEFT JOIN canonical_users cu2 ON cu2.wallet_address = jc.wallet_address 
    AND jc.canonical_user_id IS NULL
LEFT JOIN canonical_users cu3 ON cu3.canonical_user_id = jc.wallet_address 
    AND jc.canonical_user_id IS NULL
    AND jc.wallet_address LIKE 'prize:pid:%'
WHERE jc.status IN ('active', 'sold');
`);
}

main().catch(console.error);
