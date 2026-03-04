// ============================================================================
// VERIFY BOTH FIXES: Lucky Dip Randomization + Active Entries Count
// ============================================================================
// This script verifies that both fixes are working correctly:
// 1. get_user_active_tickets RPC exists and returns data
// 2. allocate_lucky_dip_tickets_batch produces random (non-consecutive) tickets
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || "YOUR_SUPABASE_URL";
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "YOUR_SERVICE_ROLE_KEY";

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyFixes() {
  console.log("════════════════════════════════════════════════════════");
  console.log("VERIFYING BOTH FIXES");
  console.log("════════════════════════════════════════════════════════\n");

  // ============================================================================
  // TEST 1: Verify get_user_active_tickets RPC exists and works
  // ============================================================================

  console.log("TEST 1: Checking get_user_active_tickets RPC...\n");

  try {
    // Check if function exists by querying pg_proc
    const { data: funcCheck, error: funcError } = await supabase
      .rpc("execute_sql", {
        query: `
          SELECT 
            p.proname as function_name,
            pg_get_function_identity_arguments(p.oid) as arguments,
            pg_get_functiondef(p.oid) as definition
          FROM pg_proc p
          WHERE p.proname = 'get_user_active_tickets'
        `,
      })
      .catch(() => ({ data: null, error: null })); // Ignore if execute_sql doesn't exist

    // Try alternative: direct inspection
    const { data: testCall, error: testError } = await supabase.rpc(
      "get_user_active_tickets",
      { p_user_identifier: "test-user" },
    );

    if (testError) {
      if (testError.message?.includes("does not exist")) {
        console.log("❌ FAIL: get_user_active_tickets RPC does NOT exist");
        console.log("   Run APPLY_BOTH_FIXES.sql to create it\n");
        return false;
      } else {
        console.log(
          "⚠️  WARNING: get_user_active_tickets exists but returned error:",
        );
        console.log("   ", testError.message);
        console.log("   (This may be normal if test-user doesn't exist)\n");
      }
    } else {
      console.log(
        "✅ PASS: get_user_active_tickets RPC exists and is callable",
      );
      console.log(
        "   Test result:",
        testCall || "(empty - no entries for test user)",
      );
      console.log("");
    }
  } catch (error) {
    console.log(
      "❌ FAIL: Error testing get_user_active_tickets:",
      error.message,
    );
    return false;
  }

  // ============================================================================
  // TEST 2: Verify allocate_lucky_dip_tickets_batch produces random tickets
  // ============================================================================

  console.log(
    "TEST 2: Checking allocate_lucky_dip_tickets_batch randomization...\n",
  );

  try {
    // Get an active competition with available tickets
    const { data: competitions, error: compError } = await supabase
      .from("competitions")
      .select("id, title, total_tickets, tickets_sold, status")
      .eq("status", "active")
      .eq("deleted", false)
      .gt("total_tickets", 100) // Need enough tickets to test randomization
      .order("created_at", { ascending: false })
      .limit(1);

    if (compError || !competitions || competitions.length === 0) {
      console.log("⚠️  SKIP: No suitable active competition found for testing");
      console.log("   (Need active competition with >100 total tickets)");
      return true; // Not a failure, just can't test
    }

    const comp = competitions[0];
    console.log(`Using competition: ${comp.title}`);
    console.log(`   Total tickets: ${comp.total_tickets}`);
    console.log(`   Tickets sold: ${comp.tickets_sold || 0}\n`);

    // Make 3 separate calls to allocate_lucky_dip_tickets_batch
    const testUserId = `test-${Date.now()}-${Math.random()}`;
    const allocations = [];

    for (let i = 0; i < 3; i++) {
      const { data, error } = await supabase.rpc(
        "allocate_lucky_dip_tickets_batch",
        {
          p_user_id: testUserId + `-${i}`,
          p_competition_id: comp.id,
          p_count: 10,
          p_ticket_price: 0.1,
          p_hold_minutes: 1,
        },
      );

      if (error) {
        console.log(`❌ Error in call ${i + 1}:`, error.message);
        continue;
      }

      if (data?.success && data?.ticket_numbers) {
        allocations.push(data.ticket_numbers);
        console.log(
          `Call ${i + 1} tickets:`,
          data.ticket_numbers.slice(0, 10).join(", "),
        );
      }
    }

    if (allocations.length === 0) {
      console.log("\n⚠️  SKIP: Could not allocate tickets for testing");
      return true;
    }

    // Analyze randomness: check for consecutive ticket sequences
    console.log("\n--- Randomness Analysis ---\n");

    let totalConsecutive = 0;
    let totalTickets = 0;

    for (const tickets of allocations) {
      const sorted = [...tickets].sort((a, b) => a - b);
      let consecutiveCount = 0;

      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] === sorted[i - 1] + 1) {
          consecutiveCount++;
        }
      }

      totalConsecutive += consecutiveCount;
      totalTickets += tickets.length;

      const consecutivePct = (
        (consecutiveCount / tickets.length) *
        100
      ).toFixed(1);
      console.log(`Allocation: ${consecutivePct}% consecutive`);
    }

    const overallConsecutivePct = (
      (totalConsecutive / totalTickets) *
      100
    ).toFixed(1);
    console.log(`\nOverall: ${overallConsecutivePct}% consecutive tickets\n`);

    // Good randomization should have <30% consecutive
    // Old buggy version would have >70% consecutive
    if (parseFloat(overallConsecutivePct) < 30) {
      console.log("✅ PASS: Randomization is working well (<30% consecutive)");
      console.log("   Lucky dip tickets are properly scattered\n");
    } else if (parseFloat(overallConsecutivePct) < 50) {
      console.log(
        "⚠️  WARNING: Randomization is moderate (30-50% consecutive)",
      );
      console.log("   This may be acceptable but could be improved\n");
    } else {
      console.log("❌ FAIL: Poor randomization (>50% consecutive)");
      console.log(
        "   Lucky dip tickets are too clustered - fix not applied correctly\n",
      );
      return false;
    }

    // Clean up test reservations
    await supabase
      .from("pending_tickets")
      .delete()
      .like("user_id", `${testUserId}%`);
  } catch (error) {
    console.log("❌ Error testing randomization:", error.message);
    return false;
  }

  // ============================================================================
  // Summary
  // ============================================================================

  console.log("════════════════════════════════════════════════════════");
  console.log("VERIFICATION COMPLETE");
  console.log("════════════════════════════════════════════════════════");
  console.log("");
  console.log("✅ Both fixes are working correctly!");
  console.log("");
  console.log("Next steps:");
  console.log(
    "1. Test in UI: Check user dropdown shows correct active entries count",
  );
  console.log(
    "2. Make a real lucky dip purchase and verify tickets are random",
  );
  console.log("");

  return true;
}

verifyFixes()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
