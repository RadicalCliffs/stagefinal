# Frontend Todo List - Madmen Sync Implementation

**Based on:** January 31, 2026 Madmen Sync Call  
**Priority:** Immediate (1-3 days)  
**Status:** Active Development

---

## 🔴 CRITICAL (Day 1 - Must Complete ASAP)

### 1. Implement Optimistic UI for Top-Ups ❌

**Issue:** Users wait 10+ seconds to see balance updates after top-up transactions  
**Conversation Reference:** (16:48) Luke 3PR suggested showing pending transactions as successful optimistically  
**Impact:** Poor UX, users think top-ups failed  

**Files to Modify:**
- `/src/hooks/useRealTimeBalance.ts`
- `/src/components/TopUpWalletModal.tsx`
- `/src/lib/coinbase-onramp.ts`

**Implementation Steps:**
```typescript
// 1. Add optimistic state to useRealTimeBalance.ts
export function useRealTimeBalance(canonicalUserId: string | null) {
  const [balance, setBalance] = useState<Balance | null>(null);
  const [optimisticBalance, setOptimisticBalance] = useState<number | null>(null);
  const [pendingTransactions, setPendingTransactions] = useState<PendingTx[]>([]);
  
  // Display optimistic balance immediately
  const displayBalance = optimisticBalance ?? balance?.available_balance ?? 0;
  
  // Add pending transaction
  const addPendingTopUp = (amount: number, txHash: string) => {
    setOptimisticBalance((current) => (current ?? balance?.available_balance ?? 0) + amount);
    setPendingTransactions([...pendingTransactions, { amount, txHash, timestamp: Date.now() }]);
  };
  
  // Clear when confirmed
  useEffect(() => {
    const subscription = supabase
      .channel(`balance:${canonicalUserId}`)
      .on('postgres_changes', { ... }, (payload) => {
        setBalance(payload.new);
        setOptimisticBalance(null); // Clear optimistic once confirmed
        setPendingTransactions([]);
      });
  }, [canonicalUserId]);
  
  return { balance, displayBalance, addPendingTopUp };
}

// 2. Update TopUpWalletModal.tsx
const { displayBalance, addPendingTopUp } = useRealTimeBalance(canonicalUserId);

const handleTopUpSubmit = async (amount: number) => {
  setStep('loading');
  
  // Show optimistic balance immediately
  addPendingTopUp(amount, 'pending');
  
  try {
    const result = await coinbaseOnramp.createTransaction(amount);
    
    // Show success immediately (optimistic)
    setStep('success');
    toast.success(`Added ${amount} chips! (Confirming on blockchain...)`);
    
    // Transaction will confirm in background via webhook
  } catch (error) {
    // Revert optimistic update on error
    addPendingTopUp(-amount, 'rollback');
    setStep('error');
  }
};
```

**Testing:**
1. Initiate top-up transaction
2. Verify balance updates immediately in UI
3. Verify "(Pending)" or similar indicator shown
4. Verify balance stabilizes after webhook confirmation
5. Test error case - verify rollback works

**Estimated Time:** 6-8 hours

---

### 2. Fix Duplicate Ledger Entries in Orders Display ⚠️

**Issue:** Balance ledger shows both debit AND entry records, causing duplicate/confusing transactions  
**Conversation Reference:** (03:38) System shows both debit and entry ledger items redundantly  
**Impact:** Users see duplicate transactions, confusion about actual balance  

**Files to Modify:**
- `/src/components/UserDashboard/Orders/OrdersList.tsx`
- `/src/components/UserDashboard/Orders/OrdersTable.tsx`
- `/src/services/dashboardEntriesService.ts`

**Current Issue:**
```typescript
// CURRENT (WRONG) - Shows all transactions
const { data: ledgerEntries } = await supabase
  .from('balance_ledger')
  .select('*')
  .eq('canonical_user_id', userId);

// Shows: 
// - "Debit for ticket purchase" (-$10)
// - "Entry for competition XYZ" (-$10)  <-- DUPLICATE!
```

