// Apply dashboard amount fix - updates missing ticket purchase prices
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error("❌ ERROR: Set SUPABASE_SERVICE_ROLE_KEY environment variable");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const USER_ID = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";
const COMP_ID = "799a8e12-38f2-4989-ad24-15c995d673a6";

async function main() {
  console.log("🔧 Applying dashboard amount fix...\n");

  // Step 1: Check current state
  console.log("📊 Step 1: Checking current ticket prices...");
  const { data: beforeTickets, error: beforeError } = await supabase
    .from("tickets")
    .select("ticket_number, purchase_price")
    .eq("competition_id", COMP_ID)
    .eq("user_id", USER_ID)
    .order("ticket_number");

  if (beforeError) {
    console.error("❌ Error fetching tickets:", beforeError);
    return;
  }

  const nullCount = beforeTickets.filter(
    (t) => t.purchase_price === null || t.purchase_price === 0,
  ).length;
  const correctCount = beforeTickets.filter(
    (t) => t.purchase_price === 0.1,
  ).length;
  const totalBefore = beforeTickets.reduce(
    (sum, t) => sum + (t.purchase_price || 0),
    0,
  );

  console.log(`   Total tickets: ${beforeTickets.length}`);
  console.log(`   Missing/zero price: ${nullCount}`);
  console.log(`   Correct price ($0.10): ${correctCount}`);
  console.log(`   Current total: $${totalBefore.toFixed(2)}`);
  console.log(
    `   Expected total: $${(beforeTickets.length * 0.1).toFixed(2)}\n`,
  );

  if (nullCount === 0) {
    console.log("✅ All tickets already have correct prices!");
    return;
  }

  // Step 2: Get competition ticket price
  console.log("📊 Step 2: Getting competition ticket price...");
  const { data: comp, error: compError } = await supabase
    .from("competitions")
    .select("ticket_price")
    .eq("id", COMP_ID)
    .single();

  if (compError) {
    console.error("❌ Error fetching competition:", compError);
    return;
  }

  console.log(`   Competition ticket_price: $${comp.ticket_price}\n`);

  // Step 3: Update tickets with missing prices
  console.log(
    `🔄 Step 3: Updating ${nullCount} tickets to purchase_price = $${comp.ticket_price}...`,
  );

  const { data: updated, error: updateError } = await supabase
    .from("tickets")
    .update({ purchase_price: comp.ticket_price })
    .eq("competition_id", COMP_ID)
    .eq("user_id", USER_ID)
    .or("purchase_price.is.null,purchase_price.eq.0")
    .select("ticket_number, purchase_price");

  if (updateError) {
    console.error("❌ Error updating tickets:", updateError);
    return;
  }

  console.log(`   ✅ Updated ${updated.length} tickets\n`);

  // Step 4: Verify the fix
  console.log("✅ Step 4: Verifying fix...");
  const { data: afterTickets, error: afterError } = await supabase
    .from("tickets")
    .select("ticket_number, purchase_price")
    .eq("competition_id", COMP_ID)
    .eq("user_id", USER_ID)
    .order("ticket_number");

  if (afterError) {
    console.error("❌ Error verifying:", afterError);
    return;
  }

  const afterNullCount = afterTickets.filter(
    (t) => t.purchase_price === null || t.purchase_price === 0,
  ).length;
  const afterCorrectCount = afterTickets.filter(
    (t) => t.purchase_price === 0.1,
  ).length;
  const totalAfter = afterTickets.reduce(
    (sum, t) => sum + (t.purchase_price || 0),
    0,
  );

  console.log(`   Total tickets: ${afterTickets.length}`);
  console.log(`   Missing/zero price: ${afterNullCount}`);
  console.log(`   Correct price ($0.10): ${afterCorrectCount}`);
  console.log(`   New total: $${totalAfter.toFixed(2)}`);
  console.log(
    `   Expected total: $${(afterTickets.length * 0.1).toFixed(2)}\n`,
  );

  if (
    afterNullCount === 0 &&
    Math.abs(totalAfter - afterTickets.length * 0.1) < 0.01
  ) {
    console.log("🎉 SUCCESS! All tickets now have correct prices.");
    console.log(
      `📊 Dashboard should now show $${totalAfter.toFixed(2)} instead of $${totalBefore.toFixed(2)}\n`,
    );
    console.log(
      "⚠️  NOTE: You still need to apply FIX_DASHBOARD_AMOUNT_ISSUE.sql",
    );
    console.log(
      "   to fix the RPC function (removes non-existent column references)",
    );
  } else {
    console.log("⚠️  WARNING: Some tickets still have incorrect prices");
  }
}

main().catch(console.error);
