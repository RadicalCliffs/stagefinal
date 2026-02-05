# Lucky Dip Fix - Quick Reference

## What Changed

### 🎯 Lucky Dip Flow (CHANGED)
**Before:** Client-side selection + `reserve_tickets` with list → Race conditions ❌
**After:** Server-side `lucky-dip-reserve` → Atomic allocation ✅

```typescript
// OLD (removed)
const available = await fetchAvailableTickets();
const selected = randomSelect(available, count);
await reserve_tickets({ selectedTickets: selected });

// NEW (implemented)
await supabase.functions.invoke('lucky-dip-reserve', {
  body: { userId, competitionId, count, ticketPrice }
});
```

### 🎯 Chosen Ticket Flow (UNCHANGED)
**Still:** Manual selection → `reserve_tickets` with exact numbers → 409 if unavailable ✅

### 🎯 Purchase Finalization (UPDATED)
**Before:** `confirm_ticket_purchase` RPC
**After:** `finalize_pending_tickets_autoreplace` RPC → Auto-replaces unavailable tickets ✅

## Critical Rules

### ✅ DO
- **Lucky Dip**: ALWAYS use `lucky-dip-reserve` edge function
- **Chosen Tickets**: ALWAYS use `reserve_tickets` edge function
- **Finalization**: Use `finalize_pending_tickets_autoreplace` for reservations

### ❌ DON'T
- **Lucky Dip**: Never fetch availability client-side and select tickets client-side
- **Finalization**: Never use `confirm_ticket_purchase` (replaced)
- **Manual Flow**: Never change the chosen-ticket flow (it's working correctly)

## Testing

### Smoke Test (Lucky Dip)
1. Open competition page
2. Set slider to 100 tickets
3. Click "Enter Now" → Complete captcha
4. **Expected:** Reservation succeeds immediately
5. **Check logs:** Should say "server-side Lucky Dip reservation"

### Smoke Test (Chosen Tickets)
1. Open competition page  
2. Click "Ticket Selector" tab
3. Select tickets 1, 2, 3, 4, 5
4. Click "Reserve"
5. **Expected:** Reservation succeeds with exact tickets
6. **Check logs:** Should say "reserve_tickets"

## Key Files

| File | Change | Lines |
|------|--------|-------|
| `IndividualCompetitionHeroSection.tsx` | Lucky Dip logic replaced | -23 |
| `lucky-dip-reserve/index.ts` | Fixed bug | +1 |
| `purchase-tickets-with-bonus/index.ts` | New finalization RPC | +25 |
| `LUCKY_DIP_FIX_SUMMARY.md` | Test plan | +320 |

## Troubleshooting

### Issue: Lucky Dip still fails with "tickets no longer available"
**Check:**
1. Is frontend calling `lucky-dip-reserve`? (not `reserve_tickets`)
2. Are edge functions deployed?
3. Check logs for "server-side Lucky Dip reservation"

### Issue: Chosen tickets not reserving
**Check:**
1. Should still use `reserve_tickets` (don't change this flow)
2. 409 errors are expected when tickets are taken
3. UI should auto-remove unavailable tickets

### Issue: Purchase failing after reservation
**Check:**
1. Is `finalize_pending_tickets_autoreplace` RPC available in database?
2. Check logs for "[finalize] Calling finalize_pending_tickets_autoreplace"
3. Fallback should work if RPC missing

## Support

For detailed test cases and implementation details, see:
- `LUCKY_DIP_FIX_SUMMARY.md` - Comprehensive test plan
- Git commits for code changes and comments
