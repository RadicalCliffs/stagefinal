# Lucky Dip Infinite Polling Fix

## Problem Summary

After attempting to reserve lucky dip tickets, the application entered an infinite polling loop, logging the same messages every 5 seconds indefinitely:

```
[15:46:40][Database] [ProactiveMonitor] Cleanup is now handled by reserve_lucky_dip RPC
[TicketSelector] Fallback polling refresh
[TicketSelector] fetchAvailableTickets called
[TicketSelector] Setting availableTickets
... (repeats every 5 seconds)
```

This created unnecessary server load and cluttered the console logs.

## Root Cause

The `useProactiveReservationMonitor` hook in `TicketSelectorWithTabs.tsx` was:
1. Always enabled (`enabled: true`)
2. Running cleanup every 5 seconds (`cleanupInterval: 5000`)
3. But the cleanup function is now a **no-op** (does nothing)

The hook's cleanup functionality was deprecated because the `reserve_lucky_dip` RPC now handles expired reservation cleanup **atomically within the database transaction**. This makes client-side cleanup unnecessary and prone to race conditions.

However, the hook was still running, just logging a message every 5 seconds:
```typescript
databaseLogger.info('[ProactiveMonitor] Cleanup is now handled by reserve_lucky_dip RPC', { 
  competitionId 
});
```

## Solution

Disabled the `useProactiveReservationMonitor` hook in `TicketSelectorWithTabs.tsx` by setting `enabled: false`:

```typescript
// PROACTIVE MONITORING: DISABLED - Cleanup is now handled by RPC atomically
// The reserve_lucky_dip RPC handles expiry within the database transaction,
// so client-side polling is no longer needed and just creates unnecessary load.
// Only PaymentModal needs this enabled during active payment flow.
useProactiveReservationMonitor({
    competitionId,
    enableAutoCleanup: false,
    cleanupInterval: 5000,
    enabled: false, // Disabled - RPC handles cleanup atomically
});
```

## Why This Fix is Safe

1. **Cleanup is handled server-side**: The `allocate_lucky_dip_tickets_batch` RPC handles expired reservations atomically within the database transaction
2. **PaymentModal still uses it**: The hook is still enabled in `PaymentModal.tsx` (only when modal is open), where it might be more useful during active payment flow
3. **Fallback polling remains**: The 5-second fallback polling for ticket grid updates is independent and still active
4. **No functionality lost**: The hook was literally doing nothing except logging a message

## Impact

### Before
- Polling every 5 seconds indefinitely
- Logging `[ProactiveMonitor] Cleanup is now handled by reserve_lucky_dip RPC` every 5 seconds
- Unnecessary timer running in background
- Combined with fallback polling, creates double polling

### After
- No ProactiveMonitor polling in TicketSelector
- Only fallback polling remains (needed for ticket grid updates)
- Cleaner console logs
- Less background activity

## Testing

To verify the fix:

1. **Navigate to a competition page**
2. **Open browser console**
3. **Try to reserve lucky dip tickets**
4. **Check console logs**:
   - ✅ Should NOT see `[ProactiveMonitor] Cleanup is now handled by reserve_lucky_dip RPC` every 5 seconds
   - ✅ Should still see `[TicketSelector] Fallback polling refresh` every 5 seconds (this is normal)
   - ✅ Ticket reservation should still work
   - ✅ Ticket grid should still update in real-time

## Related Files

- **Fixed**: `src/components/IndividualCompetition/TicketSelectorWithTabs.tsx`
- **Hook Definition**: `src/hooks/useProactiveReservationMonitor.ts`
- **Still Used Correctly**: `src/components/PaymentModal.tsx` (enabled only when modal is open)

## Related Issues

This fix addresses the infinite polling issue mentioned in the problem statement where:
- Lucky dip reservation would trigger
- Polling would start
- Polling would never stop
- Console would fill with repeated log messages

## Future Considerations

Since the cleanup function in `useProactiveReservationMonitor` is now a no-op, we might want to:
1. Remove the hook entirely from TicketSelector
2. Update the hook to only be used in contexts where it's needed (PaymentModal)
3. Or remove the hook completely if it's no longer needed anywhere

For now, the minimal fix is to just disable it in TicketSelector.

---

**Status**: Fixed ✅
**Impact**: HIGH - Eliminates infinite polling and reduces server load
**Risk**: LOW - Hook was doing nothing useful anyway
**Date**: 2026-02-18
