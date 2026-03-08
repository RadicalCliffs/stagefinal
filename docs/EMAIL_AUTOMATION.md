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
**Template**: `SENDGRID_TEMPLATE_WINNER` (d-8c1c8a84405443da908cdf85eb30d182)  
**Variables**:

- `Ticket_Number` - The winning ticket number (e.g., "#1234")
- `Prize_Name` - Competition title

**When it runs**: Automatically after VRF draw completes (via scheduled cron)

---

### 3. ✅ Competition Closing Soon **(NEW)**

**Trigger**: Hourly cron check  
**File**: `netlify/functions/comp-closing-soon-scheduler.mts`  
**Template**: `SENDGRID_TEMPLATE_CLOSING_SOON` (d-7a2ad001923849df82394754988394e5)  
**Schedule**: `@hourly`  
**Variables**:

- `prize_name` - Competition title
- `tickets_remaining` - Number of tickets still available
- `hours_remaining` - Hours until close (e.g., "18 hours")
- `entry_price` - Price per ticket (e.g., "£2.50")
- `Cash alternative available` - Static text about cash alternatives

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
SENDGRID_API_KEY=your_sendgrid_api_key_here
SENDGRID_FROM_EMAIL=contact@theprize.io

# SendGrid Dynamic Template IDs
SENDGRID_TEMPLATE_WELCOME=d-3b54b53bcdf744b99cb1f9e7112663a7
SENDGRID_TEMPLATE_WINNER=d-8c1c8a84405443da908cdf85eb30d182
SENDGRID_TEMPLATE_CLOSING_SOON=d-7a2ad001923849df82394754988394e5
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

### Creating the "Winner Notification" Template

1. Go to SendGrid → Email API → Dynamic Templates
2. Create new template: "You've Won!"
3. Add the following variables to your template:
   - `{{Ticket_Number}}` - Winning ticket number (e.g., "#1234")
   - `{{Prize_Name}}` - Competition title

4. Copy the template ID (starts with `d-`) and set it as `SENDGRID_TEMPLATE_WINNER`

**Subject line**: `🎉 You've Won! Ticket {{Ticket_Number}}`

**Body structure**:

```
Congratulations! You're a winner!

Winning Ticket: {{Ticket_Number}}
{{Prize_Name}}

Cash prizes will be sent straight to your connected wallet.
Physical prizes, our team will contact you shortly to arrange delivery.

[View Your Win Button] → Links to user dashboard

Huge congratulations, enjoy it.
```

---

### Creating the "Closing Soon" Template

1. Go to SendGrid → Email API → Dynamic Templates
2. Create new template: "Competition Closing Soon"
3. Add the following variables to your template:
   - `{{prize_name}}`
   - `{{tickets_remaining}}`
   - `{{hours_remaining}}`
   - `{{entry_price}}`
   - `{{Cash alternative available}}`

4. Copy the template ID (starts with `d-`) and set it as `SENDGRID_TEMPLATE_CLOSING_SOON`

### Template Design Tips

**Subject line**: `⏰ Hurry! Only {{tickets_remaining}} tickets left!`

**Body structure**:

```
{{prize_name}}
Only {{tickets_remaining}} tickets left

Closes in {{hours_remaining}}

Entries from {{entry_price}}
{{Cash alternative available}}

[ENTER NOW Button] → Links to competition page

This is your final window.
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
