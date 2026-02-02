# DEPLOYMENT CHECKLIST - WHAT TO DEPLOY

## Files Changed (CODEBASE - NOT JUST MIGRATIONS)

### 1. Frontend Code Fix (CRITICAL)
**File:** `src/lib/database.ts`

**Changes:**
- Line 1734: Fixed RPC parameter name (`user_identifier` not `p_user_identifier`)
- Lines 1747-1811: Removed redundant competition query, use RPC data directly
- Lines 3563-3587: Fixed field name mappings with fallbacks

**Deploy:** Build and deploy frontend application

---

### 2. Database Migration (Already Applied)
**Files:** 
- `supabase/migrations/20260202090000_fix_dashboard_production_schema.sql` (balance sync)
- `supabase/migrations/20260202095000_fix_dashboard_data_issues.sql` (RPC fixes)

**Deploy:** Already ran via SQL editor (you mentioned this)

---

## Deployment Steps

### Step 1: Deploy Frontend Code ✅ REQUIRED
```bash
# Build the frontend with the fixes
npm run build

# Deploy to your hosting (Netlify/Vercel/etc)
# Or whatever your deployment process is
```

**This is the CRITICAL step.** The migrations won't help if the frontend can't read the data correctly.

### Step 2: Verify Balance Sync (Optional - Only if Discrepancy Still Exists)
```sql
-- Run this in Supabase SQL editor to fix existing balance discrepancies
SELECT * FROM sync_balance_discrepancies();
```

---

## What Each Fix Does

### Frontend Fix (database.ts)

**Before:**
```typescript
// Orders tab empty - wrong parameter
.rpc('get_user_transactions', { p_user_identifier: userId })

// Entries missing data - wrong field names
number_of_tickets: entry.ticket_count  // RPC returns tickets_count
amount_spent: entry.amount_paid        // RPC returns amount_spent
```

**After:**
```typescript
// Orders tab works - correct parameter
.rpc('get_user_transactions', { user_identifier: userId })

// Entries show data - correct field names
number_of_tickets: entry.tickets_count || entry.ticket_count
amount_spent: entry.amount_spent || entry.amount_paid
```

---

## Testing After Deployment

### Test 1: Orders Tab - Purchases
1. Go to User Dashboard → Orders → Purchases
2. Should see: All transactions including top-ups
3. Should show: Competition names, images, amounts, payment providers

### Test 2: Orders Tab - Transactions  
1. Go to User Dashboard → Orders → Transactions
2. Should see: Competition entries (no top-ups)
3. Should show: All transaction details with images

### Test 3: Entries Tab
1. Go to User Dashboard → Entries → Live
2. Should see: Your active entries
3. Should show: Competition images, amounts spent, ticket counts
4. Click on entry → Should navigate to competition details

### Test 4: Entry Details
1. From Entries list, click on a competition
2. Should navigate to: `/dashboard/entries/competition/{id}`
3. Should show: All your entries for that competition
4. Should show: Ticket numbers, amounts, transaction hashes

---

## If Issues Persist After Frontend Deploy

### Orders Tab Still Empty?
Check browser console for errors:
```javascript
// Should see in network tab:
// POST /rest/v1/rpc/get_user_transactions
// Request body: {"user_identifier": "prize:pid:0x..."}
// Response: [array of transactions]
```

If response is still empty:
1. Check the `user_identifier` being sent matches your canonical_user_id
2. Check `user_transactions` table has rows for your user
3. Run query manually in SQL editor:
```sql
SELECT * FROM user_transactions 
WHERE canonical_user_id = 'your-canonical-id'
LIMIT 10;
```

### Entries Missing Data?
Check what the RPC is returning:
```sql
SELECT * FROM get_user_competition_entries('your-canonical-id');
```

Should return rows with:
- `competition_image_url` (not null)
- `amount_spent` (not null)  
- `tickets_count` (not null)
- `latest_purchase_at` (not null)

---

## Summary

### What Was Fixed in CODEBASE:
1. ✅ RPC parameter name (src/lib/database.ts line 1734)
2. ✅ Field name mappings (src/lib/database.ts lines 3563-3587)
3. ✅ Removed redundant queries (src/lib/database.ts lines 1747-1811)

### What Was Fixed in DATABASE:
1. ✅ Balance sync functions (migration already applied)
2. ✅ RPC functions with proper fields (migration already applied)

### What Needs to Happen:
1. **DEPLOY FRONTEND CODE** ← This is the key step
2. Test in production
3. Profit

The migrations are useless without the frontend code fixes.
The frontend code fixes are useless without the migrations.
**Both are now complete and ready to deploy together.**
