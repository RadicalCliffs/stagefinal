import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "sb_publishable_w8xd4Fu4rqp0fnPpKPoR0Q_W9ykSBrx",
);

const userId = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";
const competitionId = "799a8e12-38f2-4989-ad24-15c995d673a6";

console.log("=== Dashboard Amount Issue Diagnosis ===\n");
console.log(`User: ${userId}`);
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

// Step 2: Check joincompetition table entries
console.log("\n\n📊 STEP 2: Check joincompetition Table");
console.log("-".repeat(80));
const { data: joinEntries, error: joinError } = await supabase
  .from("joincompetition")
  .select(
    "id, competitionid, canonical_user_id, wallet_address, numberoftickets, amountspent, ticketnumbers, purchasedate, transactionhash, created_at",
  )
  .eq("competitionid", competitionId)
  .or(
    `canonical_user_id.eq.${userId},wallet_address.ilike.0x0ff51ec0ecc9ae1e5e6048976ba307c849781363`,
  )
  .order("created_at", { ascending: false });

if (joinError) {
  console.log("❌ Error fetching joincompetition:", joinError.message);
} else {
  console.log(`Found ${joinEntries.length} joincompetition entry(ies):\n`);

  joinEntries.forEach((entry, idx) => {
    console.log(`Entry ${idx + 1}:`);
    console.log(`  ID: ${entry.id}`);
    console.log(`  Number of Tickets: ${entry.numberoftickets}`);
    console.log(`  Amount Spent: ${entry.amountspent}`);
    console.log(`  Canonical User ID: ${entry.canonical_user_id}`);
    console.log(`  Wallet Address: ${entry.wallet_address}`);
    console.log(`  Purchase Date: ${entry.purchasedate}`);
    console.log(`  Created At: ${entry.created_at}`);
    console.log(`  Transaction Hash: ${entry.transactionhash}`);

    if (entry.ticketnumbers) {
      const ticketArray = entry.ticketnumbers.split(",");
      console.log(
        `  Ticket Numbers: ${ticketArray.length} tickets (${ticketArray.slice(0, 3).join(", ")}...)`,
      );
    } else {
      console.log(`  Ticket Numbers: NULL`);
    }

    console.log();

    // Analyze the issue
    if (entry.numberoftickets === 627) {
      console.log("  🔍 THIS IS THE PROBLEMATIC ENTRY (627 tickets)");

      if (entry.amountspent === null) {
        console.log("  ❌ ISSUE: amountspent is NULL");
      } else if (entry.amountspent === 0 || entry.amountspent === "0") {
        console.log("  ❌ ISSUE: amountspent is 0");
      } else {
        console.log(`  ✅ amountspent is set: $${entry.amountspent}`);
      }

      if (competition && competition.ticket_price) {
        const expectedAmount = entry.numberoftickets * competition.ticket_price;
        console.log(
          `  📐 Calculation: ${entry.numberoftickets} tickets × $${competition.ticket_price} = $${expectedAmount.toFixed(2)}`,
        );

        if (entry.amountspent !== expectedAmount) {
          console.log(
            `  ⚠️  Stored amountspent ($${entry.amountspent}) doesn't match calculated ($${expectedAmount.toFixed(2)})`,
          );
        }
      }

      console.log();
    }
  });
}

// Step 3: Test the RPC function
console.log("\n📊 STEP 3: Test get_comprehensive_user_dashboard_entries RPC");
console.log("-".repeat(80));
const { data: rpcData, error: rpcError } = await supabase.rpc(
  "get_comprehensive_user_dashboard_entries",
  { user_identifier: userId },
);

if (rpcError) {
  console.log("❌ Error calling RPC:", rpcError.message);
  console.log("Full error:", JSON.stringify(rpcError, null, 2));
} else {
  console.log(`RPC returned ${rpcData.length} total entry(ies)\n`);

  // Find the specific competition entry
  const targetEntry = rpcData.find((e) => e.competition_id === competitionId);

  if (targetEntry) {
    console.log("Found competition entry in RPC results:");
    console.log(`  Competition ID: ${targetEntry.competition_id}`);
    console.log(`  Title: ${targetEntry.title}`);
    console.log(`  Total Tickets: ${targetEntry.total_tickets}`);
    console.log(`  Total Amount Spent: $${targetEntry.total_amount_spent}`);
    console.log(`  Entry Type: ${targetEntry.entry_type}`);
    console.log(`  Transaction Hash: ${targetEntry.transaction_hash}`);

    if (targetEntry.total_tickets === 627) {
      console.log("\n  🔍 THIS IS THE 627-TICKET ENTRY");

      if (
        targetEntry.total_amount_spent === 0 ||
        targetEntry.total_amount_spent === "0"
      ) {
        console.log("  ❌ CONFIRMED: RPC is returning $0.00 for amount_spent");
      } else {
        console.log(`  ✅ RPC is returning $${targetEntry.total_amount_spent}`);
      }
    }
  } else {
    console.log(`⚠️  Competition ${competitionId} not found in RPC results`);
  }
}

