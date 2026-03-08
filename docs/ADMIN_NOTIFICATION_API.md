# Admin Notification API

This document describes the API endpoints for sending notifications to users from the external admin dashboard.

## Authentication

All admin endpoints require authentication via **one of**:

1. **API Key** (recommended for external dashboards):
   - Header: `X-Admin-Api-Key: your-admin-api-key`
   - Or Bearer token: `Authorization: Bearer your-admin-api-key`

2. **Admin User Session**:
   - User must have `is_admin = true` in `canonical_users` table
   - Pass user's auth token in `Authorization: Bearer {token}`

### Setting Up the Admin API Key

Add `ADMIN_API_KEY` to your Netlify environment variables:

```bash
# Generate a secure random key
ADMIN_API_KEY=your-secure-random-key-here
```

---

## Endpoints

### 1. Push Notification with Template (Recommended)

**Endpoint**: `POST /api/notifications/admin/template`

Send notifications using predefined templates that match your email notifications but are short and digestible.

#### Request Body

```json
{
  "template": "winner",
  "data": {
    "ticket_number": "#1234",
    "prize_name": "Bitcoin Prize"
  },
  "user_ids": ["user-uuid-1", "user@email.com", "username"],
  "send_to_all": false,
  "competition_id": "optional-competition-uuid",
  "expires_at": "2024-12-31T23:59:59Z"
}
```

#### Parameters

| Field            | Type     | Required | Description                                  |
| ---------------- | -------- | -------- | -------------------------------------------- |
| `template`       | string   | **Yes**  | Template key (see Available Templates below) |
| `data`           | object   | No       | Template placeholder values                  |
| `user_ids`       | string[] | No\*     | User IDs, emails, or usernames to target     |
| `send_to_all`    | boolean  | No\*     | Send to all users (default: false)           |
| `competition_id` | string   | No       | Link notification to a competition           |
| `prize_info`     | string   | No       | Additional prize information                 |
| `amount`         | number   | No       | Amount for payment/topup notifications       |
| `expires_at`     | string   | No       | ISO 8601 expiration timestamp                |

\*Either `user_ids` or `send_to_all=true` is required.

#### Response

```json
{
  "ok": true,
  "template": "winner",
  "title_sent": "🎉 You Won!",
  "message_sent": "Congratulations! Ticket #1234 won Bitcoin Prize! Check your dashboard for details.",
  "sent": 150,
  "failed": 0,
  "total_targeted": 150
}
```

---

### 2. Available Templates

Get list of available notification templates and their placeholders.

**Endpoint**: `GET /api/notifications/admin/templates`

#### Response

```json
{
  "ok": true,
  "templates": [
    {
      "key": "winner",
      "type": "win",
      "title_preview": "🎉 You Won!",
      "message_template": "Congratulations! Ticket {{ticket_number}} won {{prize_name}}! {{action_text}}",
      "default_action": "Check your dashboard for details.",
      "placeholders": ["ticket_number", "prize_name", "action_text"]
    }
  ],
  "usage": {
    "endpoint": "POST /api/notifications/admin/template",
    "example": { ... }
  }
}
```

---

### Available Template Keys

| Template              | Type              | Description              | Placeholders                                                        |
| --------------------- | ----------------- | ------------------------ | ------------------------------------------------------------------- |
| `winner`              | win               | User won a prize         | `ticket_number`, `prize_name`, `action_text`                        |
| `closing_soon`        | special_offer     | Competition ending soon  | `prize_name`, `hours_remaining`, `tickets_remaining`, `entry_price` |
| `comp_live`           | announcement      | New competition launched | `competition_name`, `prize_value`, `ticket_price`                   |
| `welcome`             | announcement      | New user welcome         | `username`                                                          |
| `fomo`                | special_offer     | Engagement nudge         | `active_competitions`, `total_prizes`                               |
| `payment_success`     | payment           | Payment confirmed        | `amount`, `details`                                                 |
| `topup_success`       | topup             | Wallet top-up confirmed  | `amount`, `balance`                                                 |
| `entry_confirmed`     | entry             | Entry purchased          | `ticket_count`, `competition_name`                                  |
| `competition_ended`   | competition_ended | Competition finished     | `competition_name`                                                  |
| `custom_announcement` | announcement      | Custom message           | `title`, `message`                                                  |
| `custom_offer`        | special_offer     | Custom promotional       | `title`, `message`                                                  |

