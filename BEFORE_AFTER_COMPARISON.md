# Balance Payment System: Before vs After

## BEFORE (Complex) ❌

```
Frontend Request
      ↓
Purchase-with-bonus Edge Function (2197 lines!)
      ↓
┌─────────────────────────────────────────┐
│ Try debit_sub_account_balance RPC      │
│   ↓ Failed?                             │
│ Try sub_account_balances table update   │
│   ↓ Failed?                             │
│ Try wallet_balances table update        │
│   ↓ Failed?                             │
│ Try canonical_users table update        │
│   ↓ Success?                            │
│ Sync back to sub_account_balances       │
│ Sync to canonical_users                 │
│ Sync to wallet_balances                 │
└─────────────────────────────────────────┘
      ↓
Assign tickets (with retries)
      ↓
Create joincompetition entry
      ↓
Maybe create ledger entry
      ↓
Return response (no balance info)
```

**Issues:**
- 🔴 2197 lines of complex logic
- 🔴 Multiple fallback paths
- 🔴 Syncing across 3+ tables
- 🔴 Race conditions possible
- 🔴 Unclear error states
- 🔴 Hard to debug
- 🔴 No balance in response

---

## AFTER (Simplified) ✅

```
Frontend Request
      ↓
Purchase-with-bonus Edge Function (356 lines)
      ↓
┌─────────────────────────────────────────┐
│ purchase_tickets_with_balance RPC       │
│                                         │
│  BEGIN TRANSACTION;                     │
│                                         │
│  1. Check & Lock Balance                │
│     SELECT available_balance            │
│     FROM sub_account_balances           │
│     WHERE canonical_user_id = ?         │
│     FOR UPDATE;                         │
│                                         │
│  2. Verify Competition                  │
│                                         │
│  3. Determine Tickets                   │
│     (selected or lucky dip)             │
│                                         │
│  4. Calculate Cost                      │
│                                         │
│  5. Check Sufficient Balance            │
│                                         │
│  6. Deduct Balance                      │
│     UPDATE sub_account_balances         │
│     SET available_balance = balance - cost │
│                                         │
│  7. Create Ledger Entry                 │
│     (audit trail)                       │
│                                         │
│  8. Create Competition Entry            │
│     INSERT INTO joincompetition         │
│                                         │
│  9. Create Ticket Records               │
│     INSERT INTO tickets                 │
│                                         │
│  COMMIT;                                │
│                                         │
│  10. Return Complete Response           │
│      {success, tickets, new_balance}    │
└─────────────────────────────────────────┘
      ↓
Frontend receives balance update
```

**Benefits:**
- ✅ 356 lines (84% reduction)
- ✅ Single atomic transaction
- ✅ One source of truth
- ✅ Row-level locking (no race conditions)
- ✅ Clear error messages
- ✅ Easy to debug
- ✅ New balance in response

---

## Code Comparison

### BEFORE: Edge Function
```typescript
// 2197 lines of:
- Multiple RPC attempts
- Fallback logic
- Table syncing
- Complex error handling
- Retry mechanisms
- Balance lookups across multiple tables
- ...endless complexity
```

### AFTER: Edge Function
```typescript
// 356 lines of:
const { data, error } = await supabase.rpc(
  'purchase_tickets_with_balance',
  {
    p_user_identifier: userIdentifier,
    p_competition_id: competitionId,
    p_ticket_price: ticketPrice,
    p_ticket_numbers: ticketNumbers,
    p_idempotency_key: idempotent
  }
);

if (data.success) {
  return { status: 'ok', ...data };
} else {
  return { status: 'error', error: data.error };
}
```

---

## Database Operations

### BEFORE (Multiple Updates)
```sql
-- Try RPC
CALL debit_sub_account_balance(...);

-- If failed, update sub_account_balances
UPDATE sub_account_balances SET ...;

-- If failed, update wallet_balances  
UPDATE wallet_balances SET ...;

-- If failed, update canonical_users
UPDATE canonical_users SET ...;

-- Sync back to all tables
UPDATE sub_account_balances SET ...;
UPDATE canonical_users SET ...;
UPDATE wallet_balances SET ...;

-- Create entry (separate transaction)
INSERT INTO joincompetition ...;

-- Maybe create ledger
INSERT INTO balance_ledger ...;
```

### AFTER (One Transaction)
```sql
BEGIN;
  -- Lock balance
  SELECT ... FOR UPDATE;
  
  -- Deduct
  UPDATE sub_account_balances SET ...;
  
  -- Log
  INSERT INTO balance_ledger ...;
  
  -- Create entry
  INSERT INTO joincompetition ...;
  
  -- Create tickets
  INSERT INTO tickets ...;
COMMIT;
```

---

## Error Handling

### BEFORE
```
"Failed to update balance: <cryptic pg error>"
"Balance update did not affect any rows"
"RPC returned error: <unclear message>"
```

### AFTER
```json
{
  "error": "Insufficient balance",
  "errorCode": "INSUFFICIENT_BALANCE",
  "required": 50.00,
  "available": 25.00
}
```

---

## User Experience

### BEFORE
- ❌ No balance in response
- ❌ Need separate refresh call
- ❌ Unclear error messages
- ❌ Possible race conditions
- ❌ Slow (multiple DB ops)

### AFTER
- ✅ New balance in response
- ✅ Real-time balance update
- ✅ Clear, actionable errors
- ✅ Atomic (no races)
- ✅ Fast (single transaction)

---

## Metrics

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Lines of code | 2197 | 356 | **84% reduction** |
| DB queries | 8-15 | 1 transaction | **~90% reduction** |
| Tables touched | 3-5 | 1 primary | **Single source** |
| Error clarity | Low | High | **Clear codes** |
| Race conditions | Possible | None | **Atomic** |
| Maintainability | Hard | Easy | **Straightforward** |

---

## Security

### BEFORE
- Partial: Multiple update points
- Race conditions possible
- Balance inconsistencies possible

### AFTER
- Strong: SECURITY DEFINER + service_role only
- Row-level locking prevents races
- Atomic operations guarantee consistency
- Complete audit trail in balance_ledger

---

## Summary

**BEFORE**: Complex, fragile, hard to maintain
**AFTER**: Simple, reliable, easy to understand

✅ Requirement: "straightforward system" → **356 lines, single path**
✅ Requirement: "check sub_account_balance" → **Primary source with lock**
✅ Requirement: "match by wallet or canonical_user_id" → **Both supported**
✅ Requirement: "deduct balance" → **Atomic update**
✅ Requirement: "allocate tickets" → **Selected or lucky dip**
✅ Requirement: "just fucking work" → **Clear errors, atomic ops, idempotency**
✅ Requirement: "migration provided" → **Complete with security**

**Mission Accomplished!** 🎯
