# Send Welcome Emails to All Users

## Quick Run

1. **Get your credentials from Netlify:**

   ```bash
   npx netlify env:get SUPABASE_SERVICE_ROLE_KEY
   npx netlify env:get SENDGRID_API_KEY
   npx netlify env:get SENDGRID_FROM_EMAIL
   npx netlify env:get SENDGRID_TEMPLATE_WELCOME
   ```

2. **Run the script with credentials:**

   ```bash
   node scripts/send-welcome-emails-to-all.mjs [SUPABASE_KEY] [SENDGRID_KEY] [FROM_EMAIL] [TEMPLATE_ID]
   ```

   Example:

   ```bash
   node scripts/send-welcome-emails-to-all.mjs \
     "eyJhbGci...your-supabase-key" \
     "SG.xxx...your-sendgrid-key" \
     "noreply@theprize.io" \
     "d-xxx...your-template-id"
   ```

## What it does

- Fetches all users with email addresses from `canonical_users`
- Sends SendGrid welcome email using `SENDGRID_TEMPLATE_WELCOME`
- Sends in batches of 100 to avoid rate limits
- Shows progress and summary

## Safety

- 5-second countdown before sending (Ctrl+C to cancel)
- Batch processing with delays
- Error handling per batch

## Example Output

```
=== SENDING WELCOME EMAILS TO ALL USERS ===

📋 Fetching all users with email addresses...

📧 Found 1,234 users with email addresses

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️  WARNING: This will send 1,234 welcome emails!
   From: noreply@theprize.io
   Template: d-xxxxxxxxxxxxx

   Press Ctrl+C to cancel, or wait 5 seconds to continue...

🚀 Starting email send...

📤 Batch 1/13 (100 emails)...
   ✅ Sent 100 emails
📤 Batch 2/13 (100 emails)...
   ✅ Sent 100 emails
...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 SUMMARY:
   ✅ Successfully sent: 1,234
   ❌ Failed: 0
   📧 Total users: 1,234

✨ Done!
```
