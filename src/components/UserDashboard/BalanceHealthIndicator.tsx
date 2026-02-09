import { useBalanceHealthCheck } from '../../hooks/useBalanceHealthCheck';
import { useAuthUser } from '../../contexts/AuthContext';
import { useEffect } from 'react';

/**
 * Component that monitors balance synchronization health status.
 * Logs discrepancies to console instead of displaying UI warnings.
 * This prevents user confusion from temporary sync delays.
 */
export function BalanceHealthIndicator() {
  const { baseUser } = useAuthUser();
  const { status, discrepancy } = useBalanceHealthCheck(baseUser?.id || null);

  // Log to console for debugging, but don't show UI
  useEffect(() => {
    if ((status as string) === 'discrepancy' && discrepancy !== null) {
      console.log('[BalanceHealth] Discrepancy detected:', {
        status,
        discrepancy: discrepancy.toFixed(2),
        userId: baseUser?.id,
        timestamp: new Date().toISOString()
      });
    } else if ((status as string) === 'healthy') {
      console.log('[BalanceHealth] Balance is healthy');
    }
  }, [status, discrepancy, baseUser?.id]);

  // No UI display - console logging only
  return null;
}

export default BalanceHealthIndicator;