**Fix:**
```typescript
// FIXED - Filter to show only user-relevant type
const { data: ledgerEntries } = await supabase
  .from('balance_ledger')
  .select('*')
  .eq('canonical_user_id', userId)
  .in('transaction_type', ['deposit', 'purchase', 'bonus', 'withdrawal'])
  .order('created_at', { ascending: false });

// OR show grouped view:
const groupedTransactions = ledgerEntries.reduce((acc, entry) => {
  // If entry has reference_id matching another entry, group them
  const existingGroup = acc.find(g => g.reference_id === entry.reference_id);
  if (existingGroup) {
    existingGroup.details.push(entry);
  } else {
    acc.push({ reference_id: entry.reference_id, details: [entry] });
  }
  return acc;
}, []);

// Display only the primary transaction, not both debit and entry
```

**UI Changes:**
```typescript
// OrdersList.tsx
<div className="transaction-item">
  <div className="transaction-type">
    {transaction.transaction_type === 'purchase' && '🎫 Ticket Purchase'}
    {transaction.transaction_type === 'deposit' && '💰 Deposit'}
    {transaction.transaction_type === 'bonus' && '🎁 Bonus'}
  </div>
  <div className="transaction-amount">
    {transaction.amount > 0 ? '+' : ''}{transaction.amount}
  </div>
  {/* Don't show the corresponding debit/entry pair */}
</div>
```

**Testing:**
1. View Orders/Transactions page
2. Make a ticket purchase
3. Verify only ONE transaction appears (not debit + entry)
4. Check balance_ledger in database - verify both records exist
5. Confirm UI filtering works correctly

**Estimated Time:** 2-4 hours

---

### 3. Add Pending Transaction Indicators ❌

**Issue:** No visual feedback when transactions are pending blockchain confirmation  
**Conversation Reference:** (16:48) Show pending transactions optimistically  
**Impact:** Users don't know if transaction is processing  

**Files to Create/Modify:**
- `/src/components/UserDashboard/PendingTransactionsBanner.tsx` (NEW)
- `/src/components/TopUpWalletModal.tsx`
- `/src/hooks/usePendingTransactions.ts` (NEW)

**Implementation:**
```typescript
// usePendingTransactions.ts
export function usePendingTransactions(canonicalUserId: string) {
  const [pending, setPending] = useState<PendingTransaction[]>([]);
  
  useEffect(() => {
    const checkPending = async () => {
      const { data } = await supabase
        .from('user_transactions')
        .select('*')
        .eq('canonical_user_id', canonicalUserId)
        .eq('wallet_credited', false)
        .gte('created_at', new Date(Date.now() - 3600000).toISOString());
      
      setPending(data || []);
    };
    
    checkPending();
    const interval = setInterval(checkPending, 5000);
    return () => clearInterval(interval);
  }, [canonicalUserId]);
  
  return pending;
}

// PendingTransactionsBanner.tsx
export function PendingTransactionsBanner({ userId }: { userId: string }) {
  const pending = usePendingTransactions(userId);
  
  if (pending.length === 0) return null;
  
  return (
    <div className="pending-banner">
      <div className="spinner" />
      <p>
        {pending.length} transaction{pending.length > 1 ? 's' : ''} pending confirmation...
      </p>
      {pending.map(tx => (
        <div key={tx.id} className="pending-item">
          +${tx.amount} - Confirming on blockchain
          <a href={`https://basescan.org/tx/${tx.tx_id}`} target="_blank">
            View Transaction
          </a>
        </div>
      ))}
    </div>
  );
}
```

**Testing:**
1. Initiate top-up
2. Verify pending banner appears
3. Wait for confirmation
4. Verify banner disappears when confirmed
5. Test with multiple pending transactions

**Estimated Time:** 3-4 hours

---

## 🟡 IMPORTANT (Day 2 - High Priority)

### 4. Improve Wallet Mismatch Error Handling ⚠️

**Issue:** Abrupt errors when user connects wrong Base wallet account  
**Conversation Reference:** (08:26) Gracefully inform users about mismatched accounts  
**Impact:** Poor UX, users confused why they can't log in  

**Files to Modify:**
- `/src/components/BaseWalletAuthModal.tsx`
- `/src/contexts/AuthContext.tsx`
- `/src/hooks/useCDPAuth.ts`

**Implementation:**
```typescript
// BaseWalletAuthModal.tsx
const handleWalletConnect = async (address: string) => {
  // Check if wallet already linked to different account
  const { data: existingUser } = await supabase
    .from('canonical_users')
    .select('email, canonical_user_id')
    .eq('base_wallet_address', address.toLowerCase())
    .single();
  
  if (existingUser && existingUser.canonical_user_id !== currentUser?.id) {
    // Show friendly error
    setError({
      title: 'Wallet Already Linked',
      message: `This wallet is already connected to ${existingUser.email || 'another account'}. 
                Please connect the wallet you used to sign up, or create a new account.`,
      action: 'Try Different Wallet'
    });
    return;
  }
  
  // Check if current user has different wallet linked
  if (currentUser?.base_wallet_address && 
      currentUser.base_wallet_address !== address.toLowerCase()) {
    setError({
      title: 'Different Wallet Detected',
      message: `Your account is linked to ${formatAddress(currentUser.base_wallet_address)}. 
                Connect that wallet to continue, or contact support to update your wallet.`,
      action: 'Connect Correct Wallet',
      supportAction: 'Contact Support'
    });
    return;
  }
  
  // Proceed with normal login
  await performLogin(address);
};
```

**UI Improvements:**
```typescript
// Error display
<div className="wallet-error-modal">
  <div className="error-icon">⚠️</div>
  <h3>{error.title}</h3>
  <p>{error.message}</p>
  <div className="error-actions">
    <button onClick={handleRetry}>{error.action}</button>
    {error.supportAction && (
      <button onClick={contactSupport}>{error.supportAction}</button>
    )}
  </div>
