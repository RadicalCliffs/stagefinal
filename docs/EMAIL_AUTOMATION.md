# Email Automation System

## Overview

The Prize platform uses SendGrid for automated email notifications. All emails use dynamic templates configured in SendGrid.

## Current Automated Emails

### 1. ✅ Welcome Email (Sign-ups)
**Trigger**: User signs up via `/api/create-user`  
**File**: `netlify/functions/create-user.mts`  
**Template**: `SENDGRID_TEMPLATE_WELCOME`  
**Variables**:
- `username` - User's display name

**When it runs**: Immediately when a new user creates an account

---

### 2. ✅ Winner Notification
**Trigger**: VRF draw completes  
**File**: `netlify/functions/vrf-scheduler.mts`  
**Template**: `SENDGRID_TEMPLATE_WINNER`  
**Variables**:
- `Player Username` - Winner's username
- `Competition Name` - Title of the competition  
- `Prize Value` - Value of the prize (e.g., "£500")
- `Winning Ticket` - The winning ticket number

**When it runs**: Automatically after VRF draw completes (via scheduled cron)

---

### 3. ✅ Competition Closing Soon **(NEW)**
**Trigger**: Hourly cron check  
**File**: `netlify/functions/comp-closing-soon-scheduler.mts`  
**Template**: `SENDGRID_TEMPLATE_CLOSING_SOON`  
**Schedule**: `@hourly`  
**Variables**:
- `Player Username` - User's display name
- `Competition Name` - Title of the competition
- `Prize Value` - Prize value (e.g., "£1000")
- `End Date` - When competition closes (e.g., "Dec 25, 2024 at 6:00 PM")
- `Ticket Price` - Price per ticket (e.g., "£2.50")
- `Hours Remaining` - Hours until close (e.g., "18")
- `Tickets Sold` - Number of tickets sold
- `Total Tickets` - Total tickets available
- `Percentage Sold` - Percentage of tickets sold (e.g., "75%")

**Logic**:
- Runs every hour
- Finds competitions ending within 24 hours
- Only emails users who:
  - Have an email address
  - Haven't entered this competition yet
  - Haven't received a closing soon email in the last 6 hours (prevents spam)
- Marks competition as notified (won't send again for 12 hours)

---

### 4. ✅ Competition Live (FOMO)
**Trigger**: Manual scheduler  
**File**: `netlify/functions/fomo-email-scheduler.mts`  
**Template**: `SENDGRID_TEMPLATE_FOMO`  
**Variables**:
- `Player Username`
- `Active Competitions` - Number of active competitions
- `Total Prizes` - Total prize value available

---

### 5. ✅ Competition Live (Specific)
**Trigger**: Manual scheduler  
**File**: `netlify/functions/comp-live-email-scheduler.mts`  
**Template**: `SENDGRID_TEMPLATE_COMP_LIVE`  
**Variables**:
- `Player Username`
- `Competition Name`
- `Prize Value`
- `End Date`
- `Ticket Price`

---

## Required Environment Variables

### Netlify Environment Variables

```bash
# SendGrid API credentials
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxx
SENDGRID_FROM_EMAIL=noreply@theprize.io

# SendGrid Dynamic Template IDs
SENDGRID_TEMPLATE_WELCOME=d-xxxxxxxxxxxxxxxx
SENDGRID_TEMPLATE_WINNER=d-xxxxxxxxxxxxxxxx
SENDGRID_TEMPLATE_CLOSING_SOON=d-xxxxxxxxxxxxxxxx
SENDGRID_TEMPLATE_FOMO=d-xxxxxxxxxxxxxxxx
SENDGRID_TEMPLATE_COMP_LIVE=d-xxxxxxxxxxxxxxxx
```

### Database Columns Added

**competitions table**:
- `last_closing_soon_email_sent` (timestamp) - When we last sent closing soon email for this competition

**canonical_users table**:
- `last_closing_soon_notification` (timestamp) - When user last received ANY closing soon email (prevents spam)

---

## SendGrid Template Setup

### Creating the "Closing Soon" Template

1. Go to SendGrid → Email API → Dynamic Templates
2. Create new template: "Competition Closing Soon"
3. Add the following variables to your template:
   - `{{Player Username}}`
   - `{{Competition Name}}`
   - `{{Prize Value}}`
   - `{{End Date}}`
   - `{{Ticket Price}}`
   - `{{Hours Remaining}}`
   - `{{Tickets Sold}}`
   - `{{Total Tickets}}`
   - `{{Percentage Sold}}`

4. Copy the template ID (starts with `d-`) and set it as `SENDGRID_TEMPLATE_CLOSING_SOON`

### Template Design Tips

**Subject line**: `⏰ {{Competition Name}} closes in {{Hours Remaining}} hours!`

**Body structure**:
```
Hi {{Player Username}},

Hurry! {{Competition Name}} is closing soon and you haven't entered yet!

🏆 Prize: {{Prize Value}}
⏰ Closes: {{End Date}} ({{Hours Remaining}} hours remaining)
🎫 Ticket Price: {{Ticket Price}}
📊 {{Tickets Sold}} / {{Total Tickets}} tickets sold ({{Percentage Sold}})

[Enter Now Button] → Links to competition page

Don't miss your chance to win!
```

---

## Database Migration

Run the migration to add tracking columns:

```sql
-- Run this in Supabase SQL Editor
\i supabase/migrations/add_closing_soon_email_tracking.sql
```

Or via CLI:
```bash
npx supabase db push
```

---

## Testing

### Test Welcome Email
```bash
curl -X POST https://stage.theprize.io/api/create-user \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","username":"TestUser"}'
```

### Test Closing Soon Scheduler (Manual Trigger)
```bash
curl -X POST https://stage.theprize.io/.netlify/functions/comp-closing-soon-scheduler
```

### Test Email Service
```bash
curl -X POST https://stage.theprize.io/api/send-test-email \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com"}'
```

---

## Monitoring

### View Logs
```bash
netlify functions:log comp-closing-soon-scheduler
```

### Check SendGrid Activity
1. Go to SendGrid Dashboard
2. Activity → Search by email or template
3. View delivery status, opens, clicks

---

## Rate Limits

- SendGrid free tier: 100 emails/day
- SendGrid Essentials: 40,000-100,000 emails/month  
- Batch size: 100 emails per API call
- Anti-spam: 6-hour cooldown between closing soon emails per user

---

## Troubleshooting

### Emails not sending?
1. Check `SENDGRID_API_KEY` is set in Netlify environment variables
2. Verify template IDs are correct (`d-xxxxxxxxx` format)
3. Check function logs: `netlify functions:log`
4. Verify SendGrid API key has "Mail Send" permissions

### Users getting too many emails?
- Adjust the cooldown period in `comp-closing-soon-scheduler.mts` (currently 6 hours)
- Adjust competition notification window (currently 12 hours between same comp emails)

### Template variables not working?
- SendGrid uses `{{Variable Name}}` format (case-sensitive)
- Match variable names exactly as defined in the code
- Test templates using SendGrid's template preview feature

---

## Future Enhancements

Potential additional automated emails:
- [ ] Account balance low warning
- [ ] Inactive user re-engagement (7 days, 30 days)
- [ ] Competition almost sold out (95% tickets sold)
- [ ] Daily digest of new competitions
- [ ] Weekly summary of wins and activity
