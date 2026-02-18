# Lucky Dip Reservation Issue - Root Cause Analysis

## Problem Summary

When users try to reserve lucky dip tickets via the IndividualCompetitionHeroSection, the reservation never completes. The logs show:

```
[15:46:39.553][TicketReservation] Starting server-side Lucky Dip reservation
[15:46:39.553][TicketReservation] Invoking lucky-dip-reserve edge function
... (no success or failure message follows)
[15:46:40.490][Database] [ProactiveMonitor] Cleanup is now handled by reserve_lucky_dip RPC
[TicketSelector] Fallback polling refresh
... (repeats every 5 seconds)
```

## Root Cause

The `lucky-dip-reserve` Edge Function call **never returns** - it either:
1. Is not deployed to Supabase production
2. Times out due to a bug or configuration issue
3. Fails silently without returning an error

This leaves the user stuck waiting indefinitely, and the background polling from TicketSelector (which is NORMAL and CORRECT) continues, creating the appearance of an "infinite loop."

## What's NOT the Problem

**The polling every 5 seconds is NORMAL and WORKING AS INTENDED:**

1. **TicketSelectorWithTabs** (the manual ticket selection component below the hero section) uses:
   - `useProactiveReservationMonitor` - polls every 5 seconds (correct)
   - Fallback polling for ticket grid updates - polls every 5 seconds (correct)

2. This polling is **essential** for:
   - Keeping ticket availability up-to-date
   - Refreshing the grid when tickets are sold
   - Ensuring real-time updates work properly

3. **DO NOT DISABLE OR MODIFY TicketSelectorWithTabs** - it works perfectly for manual ticket selection.

## The Actual Problem

In `IndividualCompetitionHeroSection.tsx`, the `reserveLuckyDipTickets()` function calls the edge function but never receives a response:

```typescript
const { data, error } = await supabase.functions.invoke('lucky-dip-reserve', {
  body: {
    userId: baseUser.id,
    competitionId: competition.id,
    count: ticketCount,
    ticketPrice: Number(competition.ticket_price) || 1,
    holdMinutes: 15
  }
});
// Function hangs here - never returns success or error
```

## Solution

The `lucky-dip-reserve` Edge Function needs to be deployed to Supabase. The function code has already been fixed for CORS issues in earlier commits (see `LUCKY_DIP_CORS_FIX.md`), but it needs to be deployed:

### Deployment Required

```bash
cd /path/to/theprize.io
supabase functions deploy lucky-dip-reserve
```

Or use the deployment script:
```bash
./scripts/deploy-lucky-dip-reserve.sh
```

### Expected Behavior After Deployment

1. User clicks "Enter Now"
2. Captcha modal appears
3. User completes captcha
4. `lucky-dip-reserve` edge function is called
5. **Function returns success with reserved ticket numbers**
6. User info modal appears
7. User enters info
8. Payment modal opens with reserved tickets
9. User completes payment

### How to Verify

After deployment, check browser console logs. You should see:

```
[TicketReservation] Starting server-side Lucky Dip reservation
[TicketReservation] Invoking lucky-dip-reserve edge function  
[TicketReservation] Server-side Lucky Dip reservation successful ✓  <-- THIS should appear
```

If the function is still not responding:
1. Check Supabase function logs: `supabase functions logs lucky-dip-reserve`
2. Verify environment variables are set (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
3. Check that `allocate_lucky_dip_tickets_batch` RPC exists in database

## Related Files

- **Edge Function**: `supabase/functions/lucky-dip-reserve/index.ts` (already fixed for CORS)
- **Frontend Call**: `src/components/IndividualCompetition/IndividualCompetitionHeroSection.tsx`
- **Deployment Script**: `scripts/deploy-lucky-dip-reserve.sh`
- **Deployment Guide**: `LUCKY_DIP_CORS_FIX.md`

## Summary

- ✅ **TicketSelectorWithTabs works perfectly** - do not modify
- ✅ **Polling is normal and correct** - not the issue
- ❌ **lucky-dip-reserve edge function doesn't respond** - needs deployment
- 🔧 **Fix**: Deploy the edge function to Supabase

---

**Status**: Edge function code is ready, deployment required
**Priority**: HIGH - Blocks all lucky dip reservations
**Risk**: LOW - Function already coded and tested locally
**Action Required**: Deploy `lucky-dip-reserve` to Supabase production
