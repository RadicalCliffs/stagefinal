// COMPREHENSIVE DIAGNOSIS - Why tickets still show as available
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg",
);

const compId = "a879ba68-d098-42f6-a687-f70fd7109ee8"; // Win 25 SOL

console.log("🔍 COMPREHENSIVE TICKET AVAILABILITY DIAGNOSIS\n");
console.log("=".repeat(70));

async function main() {
  // 1. Check what function exists
  console.log("\n1️⃣  CHECKING FUNCTION IN DATABASE:");
  try {
    const response = await fetch(
      "https://mthwfldcjvpxjtmrqkqm.supabase.co/rest/v1/rpc/get_unavailable_tickets",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey:
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg",
        },
        body: JSON.stringify({ competition_id: compId }),
      },
    );

    if (response.ok) {
      const data = await response.json();
      console.log(`   ✅ Function called successfully via REST`);
      console.log(`   Returned: ${data?.length || 0} unavailable tickets`);
    } else {
      const error = await response.text();
      console.log(`   ❌ REST call failed: ${response.status}`);
      console.log(`   Error: ${error}`);
    }
  } catch (e) {
    console.log(`   ❌ Exception: ${e.message}`);
  }

  // 2. Try with Supabase client (how frontend calls it)
  console.log("\n2️⃣  TESTING WITH SUPABASE CLIENT (FRONTEND METHOD):");
  try {
    const { data, error } = await supabase.rpc("get_unavailable_tickets", {
      competition_id: compId,
    });

    if (error) {
      console.log(`   ❌ Error: ${error.message}`);
      console.log(`   Details: ${error.details}`);
      console.log(`   Hint: ${error.hint}`);
    } else {
      console.log(`   ✅ Success: ${data?.length || 0} unavailable tickets`);
    }
  } catch (e) {
    console.log(`   ❌ Exception: ${e.message}`);
  }

  // 3. Check actual tickets in DB
  console.log("\n3️⃣  TICKETS IN DATABASE:");
  const { data: tickets } = await supabase
    .from("tickets")
    .select("ticket_number, status, canonical_user_id")
    .eq("competition_id", compId)
    .order("ticket_number");

  console.log(`   Total tickets: ${tickets?.length || 0}`);

  // Group by user
  const byUser = {};
  (tickets || []).forEach((t) => {
    const key = t.canonical_user_id || "unknown";
    if (!byUser[key]) byUser[key] = [];
    byUser[key].push(t.ticket_number);
  });

  console.log(`\n   Tickets by user:`);
  for (const [userId, nums] of Object.entries(byUser)) {
    const shortId = userId.includes(":")
      ? userId.split(":").pop().slice(0, 8)
      : userId;
    console.log(
      `      ${shortId}: ${nums.length} tickets (${nums[0]}-${nums[nums.length - 1]})`,
    );
  }

  // 4. Manually query what the function SHOULD return
  console.log("\n4️⃣  MANUAL QUERY (WHAT FUNCTION SHOULD RETURN):");
  const { data: manualTickets } = await supabase
    .from("tickets")
    .select("ticket_number")
    .eq("competition_id", compId)
    .not("ticket_number", "is", null)
    .gt("ticket_number", 0);

  const manualNumbers =
    manualTickets?.map((t) => t.ticket_number).sort((a, b) => a - b) || [];
  console.log(`   Should return: ${manualNumbers.length} unavailable tickets`);
  if (manualNumbers.length > 0) {
    console.log(`   First 10: ${manualNumbers.slice(0, 10).join(", ")}`);
    console.log(`   Last 10: ${manualNumbers.slice(-10).join(", ")}`);
  }

  // 5. Check frontend type definitions
  console.log("\n5️⃣  CHECKING FRONTEND CALL PATTERN:");
  const typeCheckResult = await supabase.rpc("get_unavailable_tickets", {
    competition_id: compId,
  });

  if (typeCheckResult.data) {
    console.log(`   ✅ Frontend call pattern works`);
  }

  console.log("\n" + "=".repeat(70));
  console.log("\n💡 DIAGNOSTIC RESULTS:");
  console.log(
    "   If function returns data but tickets still show as available:",
  );
  console.log("   → Frontend caching issue");
  console.log("   → Check browser console for errors");
  console.log("   → Hard refresh (Ctrl+Shift+R)");
  console.log("   → Clear localStorage/sessionStorage");
  console.log("\n   If function returns NO data:");
  console.log("   → Function not querying tickets table correctly");
  console.log("   → Check function definition in Supabase dashboard");
}

main().catch(console.error);
