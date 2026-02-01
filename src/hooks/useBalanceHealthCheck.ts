import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { toPrizePid } from '../utils/userId';

export type BalanceHealthStatus = 'healthy' | 'checking' | 'error';

interface BalanceHealthState {
  status: BalanceHealthStatus;
  lastCheck: Date | null;
  discrepancy: number | null;
}

/**
 * Hook to monitor balance synchronization health between canonical_users.usdc_balance
 * and sub_account_balances.available_balance.
 * 
/*
Detects discrepancies and flags an error state for backend reconciliation.
Race conditions may occur; automatic sync is disabled.
Balance synchronization is handled via database triggers. /
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
// Mark as error; manual intervention or backend reconciliation required.
// Automatic sync is disabled (sync_user_balances does not exist).
// sync_all_user_balances affects ALL users and should only be run manually.
// Balance reconciliation occurs via database triggers on sub_account_balances changes.
// Back off polling to reduce pressure during discrepancy states.
setStatus('error');
setCheckInterval(60000); // 60s backoff when discrepancy detected
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

    // Periodic health check every 60 seconds
    const interval = setInterval(checkHealth, 60000);

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
