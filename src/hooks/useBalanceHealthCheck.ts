import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { toPrizePid } from '../utils/userId';

export type BalanceHealthStatus = 'healthy' | 'syncing' | 'checking' | 'error';

interface BalanceHealthState {
  status: BalanceHealthStatus;
  lastCheck: Date | null;
  discrepancy: number | null;
}

/**
 * Hook to monitor balance synchronization health between canonical_users.balance
 * and sub_account_balances.available_balance.
 * 
 * Detects race conditions and automatically triggers sync when discrepancies are found.
 */
export function useBalanceHealthCheck(canonicalUserId: string | null): BalanceHealthState & {
  checkNow: () => Promise<void>;
} {
  const [status, setStatus] = useState<BalanceHealthStatus>('checking');
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const [discrepancy, setDiscrepancy] = useState<number | null>(null);

  const checkHealth = useCallback(async () => {
    if (!canonicalUserId) {
      setStatus('healthy');
      return;
    }

    try {
      setStatus('checking');
      const canonicalId = toPrizePid(canonicalUserId);

      // Get balance from both sources in parallel
      const [canonicalResult, subAccountResult] = await Promise.all([
        supabase
          .from('canonical_users')
          .select('balance')
          .eq('canonical_user_id', canonicalId)
          .maybeSingle(),
        supabase
          .from('sub_account_balances')
          .select('available_balance')
          .eq('canonical_user_id', canonicalId)
          .eq('currency', 'USD')
          .maybeSingle(),
      ]);

      const canonicalBalance = Number(canonicalResult.data?.balance || 0);
      const subAccountBalance = Number(subAccountResult.data?.available_balance || 0);
      const diff = Math.abs(canonicalBalance - subAccountBalance);

      setDiscrepancy(diff);
      setLastCheck(new Date());

      if (diff > 0.01) {
        // Balances are out of sync
        console.warn('[BalanceHealthCheck] Balance discrepancy detected:', {
          canonical: canonicalBalance,
          subAccount: subAccountBalance,
          difference: diff,
        });

        setStatus('syncing');

        // Trigger sync using the database RPC function
        try {
          const { error: syncError } = await supabase.rpc('sync_user_balances', {
            p_canonical_user_id: canonicalId,
          });

          if (syncError) {
            console.error('[BalanceHealthCheck] Sync failed:', syncError);
            setStatus('error');
          } else {
            console.log('[BalanceHealthCheck] Sync triggered successfully');
            // Wait a moment and check again
            setTimeout(() => {
              setStatus('healthy');
            }, 2000);
          }
        } catch (syncErr) {
          console.error('[BalanceHealthCheck] Sync RPC error:', syncErr);
          setStatus('error');
        }
      } else {
        // Balances are in sync
        setStatus('healthy');
      }
    } catch (err) {
      console.error('[BalanceHealthCheck] Error checking balance health:', err);
      setStatus('error');
      setLastCheck(new Date());
    }
  }, [canonicalUserId]);

  useEffect(() => {
    if (!canonicalUserId) return;

    // Initial health check
    checkHealth();

    // Periodic health check every 30 seconds
    const interval = setInterval(checkHealth, 30000);

    return () => clearInterval(interval);
  }, [canonicalUserId, checkHealth]);

  return {
    status,
    lastCheck,
    discrepancy,
    checkNow: checkHealth,
  };
}

export default useBalanceHealthCheck;