// Step 4: Check if there are tickets table entries instead
console.log("\n\n📊 STEP 4: Check tickets Table");
console.log("-".repeat(80));
const { data: ticketsData, error: ticketsError } = await supabase
  .from("tickets")
  .select(
    "id, ticket_number, competition_id, user_id, purchase_price, status, purchase_date",
  )
  .eq("competition_id", competitionId)
  .eq("user_id", userId);

if (ticketsError) {
  console.log("❌ Error fetching tickets:", ticketsError.message);
} else {
  console.log(`Found ${ticketsData.length} ticket(s) in tickets table`);

  if (ticketsData.length > 0) {
    const totalAmount = ticketsData.reduce(
      (sum, t) => sum + (parseFloat(t.purchase_price) || 0),
      0,
    );
    console.log(`  Total purchase price: $${totalAmount.toFixed(2)}`);
    console.log(
      `  Tickets: ${ticketsData.map((t) => t.ticket_number).join(", ")}`,
    );
  }
}

// Step 5: Root Cause Analysis
console.log("\n\n" + "=".repeat(80));
console.log("📋 ROOT CAUSE ANALYSIS");
console.log("=".repeat(80));

if (joinEntries && joinEntries.length > 0) {
  const problematicEntry = joinEntries.find((e) => e.numberoftickets === 627);

  if (problematicEntry) {
    console.log("\n✅ Found the 627-ticket entry in joincompetition table");
    console.log("\nThe RPC function calculates amount_spent as:");
    console.log(
      "  COALESCE(jc.amountspent, jc.numberoftickets * c.ticket_price, 0)",
    );
    console.log("\nBreaking down the calculation:");

    const amountspent = problematicEntry.amountspent;
    const numberoftickets = problematicEntry.numberoftickets;
    const ticketPrice = competition?.ticket_price;

    console.log(
      `  1. jc.amountspent = ${amountspent === null ? "NULL" : amountspent}`,
    );
    console.log(`  2. jc.numberoftickets = ${numberoftickets}`);
    console.log(`  3. c.ticket_price = ${ticketPrice}`);
    console.log(
      `  4. jc.numberoftickets * c.ticket_price = ${numberoftickets * (ticketPrice || 0)}`,
    );

    if (amountspent === null || amountspent === 0) {
      console.log("\n❌ PRIMARY ISSUE: jc.amountspent is NULL or 0");

      if (!ticketPrice || ticketPrice === 0) {
        console.log("❌ SECONDARY ISSUE: c.ticket_price is also NULL or 0");
        console.log("\n🔧 FIX REQUIRED:");
        console.log("   1. Set competition ticket_price if it's 0/NULL");
        console.log(
          "   2. Update joincompetition.amountspent to correct value",
        );
      } else {
        const calculatedAmount = numberoftickets * ticketPrice;
        console.log(
          `\n✅ Fallback calculation should work: ${numberoftickets} × $${ticketPrice} = $${calculatedAmount.toFixed(2)}`,
        );
        console.log("\n❓ Why is the RPC returning $0.00?");
        console.log("   Possible causes:");
        console.log(
          "   - The competition JOIN is failing (c.ticket_price is NULL in the join)",
        );
        console.log("   - There's a type casting issue");
        console.log("   - The COALESCE is not working as expected");
      }
    } else {
      console.log(`\n✅ jc.amountspent is populated: $${amountspent}`);
      console.log("   The issue must be elsewhere in the data flow");
    }
  } else {
    console.log(
      "\n❌ Could not find 627-ticket entry in joincompetition table",
    );
  }
} else {
  console.log(
    "\n❌ No joincompetition entries found for this user/competition",
  );
}

console.log("\n" + "=".repeat(80));
console.log("✅ Diagnosis Complete");
console.log("=".repeat(80));
