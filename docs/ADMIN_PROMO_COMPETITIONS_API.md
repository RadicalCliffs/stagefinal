# Promo Competitions API Documentation

## Overview

The Promo Competitions system allows administrators to create exclusive competitions that are only accessible via promotional codes. Users must redeem a valid promo code to gain entry into these special competitions.

## Key Concepts

### Promo Competition
A special competition that:
- Is separate from regular competitions
- Only appears in the user's "Promo" tab after they redeem a valid code
- Has a fixed number of tickets that get allocated as codes are redeemed

### Promo Code
A code that:
- Grants a specific number of free entries (e.g., 10, 50, 100)
- Can be used once per user
- Can have usage limits (max total redemptions)
- Can be restricted to specific users
- Can have validity periods

## Setup

### 1. Run Database Migration

Execute the migration in `supabase/migrations/20260308160000_promo_competitions.sql` in your Supabase SQL Editor.

This creates:
- `promo_competitions` - The competitions table
- `promo_competition_codes` - The codes table
- `promo_competition_redemptions` - Tracks who redeemed what
- `promo_competition_tickets` - Individual tickets allocated to users
- `redeem_promo_code()` - Database function for atomic code redemption

### 2. Environment Variables

The admin API uses the same `ADMIN_API_KEY` as the notification system. No additional setup needed if you already configured it.

---

## Admin API Reference

Base URL: `https://theprize.io/api/promo-competitions`

All admin endpoints require the `X-Admin-Api-Key` header.

### Competition Endpoints

#### Create Competition
```http
POST /api/promo-competitions/admin/competitions
```

**Request Body:**
```json
{
  "title": "Exclusive Bitcoin Giveaway",
  "prize_name": "1 Bitcoin",
  "description": "Win a full Bitcoin in this exclusive promo!",
  "image_url": "https://example.com/btc.jpg",
  "prize_value": 65000,
  "total_tickets": 500,
  "status": "draft",
  "start_date": "2026-03-10T00:00:00Z",
  "end_date": "2026-03-31T23:59:59Z",
  "draw_date": "2026-04-01T12:00:00Z"
}
```

**Response:**
```json
{
  "ok": true,
  "competition": {
    "id": "uuid",
    "title": "Exclusive Bitcoin Giveaway",
    "status": "draft",
    ...
  }
}
```

#### List Competitions
```http
GET /api/promo-competitions/admin/competitions?status=active&limit=50&offset=0
```

#### Update Competition
```http
PATCH /api/promo-competitions/admin/competitions/{id}
```

#### Delete Competition
```http
DELETE /api/promo-competitions/admin/competitions/{id}
```

---

### Code Endpoints

#### Create Single Code
```http
POST /api/promo-competitions/admin/codes
```

**Request Body:**
```json
{
  "promo_competition_id": "uuid",
  "entries_granted": 10,
  "code": "BTCWIN10",
  "max_redemptions": 100,
  "valid_until": "2026-03-31T23:59:59Z",
  "description": "10 free entries for BTC giveaway"
}
```

#### Bulk Create Codes
```http
POST /api/promo-competitions/admin/codes/bulk
```

**Request Body:**
```json
{
  "promo_competition_id": "uuid",
  "count": 100,
  "entries_granted": 10,
  "prefix": "BTC",
  "max_redemptions": 1,
  "valid_until": "2026-03-31T23:59:59Z"
}
```

**Response:**
```json
{
  "ok": true,
  "created": 100,
  "codes": [
    { "code": "BTCX7KM3N2", "entries_granted": 10, ... },
    ...
  ]
}
```

#### List Codes
```http
GET /api/promo-competitions/admin/codes?competition_id=uuid&active_only=true
```

#### Update Code
```http
PATCH /api/promo-competitions/admin/codes/{id}
```

#### Deactivate Code
```http
DELETE /api/promo-competitions/admin/codes/{id}
```

---

### Statistics & Redemptions

#### Get Stats
```http
GET /api/promo-competitions/admin/stats
```

**Response:**
```json
{
  "ok": true,
  "stats": {
    "competitions_by_status": {
      "active": 3,
      "draft": 2,
      "ended": 5
    },
    "total_redemptions": 1247,
    "total_tickets_allocated": 12470,
    "active_codes": 450,
    "inactive_codes": 50,
    "total_code_redemptions": 1247
  }
}
```

#### Get Redemptions
```http
GET /api/promo-competitions/admin/redemptions?competition_id=uuid&limit=100
```

---

## User API Reference

These endpoints require user authentication via `Authorization: Bearer <token>`.

#### Redeem Code
```http
POST /api/promo-competitions/redeem
```

**Request Body:**
```json
{
  "code": "BTCX7KM3N2"
}
```

**Success Response:**
```json
{
  "ok": true,
  "success": true,
  "entries_granted": 10,
  "ticket_numbers": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  "competition": {
    "id": "uuid",
    "title": "Exclusive Bitcoin Giveaway"
  }
}
```

**Error Response:**
```json
{
  "ok": false,
  "error": "You have already redeemed this code"
}
```

#### Get My Entries
```http
GET /api/promo-competitions/my-entries
```

Returns all promo competitions the user has entered via code redemption.

#### Get Specific Competition
```http
GET /api/promo-competitions/{id}
```

Returns competition details and user's tickets (only if user has redeemed a code).

---

## Admin Dashboard Integration

### Using the TypeScript Client

Copy `admin-dashboard-promo-competition-client.ts` to your admin dashboard project.

