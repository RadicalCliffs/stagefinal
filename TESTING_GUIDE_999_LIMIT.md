# Testing Guide: Lucky Dip 999 Ticket Limit

## Prerequisites
1. Database migration applied: `supabase db push`
2. Edge function deployed: `supabase functions deploy lucky-dip-reserve`

## Test Cases

### Test 1: Small Purchase (1-100 tickets)
**Expected:** Should work as before
```
1. Navigate to competition page
2. Set slider to 50 tickets
3. Click "BUY NOW"
4. Complete CAPTCHA
5. Verify reservation created successfully
```
**Success Criteria:** No errors, reservation created

### Test 2: Medium Purchase (100-500 tickets)
**Expected:** Should work as before
```
1. Navigate to competition page
2. Set slider to 300 tickets
3. Click "BUY NOW"
4. Complete CAPTCHA
5. Verify reservation created successfully
```
**Success Criteria:** No errors, reservation created

### Test 3: Previously Failing (500-999 tickets)
**Expected:** Now works! (Previously failed with 500 limit error)
```
1. Navigate to competition page
2. Set slider to 750 tickets
3. Click "BUY NOW"
4. Complete CAPTCHA
5. Verify reservation created successfully
```
**Success Criteria:** 
- ✅ No "Count cannot exceed 500" error
- ✅ Reservation created with all 750 tickets
- ✅ Single pending_ticket record in database

### Test 4: Maximum Purchase (999 tickets)
**Expected:** Should work up to the limit
```
1. Navigate to competition page
2. Set slider to 999 tickets (maximum)
3. Click "BUY NOW"
4. Complete CAPTCHA
5. Verify reservation created successfully
```
**Success Criteria:**
- ✅ No errors
- ✅ All 999 tickets reserved
- ✅ Single pending_ticket record
- ✅ Correct total_amount calculated

### Test 5: Over Limit (>999 tickets)
**Expected:** Should get validation error
```
1. Try to request 1000 tickets via API
```
**Success Criteria:**
- ✅ Returns 400 error
- ✅ Error message: "count is required and must be between 1 and 999"

## Database Verification

After a successful 999-ticket purchase, verify in Supabase:

```sql
-- Check pending_ticket record
SELECT 
  id,
  ticket_count,
  array_length(ticket_numbers, 1) as actual_count,
  total_amount,
  status
FROM pending_tickets 
WHERE id = '<reservation_id>';
```

Expected:
- ticket_count = 999
- actual_count = 999  
- status = 'pending'
- All ticket numbers unique

## Performance Verification

Monitor edge function logs during 999-ticket purchase:
```bash
supabase functions logs lucky-dip-reserve
```

Look for:
- Request completes in < 5 seconds
- No timeout errors
- No memory errors
- Single RPC call to allocate_lucky_dip_tickets_batch

## Rollback Plan

If issues occur:
```sql
-- Revert to 500 limit
DROP FUNCTION IF EXISTS allocate_lucky_dip_tickets_batch(TEXT, UUID, INTEGER, NUMERIC, INTEGER, TEXT, INTEGER[]);
-- Then restore from backup or re-run previous migration
```

## Success Metrics
- [ ] All test cases pass
- [ ] No 500-ticket limit errors in production
- [ ] Edge function performance acceptable
- [ ] Payment confirmation works with 999-ticket reservations
- [ ] No duplicate ticket allocations
