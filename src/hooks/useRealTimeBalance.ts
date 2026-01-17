import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthUser } from '../contexts/AuthContext';
import { toPrizePid, userIdsEqual, isWalletAddress, normalizeWalletAddress } from '../utils/userId';

interface RealTimeBalanceState {
  balance: number;
  bonusBalance: number;
  totalBalance: number;
  pendingBalance: number;
  hasUsedBonus: boolean;
  isLoading: boolean;
  error: string | null;
  lastUpdate: Date | null;
}

/**
 * Real-time user balance hook with Supabase subscriptions
 *
 * Provides live updates for:
 * - Available balance from sub_account_balances table (USD currency)
 * - Pending balance changes
 * - Transaction completions
 *
 * The sub_account_balances table is the single source of truth for balance.
 * Users are identified by canonical_user_id (prize:pid: format) or user_id (privy DID).
 */
export function useRealTimeBalance(): RealTimeBalanceState & {
  refresh: () => Promise<void>;
} {
  const { baseUser } = useAuthUser();
  const [balance, setBalance] = useState(0);
  const [bonusBalance, setBonusBalance] = useState(0);
  const [pendingBalance, setPendingBalance] = useState(0);
  const [hasUsedBonus, setHasUsedBonus] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  // Store the user's uid from the database for consistent real-time subscriptions
  const userUidRef = useRef<string | null>(null);
  // Track when a payment event updated the balance - prevent DB overwrites during cooldown
  const lastEventUpdateRef = useRef<number>(0);
  // Cooldown period (10 seconds) to let DB replicate before allowing DB reads
  const EVENT_COOLDOWN_MS = 10000;

  const userId = baseUser?.id;

  const fetchBalance = useCallback(async (options?: { bypassCooldown?: boolean }) => {
    if (!userId) {
      setIsLoading(false);
      return;
    }

    // Check if we're within the cooldown period after an event update
    // This prevents stale DB data from overwriting the correct balance from payment events
    // The DB may have replication lag, so we trust the server's immediate response instead
    const timeSinceEvent = Date.now() - lastEventUpdateRef.current;
    if (!options?.bypassCooldown && timeSinceEvent < EVENT_COOLDOWN_MS) {
      console.log('[RealTimeBalance] Skipping DB fetch during cooldown period, time remaining:', EVENT_COOLDOWN_MS - timeSinceEvent, 'ms');
      setIsLoading(false);
      return;
    }

    try {
      // Use get_user_balance RPC for consistent balance lookups
      // This now reads from sub_account_balances.available_balance as the source of truth
      // IMPORTANT: Always use canonical_user_id (prize:pid: format) for RPC lookups
      const canonicalUserId = toPrizePid(userId);

      console.log('[RealTimeBalance] Fetching balance for:', {
        originalUserId: userId?.substring(0, 20) + '...',
        canonicalUserId: canonicalUserId.substring(0, 30) + '...',
      });

      // Primary: Use get_user_balance RPC function (reads from sub_account_balances)
      // The RPC filters on canonical_user_id with case-insensitive LOWER() matching
      const { data: rpcBalance, error: rpcError } = await supabase.rpc('get_user_balance', {
        p_canonical_user_id: canonicalUserId
      });

      // Check for type mismatch error (can occur if database migration not applied)
      const isTypeMismatchError = rpcError?.message?.includes('operator does not exist') ||
        rpcError?.message?.includes('type cast') ||
        rpcError?.code === '42883' ||
        rpcError?.code === '42846';

      if (!rpcError && rpcBalance !== null) {
        const balanceValue = Number(rpcBalance) || 0;
        setBalance(balanceValue);
        setBonusBalance(0); // bonus_balance not used in new system
        setLastUpdate(new Date());
        setError(null);
        console.log('[RealTimeBalance] Balance fetched via RPC from sub_account_balances:', balanceValue);

        // Also fetch pending balance and user metadata from sub_account_balances
        const { data: subAccountData } = await supabase
          .from('sub_account_balances')
          .select('id, user_id, pending_balance, canonical_user_id, privy_user_id')
          .eq('currency', 'USD')
          .or(`canonical_user_id.eq.${canonicalUserId},user_id.eq.${userId},privy_user_id.eq.${userId}`)
          .limit(1);

        if (subAccountData && subAccountData.length > 0) {
          const record = subAccountData[0];
          if (record.user_id) {
            userUidRef.current = record.user_id;
          }
          setPendingBalance(Number(record.pending_balance) || 0);
        }

        // Fetch bonus status from canonical_users (still stored there)
        const { data: userData } = await supabase
          .from('canonical_users')
          .select('uid, has_used_new_user_bonus, canonical_user_id')
          .or(`canonical_user_id.eq.${canonicalUserId},privy_user_id.eq.${userId}`)
          .limit(1);

        if (userData && userData.length > 0) {
          if (userData[0].uid && !userUidRef.current) {
            userUidRef.current = userData[0].uid;
          }
          setHasUsedBonus(userData[0].has_used_new_user_bonus || false);
        }
        return;
      }

      // Fallback: Direct query to sub_account_balances if RPC fails
      if (isTypeMismatchError) {
        console.warn('[RealTimeBalance] RPC type mismatch error - database migration may need to be applied. Falling back to direct query.');
      } else {
        console.log('[RealTimeBalance] RPC failed, falling back to direct query:', rpcError?.message);
      }

      const userIsWallet = isWalletAddress(userId);
      const normalizedUserId = userIsWallet ? normalizeWalletAddress(userId) || userId.toLowerCase() : userId;
      // Also try lowercase version of canonical ID for case-insensitive matching
      const canonicalUserIdLower = canonicalUserId.toLowerCase();

      // Try sub_account_balances directly with case-insensitive matching
      // Use ilike for canonical_user_id to handle potential case mismatches
      const { data: subAccountData, error: subAccountError } = await supabase
        .from('sub_account_balances')
        .select('id, user_id, available_balance, pending_balance, canonical_user_id, privy_user_id')
        .eq('currency', 'USD')
        .or(`canonical_user_id.ilike.${canonicalUserIdLower},canonical_user_id.eq.${canonicalUserId},user_id.eq.${userId},privy_user_id.eq.${userId}`)
        .limit(1);

      if (subAccountData && subAccountData.length > 0 && !subAccountError) {
        const record = subAccountData[0];
        if (record.user_id) {
          userUidRef.current = record.user_id;
        }
        const balanceValue = Number(record.available_balance) || 0;
        setBalance(balanceValue);
        setBonusBalance(0);
        setPendingBalance(Number(record.pending_balance) || 0);
        setLastUpdate(new Date());
        setError(null);
        console.log('[RealTimeBalance] Balance fetched from sub_account_balances:', balanceValue);

        // Fetch bonus status from canonical_users
        const { data: userData } = await supabase
          .from('canonical_users')
          .select('has_used_new_user_bonus')
          .or(`canonical_user_id.eq.${canonicalUserId},privy_user_id.eq.${userId}`)
          .limit(1);
        if (userData && userData.length > 0) {
          setHasUsedBonus(userData[0].has_used_new_user_bonus || false);
        }
        return;
      }

      // If we get here, no balance record was found
      // Set balance to 0 - the user may need to create an account or top up
      console.log('[RealTimeBalance] No balance record found for user:', canonicalUserId.substring(0, 25) + '...');
      console.log('[RealTimeBalance] User may need to top up their wallet to create a balance record');

      // Try to get bonus status from canonical_users (still stored there)
      const { data: userData } = await supabase
        .from('canonical_users')
        .select('uid, has_used_new_user_bonus')
        .eq('canonical_user_id', canonicalUserId)
        .limit(1);

      if (userData && userData.length > 0) {
        if (userData[0].uid) {
          userUidRef.current = userData[0].uid;
        }
        setHasUsedBonus(userData[0].has_used_new_user_bonus || false);
      }

      // Set balance to 0 - no errors, just no balance yet
      setBalance(0);
      setBonusBalance(0);
      setPendingBalance(0);
      setLastUpdate(new Date());
      setError(null);
    } catch (err) {
      console.error('Error fetching balance:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch balance');
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    // Initial fetch
    fetchBalance();

    // Determine filter strategy based on identifier type
    const userIsWallet = isWalletAddress(userId);
    // Normalize wallet address to lowercase for consistent matching
    const normalizedUserId = userIsWallet ? normalizeWalletAddress(userId) || userId.toLowerCase() : userId;
    // Convert to canonical format for channel naming
    const canonicalUserId = toPrizePid(userId);

    // Set up real-time subscription for balance changes
    // We subscribe to the table and filter in the callback to handle case-insensitive matching
    // Since Supabase real-time filters are case-sensitive, we need client-side filtering
    const channel = supabase
      .channel(`user-balance-${canonicalUserId}`)
      // PRIMARY: Listen for balance updates on sub_account_balances (source of truth)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sub_account_balances',
        },
        (payload) => {
          // Filter in callback to handle case-insensitive matching
          const record = payload.new as {
            user_id?: string;
            canonical_user_id?: string;
            privy_user_id?: string;
            available_balance?: number;
            pending_balance?: number;
            currency?: string;
          };

          // Only process USD currency records
          if (record.currency && record.currency !== 'USD') {
            return;
          }

          // Check if this update is for the current user
          const matchesUserId = userIdsEqual(record.user_id, userId);
          const matchesCanonical = userIdsEqual(record.canonical_user_id, canonicalUserId);
          const matchesPrivyId = userIdsEqual(record.privy_user_id, userId);

          if (matchesUserId || matchesCanonical || matchesPrivyId) {
            console.log('[RealTimeBalance] sub_account_balances update detected:', payload.eventType);
            fetchBalance();
          }
        }
      )
      // LEGACY: Listen for balance updates on canonical_users (fallback for older records)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'canonical_users',
        },
        (payload) => {
          // Filter in callback to handle case-insensitive wallet address matching
          const record = payload.new as {
            uid?: string;
            wallet_address?: string;
            base_wallet_address?: string;
            privy_user_id?: string;
            canonical_user_id?: string;
          };

          // Check if this update is for the current user using userIdsEqual for case-insensitive comparison
          const matchesUid = userUidRef.current && record.uid === userUidRef.current;
          const matchesWallet = userIdsEqual(record.wallet_address, userId);
          const matchesBaseWallet = userIdsEqual(record.base_wallet_address, userId);
          const matchesPrivyId = userIdsEqual(record.privy_user_id, userId);
          const matchesCanonical = userIdsEqual(record.canonical_user_id, canonicalUserId);

          if (matchesUid || matchesWallet || matchesBaseWallet || matchesPrivyId || matchesCanonical) {
            console.log('[RealTimeBalance] canonical_users update detected:', payload.eventType);
            fetchBalance();
          }
        }
      )
      // SECONDARY: Listen for balance updates on wallet_balances (created for RLS support, important for Base users)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'wallet_balances',
        },
        (payload) => {
          // Filter in callback to handle case-insensitive wallet address matching
          const record = payload.new as {
            user_id?: string;
            canonical_user_id?: string;
            wallet_address?: string;
            base_wallet_address?: string;
            balance?: number;
          };

          // Check if this update is for the current user
          const matchesUserId = userUidRef.current && record.user_id === userUidRef.current;
          const matchesCanonical = userIdsEqual(record.canonical_user_id, canonicalUserId);
          const matchesWallet = userIdsEqual(record.wallet_address, userId);
          const matchesBaseWallet = userIdsEqual(record.base_wallet_address, userId);

          if (matchesUserId || matchesCanonical || matchesWallet || matchesBaseWallet) {
            console.log('[RealTimeBalance] wallet_balances update detected:', payload.eventType);
            fetchBalance();
          }
        }
      )
      // Listen for balance_ledger inserts (captures both credits AND debits)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'balance_ledger',
        },
        (payload) => {
          // Filter by user_id matching userUidRef or wallet address
          const record = payload.new as {
            user_id?: string;
            wallet_address?: string;
            amount?: number;
            source?: string;
          };

          // Check if this ledger entry is for the current user
          // user_id in balance_ledger is the uid from canonical_users
          // Also check wallet_address as a fallback
          const matchesUid = userUidRef.current && record.user_id === userUidRef.current;
          const matchesWallet = userIdsEqual(record.wallet_address, userId);

          if (matchesUid || matchesWallet) {
            console.log('[RealTimeBalance] Balance ledger entry detected:', record.source, record.amount);
            fetchBalance();
          }
        }
      )
      // Listen for transaction changes that might affect balance
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_transactions',
        },
        (payload) => {
          // Filter in callback for case-insensitive matching using userIdsEqual
          const record = payload.new as {
            user_id?: string;
            wallet_address?: string;
            status?: string;
            competition_id?: string;
          };

          // Check if this transaction is for the current user
          const matchesUserId = userIdsEqual(record.user_id, userId);
          const matchesWallet = userIdsEqual(record.wallet_address, userId);

          if (matchesUserId || matchesWallet) {
            const statusLower = (record.status || '').toLowerCase().trim();
            const isTopUp = !record.competition_id; // Top-ups don't have competition_id
            
            // Refresh on:
            // 1. Completed transactions (all types)
            // 2. New pending top-up transactions (for immediate UI feedback)
            const isCompleted = statusLower === 'finished' || statusLower === 'completed' || statusLower === 'confirmed' || statusLower === 'success' || statusLower === 'paid';
            const isPendingTopUp = (statusLower === 'pending' || statusLower === 'pending_payment' || statusLower === 'waiting' || statusLower === 'processing') && isTopUp && payload.eventType === 'INSERT';
            
            if (isCompleted) {
              console.log('[RealTimeBalance] Transaction completed, refreshing balance');
              fetchBalance();
            } else if (isPendingTopUp) {
              console.log('[RealTimeBalance] New pending top-up transaction created, refreshing for UI update');
              fetchBalance();
            }
          }
        }
      )
      // Listen for ticket purchases (balance deductions)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'v_joincompetition_active',
        },
        (payload) => {
          // Filter in callback for case-insensitive matching using userIdsEqual
          const record = payload.new as {
            walletaddress?: string;
            userid?: string;
          };

          // Check if this entry is for the current user
          // Check walletaddress and userid as the view uses canonical identifiers
          const matchesWallet = userIdsEqual(record.walletaddress, userId);
          const matchesUserId = userIdsEqual(record.userid, userId);

          if (matchesWallet || matchesUserId) {
            console.log('[RealTimeBalance] New entry, refreshing balance');
            fetchBalance();
          }
        }
      )
      .subscribe((status) => {
        // Log subscription status for debugging
        if (status === 'CHANNEL_ERROR') {
          console.warn('[RealTimeBalance] Subscription error, will use polling fallback');
        } else if (status === 'SUBSCRIBED') {
          console.log('[RealTimeBalance] Subscription active');
        }
      });

    // Subscribe to the private broadcast channel for wallet_balance_changed events
    // This is used by the realtime-balance-broadcaster Edge Function for instant updates
    // Channel format: user:{canonical_user_id}:wallet
    const walletBroadcastChannel = supabase
      .channel(`user:${canonicalUserId}:wallet`)
      .on('broadcast', { event: 'wallet_balance_changed' }, (payload) => {
        console.log('[RealTimeBalance] wallet_balance_changed broadcast received:', payload);
        const newBalance = payload.payload?.new_balance;
        if (newBalance !== undefined && newBalance !== null) {
          console.log('[RealTimeBalance] Updating balance from broadcast:', newBalance);
          setBalance(Number(newBalance));
          setLastUpdate(new Date());
          // Set cooldown to prevent DB reads from overwriting the broadcast value
          lastEventUpdateRef.current = Date.now();
        } else {
          // If payload doesn't include new_balance, fetch from DB
          fetchBalance();
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[RealTimeBalance] Wallet broadcast channel subscribed');
        } else if (status === 'CHANNEL_ERROR') {
          console.warn('[RealTimeBalance] Wallet broadcast channel error');
        }
      });

    // Fallback: Poll for balance updates every 30 seconds in case real-time events are missed
    // This ensures balance stays in sync even if Supabase real-time is unreliable
    const pollingInterval = setInterval(() => {
      fetchBalance();
    }, 30000);

    // Listen for balance-updated events from PaymentModal
    // This provides immediate balance updates without waiting for DB replication
    const handleBalanceUpdated = (event: CustomEvent<{ newBalance?: number }>) => {
      if (event.detail?.newBalance !== undefined && event.detail.newBalance !== null) {
        console.log('[RealTimeBalance] Immediate balance update from event:', event.detail.newBalance);
        setBalance(event.detail.newBalance);
        setLastUpdate(new Date());
        // Set the cooldown timestamp to prevent DB queries from overwriting this value
        // The DB may have replication lag, so we need to wait before trusting DB reads
        lastEventUpdateRef.current = Date.now();
      }
    };

    window.addEventListener('balance-updated', handleBalanceUpdated as EventListener);

    return () => {
      clearInterval(pollingInterval);
      supabase.removeChannel(channel);
      supabase.removeChannel(walletBroadcastChannel);
      window.removeEventListener('balance-updated', handleBalanceUpdated as EventListener);
    };
  }, [userId, fetchBalance]);

  // Create a user-initiated refresh function that bypasses cooldown
  // When the user explicitly clicks refresh, they expect a DB fetch
  const userInitiatedRefresh = useCallback(async () => {
    return fetchBalance({ bypassCooldown: true });
  }, [fetchBalance]);

  return {
    balance,
    bonusBalance,
    totalBalance: balance + bonusBalance,
    pendingBalance,
    hasUsedBonus,
    isLoading,
    error,
    lastUpdate,
    refresh: userInitiatedRefresh,
  };
}

