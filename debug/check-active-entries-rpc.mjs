// Check if get_user_active_tickets RPC exists and test it
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg",
);

async function checkRpcExists() {
  console.log("🔍 Checking if get_user_active_tickets RPC exists...\n");

  // Try to call the RPC function with a test user
  // First, get a real user with entries
  const { data: users, error: usersError } = await supabase
    .from("canonical_users")
    .select("canonical_user_id, username")
    .limit(5);

  if (usersError) {
    console.error("❌ Error fetching users:", usersError);
    return;
  }

  console.log(`Found ${users?.length || 0} users to test with\n`);

  if (users && users.length > 0) {
    // Test with the first user
    const testUser = users[0];
    console.log(
      `Testing RPC with user: ${testUser.username} (${testUser.canonical_user_id})\n`,
    );

    const { data, error } = await supabase.rpc("get_user_active_tickets", {
      p_user_identifier: testUser.canonical_user_id,
    });

    if (error) {
      console.error("❌ RPC FUNCTION DOES NOT EXIST OR FAILED:");
      console.error("   Error:", error.message);
      console.error("   Code:", error.code);
      console.error("   Details:", error.details);
      console.error(
        "\n📝 Solution: Run APPLY_BOTH_FIXES.sql to create the missing function",
      );
      return false;
    }

    console.log("✅ RPC function exists and is callable!");
    console.log(
      `   Returned ${data?.length || 0} active entries for ${testUser.username}`,
    );
    if (data && data.length > 0) {
      console.log("   Entry details:");
      data.forEach((entry, i) => {
        console.log(`     ${i + 1}. Competition ${entry.competitionid}`);
        console.log(
          `        Tickets: ${entry.ticketnumbers?.length || 0} (${entry.ticketnumbers?.slice(0, 5).join(", ")}${entry.ticketnumbers?.length > 5 ? "..." : ""})`,
        );
      });
    }
    return true;
  }

  return false;
}

async function checkJerryEntries() {
  console.log("\n\n🔍 Checking Jerry's active entries...\n");

  // Get Jerry's canonical user ID
  const { data: jerry, error: jerryError } = await supabase
    .from("canonical_users")
    .select("canonical_user_id, username")
    .eq("username", "jerry")
    .single();

  if (jerryError || !jerry) {
    console.log('⚠️  User "jerry" not found');
    return;
  }

  console.log(`Found user: ${jerry.username} (${jerry.canonical_user_id})\n`);

  // Call the RPC
  const { data, error } = await supabase.rpc("get_user_active_tickets", {
    p_user_identifier: jerry.canonical_user_id,
  });

  if (error) {
    console.error("❌ RPC call failed:", error);
    return;
  }

  console.log(`✅ Jerry has ${data?.length || 0} active entries`);

  if (data && data.length > 0) {
    console.log("\nEntry breakdown:");
    for (const entry of data) {
      // Get competition details
      const { data: comp } = await supabase
        .from("competitions")
        .select("title, status, end_date")
        .eq("id", entry.competitionid)
        .single();

      console.log(`\n  Competition: ${comp?.title || entry.competitionid}`);
      console.log(`  Status: ${comp?.status}`);
      console.log(`  End Date: ${comp?.end_date}`);
      console.log(`  Tickets: ${entry.ticketnumbers?.length || 0}`);
      console.log(
        `  Numbers: ${entry.ticketnumbers?.slice(0, 10).join(", ")}${entry.ticketnumbers?.length > 10 ? "..." : ""}`,
      );
    }
  }
}

async function main() {
  const exists = await checkRpcExists();

  if (exists) {
    await checkJerryEntries();
  }
}

main().catch(console.error);
