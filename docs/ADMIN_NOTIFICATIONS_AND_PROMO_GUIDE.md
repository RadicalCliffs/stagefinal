# Admin Dashboard: Notifications and Promotional Codes Integration Guide

## Overview

This guide explains how the admin dashboard should integrate with the notification and promotional systems in theprize.io. It covers sending promotional messages to users and managing promotional codes for competitions.

> **📖 NEW: For the complete Admin Notification API reference, see [ADMIN_NOTIFICATION_API.md](./ADMIN_NOTIFICATION_API.md)**

---

## 1. Notification System Architecture

### Current Implementation

The notification system is already implemented in the frontend with the following components:

#### Database Tables

##### `notifications` Table (Global Notifications)

```sql
CREATE TABLE notifications (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info' NOT NULL,
  is_global BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  expires_at TIMESTAMPTZ
);
```

##### `user_notifications` Table (Per-User Notifications)

```sql
CREATE TABLE user_notifications (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  canonical_user_id TEXT NOT NULL,
  user_id TEXT,
  notification_id TEXT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info' NOT NULL,
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
```

#### Notification Types

The system supports the following notification types:

| Type                | Purpose                            | Example Use Case                               |
| ------------------- | ---------------------------------- | ---------------------------------------------- |
| `win`               | Notify user they won a competition | "🎉 Congratulations! You Won!"                 |
| `competition_ended` | Competition has ended              | "The competition 'Lamborghini Urus' has ended" |
| `special_offer`     | Promotional messages               | "Limited Time: 50% bonus tickets!"             |
| `announcement`      | General announcements              | "New competition launching tomorrow!"          |
| `payment`           | Payment confirmation               | "✅ Payment Successful"                        |
| `topup`             | Wallet top-up confirmation         | "💰 Top-Up Successful"                         |
| `entry`             | Entry confirmation                 | "🎟️ Entry Confirmed"                           |

### API Endpoints for Admin Dashboard

#### 1. Send Promotional Message to All Users

**Endpoint**: `POST /api/admin/notifications/broadcast`

**Purpose**: Send a promotional message to all active users

**Request Body**:

```json
{
  "title": "Limited Time Offer!",
  "message": "Get 50% bonus tickets on your next purchase. Use code BONUS50 at checkout!",
  "type": "special_offer",
  "expires_at": "2024-12-31T23:59:59Z" // Optional
}
```

**Implementation Required in Admin Dashboard**:

```javascript
async function sendBroadcastNotification(title, message, expiresAt = null) {
  const response = await fetch("/api/admin/notifications/broadcast", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      title,
      message,
      type: "special_offer",
      expires_at: expiresAt,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to send broadcast notification");
  }

  return await response.json();
}
```

**Backend Implementation Required**:

```typescript
// netlify/functions/admin-notifications.mts
export default async function handler(req: Request) {
  // Verify admin authentication
  const adminUser = await verifyAdminToken(req);
  if (!adminUser) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { title, message, type, expires_at } = await req.json();

  // Get all active users
  const { data: users } = await supabase
    .from("canonical_users")
    .select("id")
    .eq("is_active", true);

  // Create notifications for all users
  const notifications = users.map((user) => ({
    canonical_user_id: user.id,
    user_id: user.id,
    title,
    message,
    type: type || "special_offer",
    is_read: false,
    created_at: new Date().toISOString(),
    ...(expires_at && { expires_at }),
  }));

  // Batch insert (do in chunks of 1000 to avoid limits)
  const chunkSize = 1000;
  for (let i = 0; i < notifications.length; i += chunkSize) {
    const chunk = notifications.slice(i, i + chunkSize);
    await supabase.from("user_notifications").insert(chunk);
  }

  return new Response(
    JSON.stringify({
      success: true,
      sent_to: users.length,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}
```

#### 2. Send Notification to Specific Users

**Endpoint**: `POST /api/admin/notifications/targeted`

**Purpose**: Send promotional messages to specific users (e.g., high spenders, inactive users)

**Request Body**:

