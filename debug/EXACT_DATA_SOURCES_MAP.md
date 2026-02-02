# USER DASHBOARD DATA SOURCES - EXACT MAPPING

## ENTRIES TAB

### Component Location
**File:** `/src/components/UserDashboard/Entries/EntriesList.tsx`

### Data Fetch Function (Line 122)
```typescript
const data = await database.getUserEntriesFromCompetitionEntries(canonicalUserId);
```

### Database Path
```
EntriesList.tsx (line 122)
  → src/lib/database.ts: getUserEntriesFromCompetitionEntries()
    → src/lib/supabase-rpc-helpers.ts: getUserCompetitionEntries()
      → SUPABASE RPC: get_user_competition_entries(p_user_identifier)
        ↓
      PRODUCTION DATABASE TABLES:
        1. competition_entries (PRIMARY - line 7738-7740 in schema)
        2. joincompetition (FALLBACK - line 7752-7757 in schema)
```

### EXACT Fields Displayed in UI (EntriesCard.tsx)

| UI Element | Source Field | Database Table | Notes |
|------------|--------------|----------------|-------|
| **Competition Image** | `entry.image` | `competitions.image_url` | ❌ MISSING: RPC returns NULL |
| **Competition Title** | `entry.title` | `competitions.title` | ✅ Working |
| **Ticket Count** | `entry.number_of_tickets` | `competition_entries.tickets_count` | ✅ Working |
| **Amount Spent** | `entry.amount_spent` | `competition_entries.amount_spent` | ❌ MISSING: Shows as 0 |
| **Purchase Date** | `entry.purchase_date` | `competition_entries.latest_purchase_at` | ✅ Working but WRONG ORDER |
| **Status Badge** | `entry.status` | Derived from `competition_status` | ✅ Working |
| **Ticket Numbers** | `entry.ticket_numbers` | `competition_entries.ticket_numbers_csv` | ✅ Working |
| **Transaction Hash** | `entry.transaction_hash` | NULL in RPC | ❌ MISSING |

### Real-Time Updates (Lines 171-305)
Listens to:
- `competition_entries` table changes
- `joincompetition` table changes
- `pending_tickets` table changes

---

## ORDERS TAB

### Component Location
**File:** `/src/components/UserDashboard/Orders/OrdersList.tsx`

### Data Fetch Function (Line 78)
```typescript
const purchasesData = await database.getUserTransactions(canonicalUserId);
```

### Database Path
```
OrdersList.tsx (line 78)
  → src/lib/database.ts: getUserTransactions()
    → SUPABASE RPC: get_user_transactions(p_user_identifier)
      ↓
    PRODUCTION DATABASE TABLE:
      user_transactions (line 705-745 in schema)
```

### EXACT Fields Displayed in UI (OrdersTable.tsx)

| UI Element | Source Field | Database Table | Notes |
|------------|--------------|----------------|-------|
| **Competition Name** | `order.competition_name` | Derived from `user_transactions.competition_id` JOIN `competitions.title` | ❌ EMPTY |
| **Competition Image** | `order.competition_image` | Derived from `competitions.image_url` | ❌ EMPTY |
| **Amount** | `order.amount_usd` | `user_transactions.amount` | ❌ EMPTY |
| **Tickets** | `order.ticket_count` | `user_transactions.ticket_count` | ❌ EMPTY |
| **Status** | `order.status` | `user_transactions.status` | ❌ EMPTY |
| **Date** | `order.created_at` | `user_transactions.created_at` | ❌ EMPTY |
| **Transaction Type** | `order.transaction_type` | Derived (topup vs entry) | ❌ EMPTY |

### Filter Tabs
- **Purchases Tab:** Shows ALL transactions (including top-ups)
- **Transactions Tab:** Filters out top-ups (`!tx.is_topup`)

### Real-Time Updates (Lines 109-175)
Listens to:
- `user_transactions` table changes
- `sub_account_balances` table changes

---

## WHY ORDERS TAB IS EMPTY

### Problem: `get_user_transactions` RPC Returns Empty or Malformed Data

**Production Function Location:** Line 8092-8114 in schema

```sql
SELECT jsonb_agg(jsonb_build_object('id', id, 'type', type, 'amount', amount, 'currency', currency, 'status', status,
  'competition_id', competition_id, 'ticket_count', ticket_count,
  'created_at', created_at, 'payment_method', method) ORDER BY created_at DESC) INTO v_transactions
FROM user_transactions WHERE user_id = user_identifier OR canonical_user_id = v_canonical_user_id OR user_id = v_canonical_user_id LIMIT 100;
```

**Issues:**
1. ❌ Returns wrapped object instead of array
2. ❌ Missing fields: `payment_provider`, `transaction_hash`, `tx_id`, `order_id`
3. ❌ Wrong field name: `method` instead of `payment_method`
4. ❌ No JOIN to competitions table for enrichment

---

## WHY ENTRIES SHOW BUT MISSING DATA

### Problem: `get_user_competition_entries` Returns Incomplete Data

**Production Function Location:** Line 7702-7770 in schema

**Issues:**
1. ❌ Returns `competition_id` as UUID but frontend expects TEXT with casting
2. ❌ Does NOT return `image` field from competitions table
3. ❌ Does NOT return `transaction_hash` field
4. ❌ Does NOT return `amount_spent` properly (returns NULL from competition_entries)
5. ❌ Does NOT return `prize_value` field
6. ❌ ORDER BY is at CTE level, not final SELECT (line 7767)

---

## SUMMARY

### Entries Tab (PARTIALLY WORKING)
✅ Shows entries  
❌ No competition images
❌ No payment info (amount spent shows as 0)
❌ Wrong order (not sorted by most recent)

### Orders Tab (COMPLETELY BROKEN)
❌ Empty - RPC returns no usable data
❌ Frontend expects enriched data with competition info
❌ RPC does not JOIN to competitions table

### Root Causes
1. **RPC Functions Return Wrong Schema** - Missing fields frontend expects
2. **No Data Enrichment** - No JOINs to get competition images, titles
3. **Wrong Return Format** - get_user_transactions wraps in object instead of array
4. **Wrong Sorting** - ORDER BY in wrong place in SQL query
