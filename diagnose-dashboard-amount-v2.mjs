import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "sb_publishable_w8xd4Fu4rqp0fnPpKPoR0Q_W9ykSBrx",
);

const userId = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";
const walletAddress = "0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";
const competitionId = "799a8e12-38f2-4989-ad24-15c995d673a6";

console.log("=== Dashboard Amount Issue Diagnosis (v2) ===\n");
console.log(`User: ${userId}`);
console.log(`Wallet: ${walletAddress}`);
console.log(`Competition: ${competitionId}`);
console.log("Expected: 627 tickets = $62.70");
console.log("Actual: Showing $0.00\n");
console.log("=".repeat(80));

// Step 1: Check competition ticket_price
console.log("\n📊 STEP 1: Check Competition Ticket Price");
console.log("-".repeat(80));
const { data: competition, error: compError } = await supabase
  .from("competitions")
  .select("id, uid, title, ticket_price, tickets_sold, total_tickets, status")
  .eq("id", competitionId)
  .single();

if (compError) {
  console.log("❌ Error fetching competition:", compError.message);
} else {
  console.log("Competition found:");
  console.log(`  Title: ${competition.title}`);
  console.log(`  Ticket Price: $${competition.ticket_price}`);
  console.log(`  Tickets Sold: ${competition.tickets_sold}`);
  console.log(`  Total Tickets: ${competition.total_tickets}`);
  console.log(`  Status: ${competition.status}`);

  if (!competition.ticket_price || competition.ticket_price === 0) {
    console.log("\n❌ ISSUE FOUND: ticket_price is NULL or 0!");
  } else {
    console.log(
      `\n✅ Ticket price is set correctly: $${competition.ticket_price}`,
    );
  }
}

// Step 2: Check joincompetition table entries - select all columns first
console.log(
  "\n\n📊 STEP 2: Check joincompetition Table (all user entries for this competition)",
);
console.log("-".repeat(80));
const { data: joinEntries, error: joinError } = await supabase
  .from("joincompetition")
  .select("*")
  .eq("competitionid", competitionId);

if (joinError) {
  console.log("❌ Error fetching joincompetition:", joinError.message);
  console.log("   Details:", joinError.details);
  console.log("   Hint:", joinError.hint);
} else {
  console.log(
    `Found ${joinEntries.length} total joincompetition entry(ies) for this competition`,
  );

  // Filter to user entries manually
  const userEntries = joinEntries.filter(
    (e) =>
      e.canonical_user_id === userId ||
      e.wallet_address?.toLowerCase() === walletAddress.toLowerCase(),
  );

  console.log(
    `Found ${userEntries.length} entry(ies) for this specific user\n`,
  );

  if (userEntries.length > 0) {
    userEntries.forEach((entry, idx) => {
      console.log(`Entry ${idx + 1}:`);
      console.log(`  All fields:`, JSON.stringify(entry, null, 2));
      console.log();

      // Analyze the issue
      if (entry.numberoftickets === 627) {
        console.log("  🔍 THIS IS THE PROBLEMATIC ENTRY (627 tickets)");

        // Check for different possible column names
        const amountField =
          entry.amountspent || entry.amount_spent || entry.amount;

        if (amountField === null || amountField === undefined) {
          console.log("  ❌ ISSUE: amount field is NULL/undefined");
          console.log(
            `     Available keys in entry: ${Object.keys(entry).join(", ")}`,
          );
        } else if (amountField === 0 || amountField === "0") {
          console.log(
            `  ❌ ISSUE: amount field is 0 (field value: ${amountField})`,
          );
        } else {
          console.log(`  ✅ amount field is set: $${amountField}`);
        }

        if (competition && competition.ticket_price) {
          const expectedAmount =
            entry.numberoftickets * competition.ticket_price;
          console.log(
            `  📐 Expected: ${entry.numberoftickets} tickets × $${competition.ticket_price} = $${expectedAmount.toFixed(2)}`,
          );
        }

        console.log();
      }
    });
  } else {
    console.log(
      "❌ No joincompetition entries found for this user/competition combination",
    );
    console.log(
      "   This means the 627 tickets might be in a different table or under different identifiers",
    );
  }
}

// Step 3: Check tickets table
console.log("\n\n📊 STEP 3: Check tickets Table");
console.log("-".repeat(80));
const { data: ticketsData, error: ticketsError } = await supabase
  .from("tickets")
  .select("*")
  .eq("competition_id", competitionId);

if (ticketsError) {
  console.log("❌ Error fetching tickets:", ticketsError.message);
} else {
  console.log(
    `Found ${ticketsData.length} total ticket(s) in tickets table for this competition`,
  );

  // Filter to user tickets
  const userTickets = ticketsData.filter(
    (t) =>
      t.user_id === userId ||
      t.canonical_user_id === userId ||
      t.wallet_address?.toLowerCase() === walletAddress.toLowerCase(),
  );

  console.log(`Found ${userTickets.length} ticket(s) for this user`);

  if (userTickets.length > 0) {
    const totalAmount = userTickets.reduce(
      (sum, t) => sum + parseFloat(t.purchase_price || t.price || 0),
      0,
    );
    console.log(`  Total purchase price: $${totalAmount.toFixed(2)}`);
    console.log(
      `  Sample ticket IDs: ${userTickets
        .slice(0, 5)
        .map((t) => t.ticket_number)
        .join(", ")}`,
    );
  }
}

