/**
 * INSTRUCTIONS TO FIX UNAVAILABLE TICKETS ISSUE
 * ==============================================
 *
 * PROBLEM:
 * --------
 * - Purchased tickets show as unavailable for the buyer
 * - But show as AVAILABLE for other users (they can select but not buy them)
 * - Root cause: Function overload ambiguity in get_unavailable_tickets
 *
 * SOLUTION:
 * ---------
 * 1. Open Supabase Dashboard: https://supabase.com/dashboard/project/mthwfldcjvpxjtmrqkqm/sql/new
 * 2. Copy the SQL from `FIX_UNAVAILABLE_TICKETS_NOW.sql`
 * 3. Paste and execute in the SQL Editor
 * 4. Run this verification script: node verify-unavailable-fix.mjs
 *
 * WHAT THE FIX DOES:
 * ------------------
 * - Removes UUID overload (causes ambiguity)
 * - Uses `competition_id` parameter name (matches frontend)
 * - Queries ALL tickets from tickets table (ensures all show as unavailable)
 * - Adds proper error handling
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg",
);

console.log("🔍 VERIFYING UNAVAILABLE TICKETS FIX\n");
console.log("=".repeat(70));

const compId = "a879ba68-d098-42f6-a687-f70fd7109ee8"; // Win 25 SOL

async function main() {
  // 1. Check how many tickets exist
  const { data: tickets } = await supabase
    .from("tickets")
    .select("ticket_number, canonical_user_id")
    .eq("competition_id", compId);

  console.log(`\n1️⃣  TICKETS IN DATABASE:`);
  console.log(`   Total: ${tickets?.length || 0} tickets`);

  const uniqueUsers = [
    ...new Set(tickets?.map((t) => t.canonical_user_id) || []),
  ];
  console.log(`   Owned by: ${uniqueUsers.length} different users`);

  // 2. Test the RPC function
  console.log(`\n2️⃣  TESTING RPC FUNCTION:`);

  try {
    const { data: unavailable, error } = await supabase.rpc(
      "get_unavailable_tickets",
      {
        competition_id: compId,
      },
    );

    if (error) {
      console.log(`   ❌ RPC FAILED: ${error.message}`);
      console.log(`\n   This means the fix has NOT been applied yet.`);
      console.log(`\n   📝 ACTION REQUIRED:`);
      console.log(
        `      1. Open: https://supabase.com/dashboard/project/mthwfldcjvpxjtmrqkqm/sql/new`,
      );
      console.log(
        `      2. Copy all contents from: FIX_UNAVAILABLE_TICKETS_NOW.sql`,
      );
      console.log(`      3. Paste into SQL Editor and click "Run"`);
      console.log(`      4. Re-run this script to verify`);
      return;
    }

    console.log(`   ✅ RPC SUCCESS`);
    console.log(`   Returned: ${unavailable?.length || 0} unavailable tickets`);

    // 3. Compare
    console.log(`\n3️⃣  COMPARISON:`);
    console.log(`   Tickets in DB: ${tickets?.length}`);
    console.log(`   Tickets in RPC: ${unavailable?.length}`);

    if (tickets?.length === unavailable?.length) {
      console.log(`\n   ✅ PERFECT MATCH!`);
      console.log(`\n🎉 FIX IS WORKING CORRECTLY!`);
      console.log(
        `   All purchased tickets will now show as unavailable to other users.`,
      );
      console.log(
        `   Users can no longer select tickets that have been purchased.`,
      );
    } else {
      const missing = (tickets?.length || 0) - (unavailable?.length || 0);
      console.log(
        `\n   ⚠️  MISMATCH: ${missing} tickets not showing as unavailable`,
      );
      console.log(
        `   This means some purchased tickets can still be selected by others.`,
      );
      console.log(
        `\n   📝 The fix may need to be re-applied or there's a different issue.`,
      );
    }

    // 4. Show which tickets are missing (if any)
    if (tickets && unavailable && tickets.length !== unavailable.length) {
      const ticketNumbers = new Set(tickets.map((t) => t.ticket_number));
      const unavailableNumbers = new Set(unavailable);
      const missing = Array.from(ticketNumbers).filter(
        (n) => !unavailableNumbers.has(n),
      );

      if (missing.length > 0 && missing.length < 50) {
        console.log(
          `\n   Missing ticket numbers: ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? "..." : ""}`,
        );
      }
    }
  } catch (e) {
    console.error(`   ❌ EXCEPTION: ${e.message}`);
    console.log(`\n   The RPC function may not exist or has errors.`);
    console.log(`   Please apply the fix from FIX_UNAVAILABLE_TICKETS_NOW.sql`);
  }

  console.log("\n" + "=".repeat(70));
}

main().catch(console.error);
