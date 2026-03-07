// Diagnose why Jerry's active entries shows 0 in the UI
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg",
);

console.log("🔍 Diagnosing Jerry's Active Entries Issue\n");
console.log("=".repeat(60));

async function main() {
  // 1. Get Jerry's canonical user info
  const { data: jerry, error: jerryError } = await supabase
    .from("canonical_users")
    .select("*")
    .eq("username", "jerry")
    .single();

  if (jerryError || !jerry) {
    console.error("❌ Could not find Jerry:", jerryError);
    return;
  }

  console.log("\n1️⃣  JERRY'S USER RECORD:");
  console.log(`   Username: ${jerry.username}`);
  console.log(`   Canonical ID: ${jerry.canonical_user_id}`);
  console.log(`   Wallet Address: ${jerry.wallet_address}`);
  console.log(`   Email: ${jerry.email}`);

  // 2. Test the RPC with canonical ID (what the frontend uses)
  console.log("\n2️⃣  TESTING RPC WITH CANONICAL ID (prize:pid:...)");
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "get_user_active_tickets",
    {
      p_user_identifier: jerry.canonical_user_id,
    },
  );

  if (rpcError) {
    console.error("   ❌ RPC Error:", rpcError.message);
  } else {
    console.log(`   ✅ RPC returned ${rpcData?.length || 0} entries`);
    if (rpcData && rpcData.length > 0) {
      rpcData.forEach((entry, i) => {
        console.log(
          `      Entry ${i + 1}: ${entry.ticketnumbers?.length} tickets in ${entry.competitionid}`,
        );
      });
    }
  }

  // 3. Check raw tickets table directly
  console.log("\n3️⃣  CHECKING TICKETS TABLE DIRECTLY:");
  const { data: tickets, error: ticketsError } = await supabase
    .from("tickets")
    .select("competition_id, status, ticket_number")
    .eq("canonical_user_id", jerry.canonical_user_id);

  if (ticketsError) {
    console.error("   ❌ Tickets Error:", ticketsError.message);
  } else {
    console.log(`   ✅ Found ${tickets?.length || 0} tickets total`);

    // Group by competition
    const byComp = {};
    (tickets || []).forEach((t) => {
      if (!byComp[t.competition_id]) {
        byComp[t.competition_id] = [];
      }
      byComp[t.competition_id].push(t);
    });

    for (const [compId, ticketList] of Object.entries(byComp)) {
      console.log(`      Competition ${compId}: ${ticketList.length} tickets`);
      const statuses = {};
      ticketList.forEach((t) => {
        statuses[t.status] = (statuses[t.status] || 0) + 1;
      });
      console.log(`         Statuses: ${JSON.stringify(statuses)}`);
    }
  }

  // 4. Check competitions status
  console.log("\n4️⃣  CHECKING COMPETITION STATUSES:");
  if (tickets && tickets.length > 0) {
    const compIds = [...new Set(tickets.map((t) => t.competition_id))];
    const { data: comps, error: compsError } = await supabase
      .from("competitions")
      .select("id, title, status, end_date, deleted")
      .in("id", compIds);

    if (compsError) {
      console.error("   ❌ Competitions Error:", compsError.message);
    } else {
      (comps || []).forEach((comp) => {
        const isActive =
          comp.status === "active" &&
          !comp.deleted &&
          (!comp.end_date || new Date(comp.end_date) > new Date());
        console.log(`      ${comp.title}`);
        console.log(
          `         Status: ${comp.status} | Deleted: ${comp.deleted} | End: ${comp.end_date}`,
        );
        console.log(
          `         ${isActive ? "✅ ACTIVE (should count)" : "❌ NOT ACTIVE (won't count)"}`,
        );
      });
    }
  }

  // 5. Test the exact logic the AuthContext uses
  console.log("\n5️⃣  SIMULATING AUTHCONTEXT LOGIC:");
  const finishedStatuses = [
    "completed",
    "drawn",
    "sold_out",
    "cancelled",
    "expired",
  ];

  if (
    rpcData &&
    Array.isArray(rpcData) &&
    rpcData.length > 0 &&
    tickets &&
    tickets.length > 0
  ) {
    const compIds = [...new Set(tickets.map((t) => t.competition_id))];
    const { data: comps } = await supabase
      .from("competitions")
      .select("id, status")
      .in("id", compIds);

    const activeCompIds = new Set(
      (comps || [])
        .filter((comp) => {
          if (!comp.status) return false;
          return !finishedStatuses.includes(comp.status.toLowerCase());
        })
        .map((comp) => comp.id),
    );

    const count = rpcData.filter((entry) =>
      activeCompIds.has(entry.competitionid),
    ).length;

    console.log(`   Active competition IDs: ${[...activeCompIds].join(", ")}`);
    console.log(`   Filtered entry count: ${count}`);
    console.log(
      `   ${count > 0 ? '✅ Should display: "' + count + ' active entries"' : '❌ Will display: "0 active entries"'}`,
    );
  }

  console.log("\n" + "=".repeat(60));
  console.log("\n💡 DIAGNOSIS SUMMARY:");
  if (rpcData && rpcData.length > 0) {
    console.log("   ✅ RPC function works and returns data");
    console.log("   ✅ Jerry has entries in the database");
    console.log("\n   🔍 Next steps:");
    console.log("      1. Check browser console for AuthContext logs");
    console.log("      2. Verify AuthContext.refreshUserData is being called");
    console.log("      3. Check if entryCount state is being updated");
    console.log("      4. Look for any errors in the network tab");
  } else {
    console.log("   ❌ RPC is not returning data - database issue");
    console.log("   📝 Run APPLY_BOTH_FIXES.sql to recreate the function");
  }
}

main().catch(console.error);