```json
{
  "user_ids": ["user-123", "user-456"],
  "title": "We Miss You!",
  "message": "Come back and get 100 free entries on us!",
  "type": "special_offer"
}
```

#### 3. Send Welcome Notification to New Users

**Event**: Triggered on user registration

**Implementation**: Add to user registration flow

```typescript
// After user successfully registers
await fetch("/api/notifications/", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${userToken}`,
  },
  body: JSON.stringify({
    user_id: newUser.id,
    type: "announcement",
    title: "👋 Welcome to ThePrize.io!",
    message: "Get started by exploring our active competitions. Good luck!",
    read: false,
  }),
});
```

---

## 2. Promotional Codes System

### Current Implementation Status

**Status**: ⚠️ Promotional codes table does not currently exist in the database

### Required Database Schema

To implement promotional codes, add the following table to the database:

```sql
-- Promotional codes table
CREATE TABLE promotional_codes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  code TEXT UNIQUE NOT NULL,
  description TEXT,

  -- What the code provides
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed_amount', 'free_tickets')),
  discount_value NUMERIC NOT NULL,

  -- Applicability
  competition_id TEXT, -- NULL = applies to all competitions

  -- Limits and validity
  max_uses INTEGER, -- NULL = unlimited
  uses_per_user INTEGER DEFAULT 1,
  current_uses INTEGER DEFAULT 0,

  -- Date range
  valid_from TIMESTAMPTZ DEFAULT NOW(),
  valid_until TIMESTAMPTZ,

  -- Status
  is_active BOOLEAN DEFAULT true,

  -- Metadata
  created_by TEXT, -- Admin user ID
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_promotional_codes_code ON promotional_codes(code);
CREATE INDEX idx_promotional_codes_is_active ON promotional_codes(is_active);
CREATE INDEX idx_promotional_codes_competition_id ON promotional_codes(competition_id);

-- Track promotional code usage
CREATE TABLE promotional_code_usage (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  code_id TEXT NOT NULL REFERENCES promotional_codes(id),
  user_id TEXT NOT NULL,
  competition_id TEXT,
  discount_applied NUMERIC NOT NULL,
  used_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_promo_usage_code_id ON promotional_code_usage(code_id);
CREATE INDEX idx_promo_usage_user_id ON promotional_code_usage(user_id);
```

### Admin Dashboard API Endpoints

#### 1. Create Promotional Code

**Endpoint**: `POST /api/admin/promo-codes`

**Request Body**:

```json
{
  "code": "BONUS50",
  "description": "50% bonus tickets promotion",
  "discount_type": "percentage",
  "discount_value": 50,
  "competition_id": null,
  "max_uses": 1000,
  "uses_per_user": 1,
  "valid_from": "2024-01-01T00:00:00Z",
  "valid_until": "2024-12-31T23:59:59Z"
}
```

**Response**:

```json
{
  "success": true,
  "promo_code": {
    "id": "promo-123",
    "code": "BONUS50",
    "is_active": true
  }
}
```

#### 2. List All Promotional Codes

**Endpoint**: `GET /api/admin/promo-codes`

**Query Parameters**:

- `active_only`: boolean (default: false)
- `competition_id`: filter by competition
- `page`: number
- `limit`: number

#### 3. Update Promotional Code

**Endpoint**: `PATCH /api/admin/promo-codes/{code_id}`

#### 4. Deactivate Promotional Code

**Endpoint**: `DELETE /api/admin/promo-codes/{code_id}`

#### 5. Get Promotional Code Usage Stats

**Endpoint**: `GET /api/admin/promo-codes/{code_id}/stats`

**Response**:

```json
{
  "code": "BONUS50",
  "total_uses": 347,
  "unique_users": 312,
  "total_discount_given": 15234.5,
  "remaining_uses": 653,
  "expires_at": "2024-12-31T23:59:59Z"
}
```

### Frontend Integration

#### Promo Code Input Component

The promo code input component already exists in `EntriesCard.tsx`:

```tsx
{
  isPromoCard && (
    <div className="mt-7 flex flex-col sm:flex-row justify-between gap-3 sm:gap-4">
      <input
        className="bg-white/25 text-black sm:text-base text-sm w-full rounded-md sequel-45 px-3 sm:pl-4 py-2.5 sm:py-3 placeholder:text-white/70"
        placeholder="Enter Promotional Code..."
      />
      <button className="sequel-95 bg-[#DDE404] sm:text-base text-sm cursor-pointer text-[#000] uppercase px-4 py-2.5 sm:py-3 rounded-md flex-shrink-0">
        Enter
      </button>
    </div>
  );
}
```

**Required Enhancement**: Add functionality to validate and apply promo codes

```typescript
// src/lib/promo-code-service.ts
export async function validatePromoCode(code: string, competitionId?: string) {
  const response = await fetch("/api/promo-codes/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, competition_id: competitionId }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Invalid promo code");
  }

  return await response.json();
}