/**
 * Hook for real-time notifications for winners
 */
export function useWinnerNotifications(onWin?: (prize: any) => void) {
  const { baseUser } = useAuthUser();
  const [wins, setWins] = useState<any[]>([]);
  const [hasNewWin, setHasNewWin] = useState(false);

  const userId = baseUser?.id;

  useEffect(() => {
    if (!userId) return;

    // Convert to canonical format for channel naming and comparison
    const canonicalUserId = toPrizePid(userId);

    // Subscribe to instant win prizes for this user
    const channel = supabase
      .channel(`winner-notifications-${canonicalUserId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'Prize_Instantprizes',
        },
        async (payload) => {
          const newData = payload.new as { winningWalletAddress?: string; prize?: string; competitionId?: string };

          // Check if this user won using userIdsEqual for case-insensitive comparison
          if (userIdsEqual(newData?.winningWalletAddress, userId)) {
            console.log('[WinnerNotifications] You won!', newData);

            const winData = {
              prize: newData.prize,
              competitionId: newData.competitionId,
              timestamp: new Date(),
            };

            setWins(prev => [...prev, winData]);
            setHasNewWin(true);

            if (onWin) {
              onWin(winData);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, onWin]);

  const clearNewWin = () => setHasNewWin(false);

  return {
    wins,
    hasNewWin,
    clearNewWin,
  };
}

export default useRealTimeBalance;