// Step 4: Test the RPC function
console.log("\n\n📊 STEP 4: Test get_comprehensive_user_dashboard_entries RPC");
console.log("-".repeat(80));

const { data: rpcData, error: rpcError } = await supabase.rpc(
  "get_comprehensive_user_dashboard_entries",
  { user_identifier: userId },
);

if (rpcError) {
  console.log("❌ Error calling RPC:", rpcError.message);
  console.log("   Code:", rpcError.code);
  console.log("   Details:", rpcError.details);
  console.log("   Hint:", rpcError.hint);
} else {
  console.log(`RPC returned ${rpcData?.length || 0} total entry(ies)\n`);

  // Find the specific competition entry
  const targetEntry = rpcData?.find(
    (e) =>
      e.competition_id === competitionId ||
      e.competition_id?.toString() === competitionId,
  );

  if (targetEntry) {
    console.log("Found competition entry in RPC results:");
    console.log(JSON.stringify(targetEntry, null, 2));

    if (targetEntry.total_tickets === 627) {
      console.log("\n  🔍 THIS IS THE 627-TICKET ENTRY");

      const amountSpent =
        targetEntry.total_amount_spent || targetEntry.amount_spent;

      if (amountSpent === 0 || amountSpent === "0" || amountSpent === null) {
        console.log(
          `  ❌ CONFIRMED: RPC is returning $${amountSpent || 0} for amount_spent`,
        );
      } else {
        console.log(`  ✅ RPC is returning $${amountSpent}`);
      }
    }
  } else {
    console.log(`⚠️  Competition ${competitionId} not found in RPC results`);
    console.log(
      `   Available competition IDs in RPC results:`,
      rpcData?.map((e) => e.competition_id).join(", "),
    );
  }
}

// Step 5: Root Cause Analysis
console.log("\n\n" + "=".repeat(80));
console.log("📋 ROOT CAUSE ANALYSIS");
console.log("=".repeat(80));

const problematicEntry = joinEntries?.find((e) => {
  const isUser =
    e.canonical_user_id === userId ||
    e.wallet_address?.toLowerCase() === walletAddress.toLowerCase();
  return isUser && e.numberoftickets === 627;
});

if (problematicEntry) {
  console.log("\n✅ Found the 627-ticket entry in joincompetition table");
  console.log("\nThe RPC function calculates amount_spent as:");
  console.log(
    "  COALESCE(jc.amountspent, jc.numberoftickets * c.ticket_price, 0)",
  );
  console.log("\nBreaking down the calculation:");

  const amountField =
    problematicEntry.amountspent ||
    problematicEntry.amount_spent ||
    problematicEntry.amount;
  const numberoftickets = problematicEntry.numberoftickets;
  const ticketPrice = competition?.ticket_price;

  console.log(
    `  1. jc amount field = ${amountField === null || amountField === undefined ? "NULL" : amountField}`,
  );
  console.log(`  2. jc.numberoftickets = ${numberoftickets}`);
  console.log(`  3. c.ticket_price = ${ticketPrice}`);
  console.log(
    `  4. calculation = ${numberoftickets} * ${ticketPrice} = ${numberoftickets * (ticketPrice || 0)}`,
  );

  if (amountField === null || amountField === undefined || amountField === 0) {
    console.log(
      "\n❌ PRIMARY ISSUE: amount field in joincompetition is NULL, undefined, or 0",
    );

    if (!ticketPrice || ticketPrice === 0) {
      console.log("❌ SECONDARY ISSUE: c.ticket_price is also NULL or 0");
      console.log("\n🔧 FIX REQUIRED:");
      console.log("   1. Set competition ticket_price if it's 0/NULL");
      console.log("   2. Update joincompetition amount field to correct value");
    } else {
      const calculatedAmount = numberoftickets * ticketPrice;
      console.log(
        `\n✅ Fallback calculation should work: ${numberoftickets} × $${ticketPrice} = $${calculatedAmount.toFixed(2)}`,
      );
      console.log("\n❓ But RPC is returning $0.00 - possible causes:");
      console.log(
        "   - The competition JOIN is failing (c.ticket_price is NULL in the join)",
      );
      console.log("   - The COALESCE logic is not working as expected");
      console.log("   - Type casting issue in the RPC function");
      console.log("\n🔧 RECOMMENDED FIX:");
      console.log(`   UPDATE joincompetition`);
      console.log(`   SET amountspent = ${calculatedAmount.toFixed(2)}`);
      console.log(`   WHERE id = '${problematicEntry.id}';`);
    }
  } else {
    console.log(`\n✅ amount field is populated: $${amountField}`);
    console.log(
      "   The issue must be in the RPC function logic or data retrieval",
    );
  }
} else {
  console.log(
    "\n❌ Could not find 627-ticket entry in joincompetition table for this user",
  );
  console.log("   The entry might be:");
  console.log("   - Under a different user identifier");
  console.log("   - In the tickets table instead");
  console.log("   - In pending_tickets table");
}

console.log("\n" + "=".repeat(80));
console.log("✅ Diagnosis Complete");
console.log("=".repeat(80));
