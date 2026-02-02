# Supabase Integration Guide for ThePrize.io Frontend

This guide explains how to integrate with the Supabase backend used by ThePrize.io.

## 1. Environment Setup

Add these environment variables to your frontend:

```env
VITE_SUPABASE_URL=https://mthwfldcjvpxjtmrqkqm.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg
```

## 2. Supabase Client Setup

```typescript
// lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

## 3. User Identity Format

ThePrize.io uses a canonical user ID format for consistent identification:

```typescript
// Convert wallet address to canonical format
function toPrizePid(userId: string): string {
  if (!userId) return '';
  
  // If already in prize:pid: format, return as-is
  if (userId.startsWith('prize:pid:')) {
    return userId.toLowerCase();
  }
  
  // If it's a wallet address (0x...), convert to prize:pid: format
  if (userId.startsWith('0x') && userId.length === 42) {
    return `prize:pid:${userId.toLowerCase()}`;
  }
  
  // For other formats (privy DIDs, etc.), return as-is
  return userId;
}
```

## 4. Key RPC Functions

### Get User Balance

```typescript
async function getUserBalance(userId: string): Promise<number> {
  const canonicalUserId = toPrizePid(userId);
  
  const { data, error } = await supabase.rpc('get_user_balance', {
    p_canonical_user_id: canonicalUserId
  });
  
  if (error) {
    console.error('Error fetching balance:', error);
    return 0;
  }
  
  // RPC returns JSONB: { success, balance, bonus_balance, total_balance }
  return data?.balance || 0;
}
```

### Get User Competition Entries

```typescript
async function getUserEntries(userId: string) {
  const canonicalUserId = toPrizePid(userId);
  
  const { data, error } = await supabase.rpc('get_user_competition_entries', {
    p_user_identifier: canonicalUserId
  });
  
  if (error) {
    console.error('Error fetching entries:', error);
    return [];
  }
  
  // Returns: id, competition_id, competition_title, competition_image_url,
  //          amount_paid, ticket_count, entry_status, is_winner, etc.
  return data || [];
}
```

### Get User Transactions

```typescript
async function getUserTransactions(userId: string) {
  const canonicalUserId = toPrizePid(userId);
  
  const { data, error } = await supabase.rpc('get_user_transactions', {
    p_canonical_user_id: canonicalUserId
  });
  
  if (error) {
    console.error('Error fetching transactions:', error);
    return [];
  }
  
  return data || [];
}
```

## 5. Real-Time Subscriptions

Subscribe to balance changes:

```typescript
function subscribeToBalanceChanges(userId: string, onUpdate: (balance: number) => void) {
  const canonicalUserId = toPrizePid(userId);
  
  const channel = supabase
    .channel(`user-balance-${canonicalUserId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'sub_account_balances',
      },
      (payload) => {
        const record = payload.new as any;
        
        // Check if update is for current user
        if (record.user_id?.toLowerCase() === canonicalUserId.toLowerCase() ||
            record.canonical_user_id?.toLowerCase() === canonicalUserId.toLowerCase()) {
          onUpdate(Number(record.available_balance) || 0);
        }
      }
    )
    .subscribe();
  
  return () => supabase.removeChannel(channel);
}
```

## 6. Key Tables Reference

| Table | Purpose |
|-------|---------|
| `sub_account_balances` | User wallet balances (USD) |
| `competition_entries` | Aggregated user entries per competition |
| `competitions` | Competition details |
| `user_transactions` | Payment/transaction history |
| `canonical_users` | User profiles and metadata |

## 7. Data Flow Summary

```
User Login
    ↓
Identify user by wallet address (0x...)
    ↓
Convert to canonical ID: prize:pid:0x...
    ↓
Query Supabase using canonical ID
    ↓
sub_account_balances → Balance
competition_entries → Entries summary
user_transactions → Transaction history
```

## 8. Common Patterns

### Case-Insensitive Matching

Always normalize wallet addresses to lowercase:

```typescript
const normalizedWallet = walletAddress.toLowerCase();
```

### Error Handling

```typescript
const { data, error } = await supabase.rpc('some_function', params);

if (error) {
  // Log error with context
  console.error('[Context] RPC failed:', error.message);
  
  // Fallback to direct table query if RPC unavailable
  const { data: fallbackData } = await supabase
    .from('some_table')
    .select('*')
    .eq('user_id', userId);
    
  return fallbackData;
}
```

## 9. Testing

Test your integration with this user:
- Wallet: `0xF6A7a909016738d8D0Ce9379b76dAD16821D5bf4`
- Canonical ID: `prize:pid:0xf6a7a909016738d8d0ce9379b76dad16821d5bf4`

This user has:
- Balance: ~$49,594.50
- Competition entries (Tesla Model 3, $10,000 BTC)
- Transaction history


---

## 10. Detailed API Reference

### `get_user_balance`

**Purpose:** Returns user's wallet balance in USD.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `p_canonical_user_id` | TEXT | Canonical user ID (`prize:pid:0x...`) or wallet address |
| `p_user_identifier` | TEXT | Alternative param name (same as above) |

**Returns:** `JSONB`
```json
{
  "success": true,
  "balance": 49594.50,
  "bonus_balance": 0,
  "total_balance": 49594.50
}
```

**Example:**
```typescript
const { data } = await supabase.rpc('get_user_balance', {
  p_canonical_user_id: 'prize:pid:0xf6a7a909016738d8d0ce9379b76dad16821d5bf4'
});
const balance = data?.balance || 0;
```

---

### `get_user_competition_entries`

**Purpose:** Returns all competition entries for a user with aggregated ticket info.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `p_user_identifier` | TEXT | Canonical user ID or wallet address |

**Returns:** `TABLE (record)`
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Entry ID |
| `competition_id` | TEXT | Competition UUID |
| `competition_title` | TEXT | Competition name |
| `competition_image_url` | TEXT | Image URL |
| `competition_status` | TEXT | `active`, `sold_out`, `completed` |
| `ticket_count` | INTEGER | Total tickets purchased |
| `ticket_numbers` | TEXT | CSV of ticket numbers |
| `amount_paid` | NUMERIC | Total spent (USD) |
| `is_winner` | BOOLEAN | Winner flag |
| `created_at` | TIMESTAMP | First entry date |

---

### `get_user_transactions`

**Purpose:** Returns user's transaction history.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `user_identifier` | TEXT | Canonical user ID or wallet address |

**Returns:** `JSONB` array
```json
[
  {
    "id": "uuid",
    "type": "deposit|withdrawal|entry",
    "amount": 100.00,
    "currency": "USD",
    "status": "completed",
    "competition_id": "uuid|null",
    "ticket_count": 10,
    "created_at": "2024-01-15T...",
    "payment_method": "card|crypto"
  }
]
```

---

### `get_comprehensive_user_dashboard_entries`

**Purpose:** Full dashboard data with aggregated entries from `joincompetition` table.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `p_user_identifier` | TEXT | Canonical user ID or wallet address |

**Returns:** `TABLE (record)` - Similar to `get_user_competition_entries` but sources from `joincompetition` table and includes more details like `transaction_hash`.

---

### `get_active_competitions_for_draw`

**Purpose:** Returns active competitions with on-chain IDs ready for draws.

**Parameters:** None

**Returns:** `TABLE (record)`
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Competition ID |
| `onchain_competition_id` | TEXT | On-chain identifier |
| `end_date` | TIMESTAMP | Competition end date |
| `status` | TEXT | Always `active` |

---

## 11. Quick Reference: All Available RPCs

| Function | Purpose |
|----------|---------|
| `get_user_balance` | Get user's USD balance |
| `get_user_competition_entries` | Get user's entries (uses `competition_entries`) |
| `get_comprehensive_user_dashboard_entries` | Get entries (uses `joincompetition`) |
| `get_user_transactions` | Get transaction history |
| `get_active_competitions_for_draw` | List active competitions |
| `get_privy_user` | Look up user by Privy ID |
| `get_user_by_wallet` | Look up user by wallet address |
| `upsert_canonical_user` | Create/update user profile |


---

## 12. Schema Changes Made During This Integration

### Modified RPC: `get_user_competition_entries`

**Change:** Added missing fields to properly join with `competitions` table.

**Before:** Did not return `competition_image_url` or `amount_spent`

**After (current):** Now returns:
- `competition_image_url` from `competitions.image_url`
- `amount_paid` from `competition_entries.amount_spent`

**Migration Applied:**
```sql
DROP FUNCTION IF EXISTS public.get_user_competition_entries(text);

CREATE OR REPLACE FUNCTION public.get_user_competition_entries(p_user_identifier text)
RETURNS TABLE (
  id uuid,
  competition_id text,
  competition_title text,
  competition_description text,
  competition_image_url text,
  competition_status text,
  competition_end_date timestamp,
  competition_prize_value numeric,
  competition_is_instant_win boolean,
  ticket_count integer,
  ticket_numbers text,
  amount_paid numeric,
  entry_status text,
  is_winner boolean,
  created_at timestamp,
  wallet_address text,
  transaction_hash text
) AS $$
DECLARE
  v_normalized_id text;
BEGIN
  v_normalized_id := lower(trim(p_user_identifier));
  
  RETURN QUERY
  SELECT 
    ce.id,
    ce.competition_id,
    c.title::text as competition_title,
    c.description::text as competition_description,
    c.image_url::text as competition_image_url,  -- Added
    c.status::text as competition_status,
    c.end_date as competition_end_date,
    c.prize_value as competition_prize_value,
    COALESCE(c.is_instant_win, false) as competition_is_instant_win,
    ce.tickets_count as ticket_count,
    ce.ticket_numbers_csv::text as ticket_numbers,
    ce.amount_spent as amount_paid,  -- Added
    'confirmed'::text as entry_status,
    COALESCE(ce.is_winner, false) as is_winner,
    ce.created_at,
    ce.wallet_address::text,
    null::text as transaction_hash
  FROM competition_entries ce
  JOIN competitions c ON c.id = ce.competition_id
  WHERE (
    lower(coalesce(ce.canonical_user_id, '')) = v_normalized_id OR
    lower(coalesce(ce.wallet_address, '')) = v_normalized_id
  )
  ORDER BY ce.latest_purchase_at DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Frontend Fix: `useRealTimeBalance.ts`

**Issue:** `get_user_balance` returns JSONB object, but frontend was treating it as a number.

**Fix Applied:**
```typescript
// Before (broken):
const balanceValue = Number(rpcBalance) || 0;  // Returns NaN -> 0

// After (fixed):
const rpcData = typeof rpcBalance === 'object' && rpcBalance !== null 
  ? rpcBalance 
  : { balance: 0, bonus_balance: 0 };
const balanceValue = Number(rpcData.balance) || 0;
const bonusValue = Number(rpcData.bonus_balance) || 0;
```

### No New Tables or Indexes Created

All fixes used existing tables:
- `competition_entries` - existing
- `competitions` - existing  
- `sub_account_balances` - existing
- `canonical_users` - existing


---

## 13. Complete Database Schema Reference

### All Tables (50 total)

| Table | Purpose |
|-------|---------|
| **User Management** | |
| `canonical_users` | Master user profiles (canonical_user_id, wallet, email, avatar) |
| `profiles` | Extended user profiles |
| `users` | Legacy user records |
| **Balances & Transactions** | |
| `sub_account_balances` | User USD balances (available_balance, bonus_balance) |
| `balance_ledger` | Balance change audit trail |
| `user_transactions` | All user transactions (deposits, withdrawals, entries) |
| `payments` | Payment records |
| `custody_transactions` | Custodial wallet transactions |
| `internal_transfers` | Internal balance transfers |
| **Competitions** | |
| `competitions` | Competition definitions (title, prize, status, dates) |
| `hero_competitions` | Featured/homepage competitions |
| `competition_entries` | Aggregated user entries per competition |
| `joincompetition` | Raw ticket purchase records |
| `joined_competitions` | Legacy join records |
| **Tickets** | |
| `tickets` | Individual ticket records |
| `tickets_sold` | Sold ticket tracking |
| `pending_tickets` | Tickets awaiting confirmation |
| `pending_ticket_items` | Individual pending ticket items |
| `order_tickets` | Order-ticket associations |
| **Orders & Reservations** | |
| `orders` | Purchase orders |
| `reservations` | Ticket reservations (time-limited holds) |
| `purchase_requests` | Purchase request queue |
| **Winners & Prizes** | |
| `winners` | Winner records |
| `Prize_Instantprizes` | Instant win prize definitions |
| `instant_win_grids` | Instant win game grids |
| **System** | |
| `site_metadata` | Site configuration |
| `site_stats` | Platform statistics cache |
| `platform_statistics` | Detailed platform stats |
| `faqs` | FAQ content |
| `testimonials` | User testimonials |
| `partners` | Partner information |
| `notifications` | System notifications |
| `user_notifications` | User-specific notifications |
| **Admin** | |
| `admin_users` | Admin accounts |
| `admin_sessions` | Admin login sessions |
| `admin_users_audit` | Admin action audit log |
| **Audit & Logs** | |
| `rng_logs` | Random number generation logs |
| `confirmation_incident_log` | Payment confirmation issues |
| `bonus_award_audit` | Bonus award tracking |
| `payment_webhook_events` | Payment webhook logs |

---

## 14. RPC Functions by Category

### User & Balance (Frontend Essential)
| Function | Purpose |
|----------|---------|
| `get_user_balance` | Get user's USD balance (returns JSONB) |
| `get_user_by_wallet` | Look up user by wallet address |
| `get_balance_by_any_id` | Flexible balance lookup |
| `get_sub_account_balance` | Direct sub-account query |
| `upsert_canonical_user` | Create/update user profile |
| `ensure_canonical_user` | Ensure user exists |

### Competition Entries (Frontend Essential)
| Function | Purpose |
|----------|---------|
| `get_user_competition_entries` | User's entries (from competition_entries) |
| `get_comprehensive_user_dashboard_entries` | Full dashboard data (from joincompetition) |
| `get_user_dashboard_entries` | Dashboard-formatted entries |
| `get_user_tickets` | All user tickets |
| `get_user_tickets_for_competition` | Tickets for specific competition |

### Transactions (Frontend Essential)
| Function | Purpose |
|----------|---------|
| `get_user_transactions` | User's transaction history |
| `get_user_stats` | User statistics summary |

### Competitions (Read)
| Function | Purpose |
|----------|---------|
| `get_competition_by_id` | Single competition details |
| `get_active_competitions_for_draw` | Active competitions list |
| `get_competition_availability` | Ticket availability check |
| `get_available_tickets` | Available ticket numbers |
| `get_unavailable_tickets` | Taken ticket numbers |

### Ticket Purchase (Write Operations)
| Function | Purpose |
|----------|---------|
| `reserve_tickets` | Reserve tickets temporarily |
| `purchase_tickets` | Execute ticket purchase |
| `purchase_tickets_with_balance` | Purchase using account balance |
| `confirm_ticket_purchase` | Confirm pending purchase |
| `release_reservation` | Cancel reservation |

### Balance Operations (Write)
| Function | Purpose |
|----------|---------|
| `credit_user_balance` | Add funds to user balance |
| `debit_user_balance` | Deduct from user balance |
| `credit_sub_account_balance` | Credit sub-account |
| `debit_sub_account_balance` | Debit sub-account |

### Winners
| Function | Purpose |
|----------|---------|
| `get_winners_by_competition` | Competition winners list |
| `claim_prize` | Claim winning prize |

---

## 15. Storage Buckets

| Bucket | Purpose | Public |
|--------|---------|--------|
| `avatars` | User profile pictures | Yes |
| `competition-images` | Competition artwork | Yes |
| `prizes` | Prize images | Yes |
