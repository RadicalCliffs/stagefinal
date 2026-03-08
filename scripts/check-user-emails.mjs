import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const supabaseServiceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

console.log("=== CHECKING USER EMAIL STATUS ===\n");

// Get all users
const { data: allUsers, error: allError } = await supabase
  .from("canonical_users")
  .select("id, username, email, created_at");

if (allError) {
  console.error("❌ Error:", allError);
  process.exit(1);
}

// Get users with emails
const { data: usersWithEmail, error: emailError } = await supabase
  .from("canonical_users")
  .select("id, username, email")
  .not("email", "is", null)
  .not("email", "eq", "");

if (emailError) {
  console.error("❌ Error:", emailError);
  process.exit(1);
}

console.log(`📊 Total users: ${allUsers.length}`);
console.log(`✅ Users with email: ${usersWithEmail.length}`);
console.log(
  `❌ Users without email: ${allUsers.length - usersWithEmail.length}\n`,
);

if (allUsers.length - usersWithEmail.length > 0) {
  console.log("Users without email addresses:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  allUsers
    .filter((u) => !u.email || u.email.trim() === "")
    .forEach((user, idx) => {
      console.log(`${idx + 1}. ${user.username || user.id}`);
      console.log(`   ID: ${user.id}`);
      console.log(`   Email: ${user.email || "(null)"}\n`);
    });
}