</div>
```

**Testing:**
1. Create test account with wallet A
2. Try to log in with wallet B
3. Verify friendly error message appears
4. Test support contact flow
5. Verify correct wallet login works

**Estimated Time:** 2-3 hours

---

### 5. Add Balance Synchronization Health Check ❌

**Issue:** Race conditions between canonical_users.balance and sub_account_balances.available_balance  
**Conversation Reference:** (56:53) Discrepancies traced to race conditions during queries  
**Impact:** Users see incorrect balance amounts  

**Files to Create/Modify:**
- `/src/hooks/useBalanceHealthCheck.ts` (NEW)
- `/src/components/UserDashboard/BalanceHealthIndicator.tsx` (NEW)

**Implementation:**
```typescript
// useBalanceHealthCheck.ts
export function useBalanceHealthCheck(canonicalUserId: string) {
  const [healthStatus, setHealthStatus] = useState<'healthy' | 'syncing' | 'error'>('healthy');
  
  useEffect(() => {
    const checkHealth = async () => {
      // Get balance from both sources
      const [canonicalData, subAccountData] = await Promise.all([
        supabase.from('canonical_users').select('balance').eq('canonical_user_id', canonicalUserId).single(),
        supabase.from('sub_account_balances').select('available_balance').eq('canonical_user_id', canonicalUserId).single()
      ]);
      
      const diff = Math.abs(
        (canonicalData.data?.balance || 0) - 
        (subAccountData.data?.available_balance || 0)
      );
      
      if (diff > 0.01) {
        // Out of sync
        setHealthStatus('error');
        
        // Trigger sync
        await supabase.rpc('sync_user_balances', {
          p_canonical_user_id: canonicalUserId
        });
        
        setHealthStatus('syncing');
      } else {
        setHealthStatus('healthy');
      }
    };
    
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, [canonicalUserId]);
  
  return healthStatus;
}
```

**Testing:**
1. Create scenario where balances are out of sync
2. Verify health check detects issue
3. Verify auto-sync triggered
4. Confirm balance corrects itself

**Estimated Time:** 4-5 hours

---

### 6. Entries Page Pagination Adjustment (Optional) ✅→⚠️

**Issue:** Currently shows 10 items per page, conversation mentioned 20  
**Conversation Reference:** (35:03) Capped at showing 20 initially  
**Impact:** Minor UX difference  

**Files to Modify:**
- `/src/components/UserDashboard/Entries/EntriesList.tsx`

**Simple Change:**
```typescript
// Change from
const ITEMS_PER_PAGE = 10;

// To
const ITEMS_PER_PAGE = 20;
```

**Testing:**
1. Navigate to Entries page with 25+ entries
2. Verify 20 entries shown per page
3. Verify pagination works correctly

**Estimated Time:** 15 minutes

---

## 🟢 NICE TO HAVE (Day 3 - Polish)

### 7. Add Loading States for Balance Operations ❌

**Issue:** No clear loading feedback during balance operations  
**Impact:** Users uncertain if action is processing  

**Files to Modify:**
- `/src/components/UserDashboard/Account/AccountLayout.tsx`
- `/src/components/PaymentModal.tsx`

**Implementation:**
```typescript
const [isProcessing, setIsProcessing] = useState(false);

const handlePurchase = async () => {
  setIsProcessing(true);
  try {
    await purchaseTicketsWithBalance({ ... });
  } finally {
    setIsProcessing(false);
  }
};

// UI
<button disabled={isProcessing}>
  {isProcessing ? (
    <>
      <Spinner /> Processing...
    </>
  ) : (
    'Purchase Tickets'
  )}
</button>
```

**Estimated Time:** 2 hours

---

### 8. Improve Top-Up Modal Cancel Button Visibility ✅

**Status:** Already implemented but verify clarity  
**Conversation Reference:** (14:36) Adding a cancel button alongside next button  

**Files to Review:**
- `/src/components/TopUpWalletModal.tsx`

**Verification:**
- [ ] Cancel button visible on method selection screen
- [ ] Cancel button visible on amount entry screen
- [ ] Cancel button visible on loading screen
- [ ] Close button on success screen

**If missing, add:**
```typescript
<div className="modal-actions">
  <button onClick={handleClose} className="cancel-btn">
    Cancel
  </button>
  <button onClick={handleNext} className="primary-btn">
    Next
  </button>
</div>
```

**Estimated Time:** 1 hour (review + minor fixes)

---

### 9. Add Transaction History Export ❌

**Issue:** Users can't export their transaction history  
**Impact:** QoL improvement  

**Files to Create:**
- `/src/components/UserDashboard/Orders/ExportButton.tsx` (NEW)
- `/src/lib/export-utils.ts` (NEW)

**Implementation:**
```typescript
const exportTransactions = async (userId: string) => {
  const { data } = await supabase
    .from('balance_ledger')
    .select('*')
    .eq('canonical_user_id', userId)
    .order('created_at', { ascending: false });
  
  // Convert to CSV
  const csv = convertToCSV(data);
  downloadFile(csv, `transactions-${Date.now()}.csv`);
};
```

**Estimated Time:** 2-3 hours

---

### 10. Add Realtime Balance Sync Indicator ❌

**Issue:** Users don't know if balance is syncing in real-time  
**Impact:** Uncertainty about data freshness  

**Files to Create:**
- `/src/components/BalanceSyncIndicator.tsx` (NEW)

**Implementation:**
```typescript
export function BalanceSyncIndicator() {
  const [lastSync, setLastSync] = useState<Date>(new Date());
  const [isOnline, setIsOnline] = useState(true);
  
  useEffect(() => {
    const channel = supabase.channel('balance-sync-status')
      .on('presence', { event: 'sync' }, () => {
        setLastSync(new Date());
      })
      .subscribe();
    
    return () => channel.unsubscribe();
  }, []);
  
  return (
    <div className="sync-indicator">
      {isOnline ? (
        <>
          <span className="dot online" /> 
          Synced {formatDistanceToNow(lastSync)} ago
        </>
      ) : (
        <>
          <span className="dot offline" />
          Offline
        </>
      )}
    </div>
  );
}
```

**Estimated Time:** 2 hours

---

## 📋 Testing Checklist

After implementing above changes, verify:

### Top-Up Flow
- [ ] Balance updates immediately (optimistic)
- [ ] Pending indicator shows during confirmation
- [ ] Balance stabilizes after webhook
- [ ] Error cases rollback optimistic updates
- [ ] Cancel button works at all steps

### Orders/Transactions
- [ ] No duplicate entries in transaction list
- [ ] Balance ledger filters correctly
- [ ] Transaction types display clearly
- [ ] Amounts are accurate

### Balance Sync
- [ ] canonical_users.balance matches sub_account_balances.available_balance
- [ ] No race conditions during rapid updates
- [ ] Health check auto-corrects issues
- [ ] Realtime sync works across tabs

### Entries Page
- [ ] Pagination works correctly (20 items per page)
- [ ] Filters work (Live, Finished, Instant)
- [ ] Loading states appropriate
- [ ] Winner status displays correctly

---

## 🎯 Summary

**Total Estimated Time:** 25-35 hours

**Critical Path (Day 1):**
1. Optimistic UI (8h)
2. Duplicate entries fix (3h)
3. Pending indicators (3h)

**Day 2:**
4. Wallet error handling (3h)
5. Balance health check (5h)
6. Pagination adjustment (15min)

**Day 3:**
7-10. Polish items (7-10h)

---

**Last Updated:** January 31, 2026 12:06 UTC  
**Next Review:** After Day 1 implementation complete
