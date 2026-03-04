import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "sb_publishable_w8xd4Fu4rqp0fnPpKPoR0Q_W9ykSBrx",
);

const USER_ID = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

console.log("=== Checking 'Win 10 ETH!' Entry ===\n");

// Step 1: Find the competition
console.log("Step 1: Find 'Win 10 ETH!' competition");
console.log("-".repeat(80));

const { data: competitions, error: compError } = await supabase
  .from("competitions")
  .select("id, title, ticket_price, created_at")
  .ilike("title", "%Win 10 ETH%")
  .order("created_at", { ascending: false });

if (compError || !competitions || competitions.length === 0) {
  console.log("❌ Could not find competition:", compError?.message);
  process.exit(1);
}

// Use the most recent one
const competition = competitions[0];

console.log(
  `Found ${competitions.length} competition(s) matching "Win 10 ETH":`,
);
competitions.forEach((c, i) => {
  console.log(
    `  ${i + 1}. ${c.title} (${c.id.substring(0, 8)}...) - $${c.ticket_price}`,
  );
});
console.log(`\nUsing most recent: ${competition.title}`);
console.log(`  ID: ${competition.id}`);
console.log(`  Ticket Price: $${competition.ticket_price}\n`);

const COMP_ID = competition.id;

// Step 2: Check competition_entries table
console.log("Step 2: Check competition_entries table");
console.log("-".repeat(80));

const { data: ceEntry, error: ceError } = await supabase
  .from("competition_entries")
  .select("*")
  .eq("canonical_user_id", USER_ID)
  .eq("competition_id", COMP_ID)
  .single();

if (ceError) {
  console.log("❌ Error:", ceError.message);
} else if (!ceEntry) {
  console.log("❌ No entry found in competition_entries table!");
} else {
  console.log("Found entry in competition_entries:");
  console.log(`  ID: ${ceEntry.id}`);
  console.log(`  Tickets Count: ${ceEntry.tickets_count}`);
  console.log(`  Amount Spent: $${ceEntry.amount_spent}`);
  console.log(`  Created: ${ceEntry.created_at}`);
  console.log(`  Updated: ${ceEntry.updated_at}`);

  if (ceEntry.amount_spent === 0 || ceEntry.amount_spent === null) {
    console.log(
      `  ⚠️  ISSUE: Database has amount_spent = ${ceEntry.amount_spent}`,
    );
    console.log(
      `  Expected: ${ceEntry.tickets_count} × $${competition.ticket_price} = $${ceEntry.tickets_count * competition.ticket_price}`,
    );
  } else {
    console.log(`  ✅ Amount is correct in database!`);
  }
}

// Step 3: Check what the RPC returns
console.log("\nStep 3: Check get_user_competition_entries RPC");
console.log("-".repeat(80));

const { data: rpcEntries, error: rpcError } = await supabase.rpc(
  "get_user_competition_entries",
  { p_user_identifier: USER_ID },
);

if (rpcError) {
  console.log("❌ RPC Error:", rpcError.message);
} else {
  const rpcEntry = rpcEntries?.find(
    (e) =>
      e.competition_id === COMP_ID || e.competition_title?.includes("10 ETH"),
  );

  if (!rpcEntry) {
    console.log("❌ Entry not found in RPC results!");
  } else {
    console.log("RPC returned:");
    console.log(`  Competition: ${rpcEntry.competition_title}`);
    console.log(`  Tickets: ${rpcEntry.tickets_count}`);
    console.log(`  Amount Spent: $${rpcEntry.amount_spent}`);

    if (
      rpcEntry.amount_spent === 0 ||
      rpcEntry.amount_spent === "0" ||
      rpcEntry.amount_spent === "0.00"
    ) {
      console.log(`  ❌ RPC STILL RETURNING $0!`);
    } else {
      console.log(`  ✅ RPC returning correct amount!`);
    }
  }
}

// Step 4: Manual fix if needed
if (ceEntry && (ceEntry.amount_spent === 0 || ceEntry.amount_spent === null)) {
  console.log("\nStep 4: Manually fixing this entry");
  console.log("-".repeat(80));

  const correctAmount = ceEntry.tickets_count * competition.ticket_price;

  const { error: updateError } = await supabase
    .from("competition_entries")
    .update({
      amount_spent: correctAmount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ceEntry.id);

  if (updateError) {
    console.log("❌ Failed to update:", updateError.message);
  } else {
    console.log(`✅ Fixed! Set amount_spent = $${correctAmount}`);
    console.log(
      "\nNow refresh the page: https://stage.theprize.io/dashboard/entries",
    );
  }
}

console.log("\n" + "=".repeat(80));
console.log("DIAGNOSIS COMPLETE");
console.log("=".repeat(80));