export async function applyPromoCode(
  code: string,
  competitionId: string,
  userId: string,
) {
  const response = await fetch("/api/promo-codes/apply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      code,
      competition_id: competitionId,
      user_id: userId,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to apply promo code");
  }

  return await response.json();
}
```

---

## 3. Featured Competitions (Current Promo Section)

### Current Implementation

The promo section in `/dashboard/promo` currently displays competitions marked as `is_featured`:

```typescript
// src/components/UserDashboard/Promo/PromoLayout.tsx
const competitions = await database.getCompetitionsV2("active", 20);
const promoData = competitions
  .filter((comp: any) => comp.is_featured)
  .slice(0, 6);
```

### Admin Dashboard Control

#### 1. Mark Competition as Featured

**Endpoint**: `PATCH /api/admin/competitions/{competition_id}`

**Request Body**:

```json
{
  "is_featured": true
}
```

**SQL Update**:

```sql
UPDATE competitions
SET is_featured = true
WHERE id = 'competition-id';
```

#### 2. Set Featured Priority

Add a `featured_priority` field to control display order:

```sql
ALTER TABLE competitions
ADD COLUMN featured_priority INTEGER DEFAULT 0;

CREATE INDEX idx_competitions_featured
ON competitions(is_featured, featured_priority DESC);
```

**Admin Dashboard Implementation**:

```typescript
// Drag-and-drop interface to reorder featured competitions
async function updateFeaturedPriority(competitionId: string, priority: number) {
  await fetch(`/api/admin/competitions/${competitionId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ featured_priority: priority }),
  });
}
```

---

## 4. Sending Promo Codes to Lucky Users

### Use Case: Reward Active Users

**Scenario**: Admin wants to send promotional codes to users who have spent over $100

#### 1. Query Target Users

```sql
-- Find users who spent over $100
SELECT DISTINCT canonical_user_id
FROM user_transactions
WHERE status = 'completed'
GROUP BY canonical_user_id
HAVING SUM(amount) > 100;
```

#### 2. Create Unique Promo Codes

**Endpoint**: `POST /api/admin/promo-codes/bulk`

**Request Body**:

```json
{
  "base_code": "VIP",
  "count": 100,
  "discount_type": "free_tickets",
  "discount_value": 10,
  "valid_until": "2024-12-31T23:59:59Z",
  "uses_per_user": 1
}
```

**Response**:

```json
{
  "success": true,
  "codes": [
    "VIP-A1B2C3",
    "VIP-D4E5F6"
    // ... 98 more codes
  ]
}
```

#### 3. Send Codes to Users

**Endpoint**: `POST /api/admin/promo-codes/distribute`

**Request Body**:

```json
{
  "user_ids": ["user-123", "user-456"],
  "code_ids": ["code-abc", "code-def"],
  "notification_title": "You're a VIP!",
  "notification_message": "Thanks for being an amazing customer! Here's 10 free tickets: {CODE}"
}
```

**Backend Implementation**:

```typescript
// Assign codes to users and send notifications
for (let i = 0; i < userIds.length; i++) {
  const userId = userIds[i];
  const codeId = codeIds[i];

  // Get the code
  const { data: promoCode } = await supabase
    .from("promotional_codes")
    .select("code")
    .eq("id", codeId)
    .single();

  // Send notification with personalized code
  await supabase.from("user_notifications").insert({
    canonical_user_id: userId,
    user_id: userId,
    type: "special_offer",
    title: notificationTitle,
    message: notificationMessage.replace("{CODE}", promoCode.code),
    is_read: false,
  });

  // Track code assignment
  await supabase.from("promotional_code_assignments").insert({
    code_id: codeId,
    user_id: userId,
    assigned_at: new Date().toISOString(),
  });
}
```

---

## 5. Admin Dashboard UI Components

### Notifications Management Page

**Page**: `/admin/notifications`

**Features**:

1. **Broadcast Message Form**
   - Title input
   - Message textarea
   - Type selector (dropdown)
   - Expiration date picker
   - "Send to All Users" button

2. **Targeted Messages Form**
   - User filter (by spend, activity, etc.)
   - Preview recipient count
   - Message composer
   - "Send" button

3. **Notification History**
   - Table of sent notifications
   - Columns: Date, Title, Type, Recipients, Open Rate
   - Filter and search

### Promotional Codes Management Page

**Page**: `/admin/promo-codes`

**Features**:

1. **Create Promo Code Form**
   - Code input (auto-generate option)
   - Discount type selector
   - Discount value input
   - Competition selector (optional)
   - Usage limits
   - Date range
   - "Create Code" button

2. **Active Promo Codes Table**
   - Columns: Code, Description, Discount, Uses, Remaining, Expires, Status
   - Actions: Edit, Deactivate, View Stats

3. **Bulk Code Generation**
   - Generate multiple unique codes at once
   - Distribute to user segments

4. **Featured Competitions Manager**
   - Drag-and-drop list of competitions
   - Toggle featured status
   - Set display priority

---

## 6. Summary of Required Admin Dashboard Changes

### Backend Endpoints to Implement

1. `POST /api/admin/notifications/broadcast` - Send notification to all users
2. `POST /api/admin/notifications/targeted` - Send notification to specific users
3. `POST /api/admin/promo-codes` - Create promotional code
4. `GET /api/admin/promo-codes` - List promotional codes
5. `PATCH /api/admin/promo-codes/{id}` - Update promotional code
6. `DELETE /api/admin/promo-codes/{id}` - Deactivate promotional code
7. `POST /api/admin/promo-codes/bulk` - Generate bulk codes
8. `POST /api/admin/promo-codes/distribute` - Distribute codes to users
9. `PATCH /api/admin/competitions/{id}` - Update competition (for featured status)

### Database Migrations to Run

1. Create `promotional_codes` table
2. Create `promotional_code_usage` table
3. Add `featured_priority` column to `competitions` table

### Frontend Components to Add

1. Admin Notifications Management page
2. Admin Promotional Codes Management page
3. Promo code validation and application logic in checkout flow

---

## 7. Testing Checklist

- [ ] Send broadcast notification to all users
- [ ] Send targeted notification to specific users
- [ ] Create promotional code with percentage discount
- [ ] Create promotional code with free tickets
- [ ] Apply promo code during checkout
- [ ] Validate promo code usage limits
- [ ] Mark competition as featured
- [ ] Reorder featured competitions
- [ ] Generate bulk promo codes
- [ ] Distribute codes to user segment
- [ ] Verify notifications appear in user dashboard
- [ ] Test promo code expiration
- [ ] Test promo code redemption in promo section

---

## 8. Security Considerations

1. **Admin Authentication**: All admin endpoints must verify admin user token
2. **Rate Limiting**: Implement rate limiting on promo code validation
3. **Code Uniqueness**: Ensure promotional codes are cryptographically random
4. **SQL Injection**: Use parameterized queries for all database operations
5. **XSS Prevention**: Sanitize user input in notification messages
6. **Audit Logging**: Log all admin actions for accountability

---

## Contact

For questions about this integration, contact the frontend development team.