---

### 3. Push Custom Notification

**Endpoint**: `POST /api/notifications/admin/push`

Send a fully custom notification without using templates.

#### Request Body

```json
{
  "type": "announcement",
  "title": "📢 Important Update",
  "message": "We've added new features to your dashboard!",
  "user_ids": ["user-uuid-1", "user-uuid-2"],
  "send_to_all": false,
  "competition_id": null,
  "prize_info": null,
  "expires_at": null
}
```

#### Parameters

| Field            | Type     | Required | Description                                                                                      |
| ---------------- | -------- | -------- | ------------------------------------------------------------------------------------------------ |
| `type`           | string   | **Yes**  | One of: `win`, `competition_ended`, `special_offer`, `announcement`, `payment`, `topup`, `entry` |
| `title`          | string   | **Yes**  | Notification title                                                                               |
| `message`        | string   | **Yes**  | Notification message                                                                             |
| `user_ids`       | string[] | No\*     | Array of user UUIDs                                                                              |
| `send_to_all`    | boolean  | No\*     | Send to all users                                                                                |
| `competition_id` | string   | No       | Associated competition UUID                                                                      |
| `prize_info`     | string   | No       | Prize details                                                                                    |
| `expires_at`     | string   | No       | ISO 8601 expiration                                                                              |

#### Response

```json
{
  "ok": true,
  "sent": 2,
  "failed": 0,
  "total_targeted": 2
}
```

---

### 4. Get Statistics

**Endpoint**: `GET /api/notifications/admin/stats`

Get notification system statistics.

#### Response

```json
{
  "ok": true,
  "stats": {
    "total_notifications": 15234,
    "unread_notifications": 892,
    "by_type": {
      "win": 45,
      "announcement": 5000,
      "entry": 8000,
      "payment": 1500,
      "special_offer": 689
    },
    "total_users": 5432
  }
}
```

---

## Code Examples

### JavaScript/TypeScript (Admin Dashboard)

```typescript
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const API_BASE = "https://theprize.io/api/notifications";

// Send winner notification
async function notifyWinner(
  userId: string,
  ticketNumber: string,
  prizeName: string,
) {
  const response = await fetch(`${API_BASE}/admin/template`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Api-Key": ADMIN_API_KEY,
    },
    body: JSON.stringify({
      template: "winner",
      data: {
        ticket_number: ticketNumber,
        prize_name: prizeName,
      },
      user_ids: [userId],
    }),
  });

  return response.json();
}

// Send closing soon notification to users without entries
async function notifyClosingSoon(
  userIds: string[],
  competition: {
    name: string;
    hoursRemaining: number;
    ticketsRemaining: number;
    entryPrice: string;
  },
) {
  const response = await fetch(`${API_BASE}/admin/template`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Api-Key": ADMIN_API_KEY,
    },
    body: JSON.stringify({
      template: "closing_soon",
      data: {
        prize_name: competition.name,
        hours_remaining: `${competition.hoursRemaining} hours`,
        tickets_remaining: competition.ticketsRemaining.toString(),
        entry_price: competition.entryPrice,
      },
      user_ids: userIds,
    }),
  });

  return response.json();
}

// Broadcast announcement to all users
async function broadcastAnnouncement(title: string, message: string) {
  const response = await fetch(`${API_BASE}/admin/template`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Api-Key": ADMIN_API_KEY,
    },
    body: JSON.stringify({
      template: "custom_announcement",
      data: { title, message },
      send_to_all: true,
    }),
  });

  return response.json();
}

// Send special offer to specific users
async function sendSpecialOffer(
  emails: string[],
  title: string,
  message: string,
  expiresAt?: string,
) {
  const response = await fetch(`${API_BASE}/admin/template`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Api-Key": ADMIN_API_KEY,
    },
    body: JSON.stringify({
      template: "custom_offer",
      data: { title, message },
      user_ids: emails, // API resolves emails to user IDs
      expires_at: expiresAt,
    }),
  });

  return response.json();
}
```