```typescript
import { promoCompetitionClient } from './theprize-promo-competition-client';

// Create a full campaign (competition + codes)
const campaign = await promoCompetitionClient.createCampaign(
  {
    title: "Summer BTC Giveaway",
    prize_name: "0.5 Bitcoin",
    prize_value: 32500,
    total_tickets: 1000,
  },
  {
    count: 100,           // Generate 100 codes
    entries_per_code: 10,  // Each code gives 10 entries
    prefix: "SUMMER",      // Codes will be like "SUMMERX7KM3N"
    max_redemptions_per_code: 1,
  }
);

console.log(`Created ${campaign.summary.total_codes} codes`);
console.log(`Total potential entries: ${campaign.summary.total_potential_entries}`);

// Export codes for distribution
const csv = await promoCompetitionClient.exportCodesAsCsv(campaign.competition.id);
// Download or email this CSV

// Activate the competition
await promoCompetitionClient.activateCompetition(campaign.competition.id);

// Later: End the competition with winners
await promoCompetitionClient.endCompetition(
  campaign.competition.id,
  "42, 156, 789"  // Winning ticket numbers
);
```

### Example Workflows

#### 1. Create a Simple Giveaway
```typescript
// Create competition
const { competition } = await promoCompetitionClient.createCompetition({
  title: "Free iPhone Giveaway",
  prize_name: "iPhone 15 Pro",
  prize_value: 1199,
  total_tickets: 100,
  status: "active",  // Go live immediately
});

// Generate 50 codes, each worth 2 entries
const { codes } = await promoCompetitionClient.bulkCreateCodes({
  promo_competition_id: competition.id,
  count: 50,
  entries_granted: 2,
  prefix: "IPHONE",
});

// codes array contains: ["IPHONEX7K3M2", "IPHONEP9R4T1", ...]
```

#### 2. VIP Personalized Codes
```typescript
// Create personalized code for a specific user
await promoCompetitionClient.createPersonalizedCode(
  competition.id,
  "prize:pid:0xuser123...",  // User's canonical ID
  100,                        // 100 free entries!
  "VIP-USER123"               // Custom code
);
```

#### 3. Time-Limited Flash Sale
```typescript
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);

await promoCompetitionClient.bulkCreateCodes({
  promo_competition_id: competition.id,
  count: 1000,
  entries_granted: 5,
  prefix: "FLASH",
  valid_until: tomorrow.toISOString(),  // Expires in 24 hours
  max_redemptions: 1,
});
```

---

## User Dashboard Behavior

### Promo Tab (`/dashboard/promo`)

1. **Code Entry Section** - Users enter their promo code
2. **Success/Error Feedback** - Immediate feedback on redemption
3. **My Competitions** - Shows all promo competitions the user has entered
4. **Ticket Display** - Expandable section showing all ticket numbers
5. **Winner Highlighting** - Winning tickets are highlighted in green

### Access Control

- Users can ONLY see promo competitions they've redeemed codes for
- The code must be valid (active, not expired, not max-used)
- Each code can only be redeemed once per user
- Personalized codes are restricted to the specified user

---

## Database Schema

### promo_competitions
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| title | TEXT | Competition title |
| description | TEXT | Optional description |
| image_url | TEXT | Display image |
| prize_name | TEXT | Name of the prize |
| prize_value | NUMERIC | Value in dollars |
| total_tickets | INTEGER | Maximum tickets available |
| tickets_allocated | INTEGER | Tickets already allocated |
| status | TEXT | draft, active, ended, cancelled |
| start_date, end_date, draw_date | TIMESTAMPTZ | Scheduling |
| winning_ticket_numbers | TEXT | Comma-separated winners |

### promo_competition_codes
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| promo_competition_id | UUID | FK to competition |
| code | TEXT | The code string |
| entries_granted | INTEGER | Entries per redemption |
| max_redemptions | INTEGER | Total usage limit (null=unlimited) |
| current_redemptions | INTEGER | Times used |
| is_active | BOOLEAN | Can be redeemed |
| valid_from, valid_until | TIMESTAMPTZ | Validity window |
| restricted_to_user_id | TEXT | If set, only this user can use |

### promo_competition_redemptions
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| promo_competition_id | UUID | FK to competition |
| code_id | UUID | FK to code |
| canonical_user_id | TEXT | Who redeemed |
| entries_granted | INTEGER | How many entries given |
| ticket_numbers | TEXT | JSON array of ticket numbers |
| redeemed_at | TIMESTAMPTZ | When |

### promo_competition_tickets
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| promo_competition_id | UUID | FK to competition |
| redemption_id | UUID | FK to redemption |
| canonical_user_id | TEXT | Owner |
| ticket_number | INTEGER | The ticket number |
| is_winner | BOOLEAN | Set to true if this ticket won |

---

## Error Handling

Common error messages:

| Error | Meaning |
|-------|---------|
| `Invalid or expired promo code` | Code doesn't exist, is inactive, or expired |
| `This code has reached its maximum redemptions` | Code usage limit hit |
| `This code is not valid for your account` | Code is personalized for another user |
| `You have already redeemed this code` | One redemption per user per code |
| `Not enough tickets available` | Competition is full |

---

## Best Practices

1. **Test codes in draft mode** - Create competition as "draft", test codes, then activate
2. **Use prefixes** - Makes codes recognizable (e.g., "SUMMER", "VIP", "FLASH")
3. **Set expiration dates** - Avoid codes being used after campaign ends
4. **Monitor stats** - Track redemption rates to gauge campaign success
5. **Personalized codes for VIPs** - Use `restricted_to_user_id` for special users
6. **Export unused codes** - Use `getUnusedCodes()` to see which codes weren't used
