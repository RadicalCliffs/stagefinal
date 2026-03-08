import { createClient } from "@supabase/supabase-js";

// Hardcoded for production StageDB
const supabaseUrl = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.argv[2] ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczNTE2ODgzMCwiZXhwIjoyMDUwNzQ0ODMwfQ.1hq0RLZ9yiNVLVxJFdzJfQTX2UE0N8aXhPbIQgzPFxE";
const sendgridApiKey = process.env.SENDGRID_API_KEY || process.argv[3];
const sendgridFromEmail =
  process.env.SENDGRID_FROM_EMAIL || process.argv[4] || "contact@theprize.io";
const sendgridTemplateId =
  process.env.SENDGRID_TEMPLATE_WELCOME || process.argv[5];

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("❌ Missing Supabase configuration");
  process.exit(1);
}

if (!sendgridApiKey || !sendgridTemplateId) {
  console.error("❌ Missing SendGrid configuration");
  console.error("   SENDGRID_API_KEY:", sendgridApiKey ? "✓" : "✗");
  console.error(
    "   SENDGRID_TEMPLATE_WELCOME:",
    sendgridTemplateId ? "✓" : "✗",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

console.log("=== SENDING WELCOME EMAILS TO ALL USERS ===\n");

/**
 * Send welcome emails in batches using SendGrid
 */
async function sendWelcomeEmailBatch(users) {
  const personalizations = users.map((user) => ({
    to: [{ email: user.email }],
    dynamic_template_data: {
      username: user.username || "Player",
      Competitions_URL: "https://theprize.io/competitions",
    },
  }));

  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sendgridApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations,
        from: { email: sendgridFromEmail, name: "ThePrize.io" },
        template_id: sendgridTemplateId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ SendGrid error (${response.status}):`, errorText);
      return { success: false, count: 0 };
    }

    console.log(`   ✅ Sent ${users.length} emails`);
    return { success: true, count: users.length };
  } catch (error) {
    console.error(`❌ Batch send error:`, error.message);
    return { success: false, count: 0 };
  }
}

async function main() {
  // Fetch all users with email addresses
  console.log("📋 Fetching all users with email addresses...\n");

  const { data: users, error } = await supabase
    .from("canonical_users")
    .select("canonical_user_id, email, username")
    .not("email", "is", null)
    .not("email", "eq", "")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("❌ Error fetching users:", error);
    process.exit(1);
  }

  if (!users || users.length === 0) {
    console.log("ℹ️  No users found with email addresses");
    process.exit(0);
  }

  console.log(`📧 Found ${users.length} users with email addresses\n`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Ask for confirmation
  console.log(`⚠️  WARNING: This will send ${users.length} welcome emails!`);
  console.log(`   From: ${sendgridFromEmail}`);
  console.log(`   Template: ${sendgridTemplateId}`);
  console.log(
    `\n   Press Ctrl+C to cancel, or wait 5 seconds to continue...\n`,
  );

  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log("🚀 Starting email send...\n");

  let totalSent = 0;
  let totalFailed = 0;

  // Send in batches of 100 (SendGrid limit is 1000 per request, but we'll be conservative)
  const batchSize = 100;
  const totalBatches = Math.ceil(users.length / batchSize);

  for (let i = 0; i < users.length; i += batchSize) {
    const batch = users.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;

    console.log(
      `📤 Batch ${batchNumber}/${totalBatches} (${batch.length} emails)...`,
    );

    const result = await sendWelcomeEmailBatch(batch);

    if (result.success) {
      totalSent += result.count;
    } else {
      totalFailed += batch.length;
    }

    // Small delay between batches to avoid rate limits
    if (i + batchSize < users.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log("📊 SUMMARY:");
  console.log(`   ✅ Successfully sent: ${totalSent}`);
  console.log(`   ❌ Failed: ${totalFailed}`);
  console.log(`   📧 Total users: ${users.length}`);
  console.log("\n✨ Done!\n");
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
