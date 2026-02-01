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
 * Hook to monitor balance synchronization health between canonical_users.usdc_balance
 * and sub_account_balances.available_balance.
 * 
 * Detects race conditions when discrepancies are found.
 * Note: Automatic sync is disabled. Balance sync happens via database triggers.
 */
export function useBalanceHealthCheck(canonicalUserId: string | null): BalanceHealthState & {
  checkNow: () => Promise<void>;
} {
  const [status, setStatus] = useState<BalanceHealthStatus>('checking');
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const [discrepancy, setDiscrepancy] = useState<number | null>(null);
  const [checkInterval, setCheckInterval] = useState<number>(30000); // Start with 30s

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
          .select('usdc_balance')
          .eq('canonical_user_id', canonicalId)
          .maybeSingle<{ usdc_balance: number }>(),
        supabase
          .from('sub_account_balances')
          .select('available_balance')
          .eq('canonical_user_id', canonicalId)
          .eq('currency', 'USD')
          .maybeSingle<{ available_balance: number }>(),
      ]);

      if (canonicalResult.error) {
        console.error('[BalanceHealthCheck] Error fetching canonical balance:', canonicalResult.error);
        setStatus('error');
        setLastCheck(new Date());
        return;
      }

      if (subAccountResult.error) {
        console.error('[BalanceHealthCheck] Error fetching sub-account balance:', subAccountResult.error);
        setStatus('error');
        setLastCheck(new Date());
        return;
      }

      const canonicalBalance = Number(canonicalResult.data?.usdc_balance || 0);
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

        setStatus('error');
        setCheckInterval(60000); // Back off to 60s when discrepancy detected
        
        // Note: Automatic sync is disabled because sync_user_balances function doesn't exist.
        // The sync_all_user_balances function syncs ALL users and should only be run manually.
        // Balance sync happens automatically via database triggers when sub_account_balances changes.
      } else {
        // Balances are in sync
        setStatus('healthy');
        setCheckInterval(60000); // Reduce frequency when healthy (60s)
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

    // Periodic health check with dynamic interval
    const interval = setInterval(checkHealth, checkInterval);

    return () => clearInterval(interval);
  }, [canonicalUserId, checkHealth, checkInterval]);

  return {
    status,
    lastCheck,
    discrepancy,
    checkNow: checkHealth,
  };
}

export default useBalanceHealthCheck;