### cURL Examples

```bash
# Get available templates
curl -X GET "https://theprize.io/api/notifications/admin/templates" \
  -H "X-Admin-Api-Key: your-api-key"

# Send winner notification
curl -X POST "https://theprize.io/api/notifications/admin/template" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Api-Key: your-api-key" \
  -d '{
    "template": "winner",
    "data": {
      "ticket_number": "#5678",
      "prize_name": "MacBook Pro"
    },
    "user_ids": ["user@example.com"]
  }'

# Broadcast to all users
curl -X POST "https://theprize.io/api/notifications/admin/template" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Api-Key: your-api-key" \
  -d '{
    "template": "custom_announcement",
    "data": {
      "title": "System Maintenance",
      "message": "Brief maintenance scheduled for 2AM UTC."
    },
    "send_to_all": true
  }'

# Get statistics
curl -X GET "https://theprize.io/api/notifications/admin/stats" \
  -H "X-Admin-Api-Key: your-api-key"
```

---

## Template Message Examples

Here's what each template produces:

| Template            | Title                      | Message                                                                                         |
| ------------------- | -------------------------- | ----------------------------------------------------------------------------------------------- |
| `winner`            | 🎉 You Won!                | Congratulations! Ticket #1234 won Bitcoin Prize! Check your dashboard for details.              |
| `closing_soon`      | ⏰ Closing Soon!           | Bitcoin Prize closes in 6 hours! Only 50 tickets left at £2.50. Enter now before it's too late! |
| `comp_live`         | 🚀 New Competition Live!   | MacBook Pro is now live! Win £3,000. Entries from £1.99.                                        |
| `welcome`           | 👋 Welcome to ThePrize.io! | Hey John! Your account is ready. Explore active competitions and start winning today!           |
| `fomo`              | 🔥 Don't Miss Out!         | 5 competitions are live with £50,000 in prizes. Others are entering - will you?                 |
| `payment_success`   | ✅ Payment Successful      | Your payment of £25.00 was processed successfully.                                              |
| `topup_success`     | 💰 Top-Up Successful       | £50.00 has been added to your wallet. Your new balance is £75.50.                               |
| `entry_confirmed`   | 🎟️ Entry Confirmed         | You're in! 10 ticket(s) for Bitcoin Giveaway. Good luck!                                        |
| `competition_ended` | 🏁 Competition Ended       | MacBook Air Giveaway has ended. The winner has been drawn. Check results!                       |

---

## Best Practices

1. **Use templates** for consistent messaging that matches your email style
2. **Include competition_id** when relevant so users can navigate directly
3. **Set expires_at** for time-sensitive offers
4. **Target specific users** instead of broadcasting when possible
5. **Check stats** to monitor notification delivery

---

## Rate Limits

- Maximum 10,000 users per request when using `send_to_all`
- Batches of 100 notifications inserted per request to avoid timeouts
- Consider using targeted `user_ids` for large-scale campaigns

---

## Error Responses

```json
{
  "ok": false,
  "error": "Error description"
}
```

| Status | Error                             | Cause                               |
| ------ | --------------------------------- | ----------------------------------- |
| 400    | Missing required fields           | Invalid request body                |
| 400    | Invalid template                  | Template key doesn't exist          |
| 400    | No valid users found              | None of the provided user_ids exist |
| 403    | Forbidden - admin access required | Invalid or missing API key          |
| 500    | Failed to fetch users             | Database error                      |
