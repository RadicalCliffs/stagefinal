import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

async function verifyPerUserHashes() {
  console.log("🔍 Verifying each user has THEIR OWN topup hash...\n");

  // Get sample tickets with 0x hashes
  const { data: tickets } = await supabase
    .from("tickets")
    .select("ticket_number, canonical_user_id, tx_id, created_at")
    .gte("created_at", "2026-02-20")
    .lte("created_at", "2026-03-08")
    .limit(200);

  const with0x = tickets.filter(
    (t) => t.tx_id?.startsWith("0x") && t.tx_id.length === 66,
  );

  // Group by user
  const byUser = {};
  with0x.forEach((t) => {
    if (!byUser[t.canonical_user_id]) {
      byUser[t.canonical_user_id] = new Set();
    }
    byUser[t.canonical_user_id].add(t.tx_id);
  });

  console.log(`👥 Found ${Object.keys(byUser).length} users in sample\n`);

  // Check if different users have different hashes
  const hashToUsers = {};
  for (const [userId, hashes] of Object.entries(byUser)) {
    for (const hash of hashes) {
      if (!hashToUsers[hash]) {
        hashToUsers[hash] = [];
      }
      hashToUsers[hash].push(userId.substring(0, 25) + "...");
    }
  }

  console.log("📊 Hash Distribution:\n");
  for (const [hash, users] of Object.entries(hashToUsers)) {
    console.log(`Hash ${hash.substring(0, 20)}...`);
    console.log(`  Used by ${users.length} user(s):`);
    users.slice(0, 3).forEach((u) => console.log(`    - ${u}`));
    if (users.length > 3) {
      console.log(`    ... and ${users.length - 3} more`);
    }
    console.log("");
  }

  // Check for problem: same hash used by multiple different users
  const problems = Object.entries(hashToUsers).filter(
    ([hash, users]) => users.length > 1,
  );

  if (problems.length > 0) {
    console.log("❌ PROBLEM FOUND: These hashes are shared by MULTIPLE USERS:");
    problems.forEach(([hash, users]) => {
      console.log(`\n  Hash: ${hash}`);
      console.log(`  Shared by ${users.length} users - THIS IS WRONG!`);
      console.log(`  Users:`, users);
    });
    console.log(
      "\n❌ Each user should have their OWN topup hash, not share with others!\n",
    );
  } else {
    console.log("✅ GOOD: Each hash belongs to ONE user only\n");
  }

  // Show per-user breakdown
  console.log("\n📋 Per-User Breakdown:\n");
  for (const [userId, hashes] of Object.entries(byUser)) {
    const ticketCount = with0x.filter(
      (t) => t.canonical_user_id === userId,
    ).length;
    console.log(`User: ${userId.substring(0, 30)}...`);
    console.log(`  Tickets: ${ticketCount}`);
    console.log(`  Unique hashes: ${hashes.size}`);
    Array.from(hashes).forEach((h) =>
      console.log(`    ${h.substring(0, 25)}...`),
    );
    console.log("");
  }
}

verifyPerUserHashes().catch(console.error);
