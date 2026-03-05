// Diagnose why purchased tickets don't show as unavailable for other users
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg",
);

console.log("🔍 Diagnosing Unavailable Tickets Issue\n");
console.log("=".repeat(60));

async function main() {
  // 1. Get the Win 25 SOL competition
  const { data: comp } = await supabase
    .from("competitions")
    .select("*")
    .eq("title", "Win 25 SOL!")
    .single();

  if (!comp) {
    console.error("❌ Competition not found");
    return;
  }

  console.log("\n1️⃣  COMPETITION INFO:");
  console.log(`   ID: ${comp.id}`);
  console.log(`   Title: ${comp.title}`);
  console.log(`   Status: ${comp.status}`);

  // 2. Check tickets in the tickets table
  console.log("\n2️⃣  TICKETS TABLE QUERY:");
  const { data: tickets, error: ticketsError } = await supabase
    .from("tickets")
    .select("ticket_number, status, canonical_user_id, created_at")
    .eq("competition_id", comp.id)
    .order("ticket_number", { ascending: true });

  if (ticketsError) {
    console.error("   ❌ Error:", ticketsError.message);
  } else {
    console.log(`   Total tickets: ${tickets?.length || 0}`);

    // Group by status
    const byStatus = {};
    (tickets || []).forEach((t) => {
      if (!byStatus[t.status]) byStatus[t.status] = [];
      byStatus[t.status].push(t.ticket_number);
    });

    console.log("\n   Tickets by status:");
    for (const [status, nums] of Object.entries(byStatus)) {
      console.log(`      ${status}: ${nums.length} tickets`);
      console.log(`         Range: ${Math.min(...nums)}-${Math.max(...nums)}`);
      if (nums.length <= 20) {
        console.log(`         Numbers: ${nums.join(", ")}`);
      }
    }

    // Get unique users
    const uniqueUsers = [...new Set(tickets.map((t) => t.canonical_user_id))];
    console.log(`\n   Unique users: ${uniqueUsers.length}`);
    uniqueUsers.forEach((userId) => {
      const userTickets = tickets.filter((t) => t.canonical_user_id === userId);
      console.log(
        `      ${userId}: ${userTickets.length} tickets (${userTickets[0].status})`,
      );
    });
  }

  // 3. Call the get_unavailable_tickets RPC
  console.log("\n3️⃣  get_unavailable_tickets RPC:");
  const { data: unavailable, error: rpcError } = await supabase.rpc(
    "get_unavailable_tickets",
    {
      p_competition_id: comp.id,
    },
  );

  if (rpcError) {
    console.error("   ❌ RPC Error:", rpcError.message);
    console.error("   Details:", rpcError.details);
  } else {
    console.log(
      `   ✅ Returned ${unavailable?.length || 0} unavailable tickets`,
    );
    if (unavailable && unavailable.length > 0) {
      console.log(
        `   Range: ${Math.min(...unavailable)}-${Math.max(...unavailable)}`,
      );
      if (unavailable.length <= 20) {
        console.log(`   Numbers: ${unavailable.join(", ")}`);
      } else {
        console.log(`   First 20: ${unavailable.slice(0, 20).join(", ")}`);
        console.log(`   Last 20: ${unavailable.slice(-20).join(", ")}`);
      }
    }
  }

  // 4. Compare tickets table with RPC result
  if (tickets && unavailable) {
    console.log("\n4️⃣  COMPARISON:");
    console.log(`   Tickets in database: ${tickets.length}`);
    console.log(`   Unavailable from RPC: ${unavailable.length}`);

    const ticketNumbers = tickets.map((t) => t.ticket_number);
    const missingFromRpc = ticketNumbers.filter(
      (num) => !unavailable.includes(num),
    );

    if (missingFromRpc.length > 0) {
      console.log(
        `\n   ⚠️  ${missingFromRpc.length} tickets in DB but NOT in RPC results!`,
      );
      console.log(
        `   Missing tickets: ${missingFromRpc.slice(0, 20).join(", ")}${missingFromRpc.length > 20 ? "..." : ""}`,
      );

      // Check what status these missing tickets have
      const missingTickets = tickets.filter((t) =>
        missingFromRpc.includes(t.ticket_number),
      );
      const missingByStatus = {};
      missingTickets.forEach((t) => {
        if (!missingByStatus[t.status]) missingByStatus[t.status] = 0;
        missingByStatus[t.status]++;
      });
      console.log("\n   Status breakdown of missing tickets:");
      for (const [status, count] of Object.entries(missingByStatus)) {
        console.log(`      ${status}: ${count} tickets`);
      }
    } else {
      console.log("   ✅ All tickets in DB are in RPC results");
    }
  }

  // 5. Check the actual SQL the RPC is executing
  console.log("\n5️⃣  RPC FUNCTION DEFINITION:");
  const { data: funcDef } = await supabase
    .rpc("exec_sql", {
      query: `
        SELECT pg_get_functiondef(oid) as definition
        FROM pg_proc 
        WHERE proname = 'get_unavailable_tickets'
        AND pg_get_function_arguments(oid) = 'p_competition_id text'
      `,
    })
    .catch(() => ({ data: null }));

  if (funcDef) {
    console.log(
      "   Function definition retrieved (check for status filtering)",
    );
  } else {
    console.log("   ⚠️  Could not retrieve function definition");
  }

  console.log("\n" + "=".repeat(60));
  console.log("\n💡 DIAGNOSIS:");
  if (tickets && unavailable) {
    const missing = tickets.length - unavailable.length;
    if (missing > 0) {
      console.log(
        `   ❌ PROBLEM CONFIRMED: ${missing} purchased tickets NOT showing as unavailable`,
      );
      console.log(
        "   Root cause: get_unavailable_tickets RPC likely not querying tickets table",
      );
      console.log("   or not including all ticket statuses");
      console.log(
        "\n   📝 Solution: Update get_unavailable_tickets to include ALL tickets from tickets table",
      );
    } else {
      console.log("   ✅ All purchased tickets are showing as unavailable");
      console.log(
        "   The issue may be a caching problem or frontend state issue",
      );
    }
  }
}

main().catch(console.error);
