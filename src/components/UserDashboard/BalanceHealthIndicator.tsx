import { AlertTriangle } from 'lucide-react';
import { useBalanceHealthCheck } from '../../hooks/useBalanceHealthCheck';
import { useAuthUser } from '../../contexts/AuthContext';

/**
 * Component that displays balance synchronization health status.
 * Shows when there's a discrepancy between canonical_users and sub_account_balances tables.
 */
export function BalanceHealthIndicator() {
  const { baseUser } = useAuthUser();
  const { status, discrepancy, checkNow } = useBalanceHealthCheck(baseUser?.id || null);

  // Don't show anything if healthy
  if (status === 'healthy' || status === 'checking') {
    return null;
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs sequel-45 bg-red-500/10 border border-red-500/30 text-red-400">
      <AlertTriangle size={14} />
      <span>Balance discrepancy detected</span>
      {discrepancy !== null && discrepancy > 0.01 && (
        <span className="text-red-300/80">(±${discrepancy.toFixed(2)})</span>
      )}
      <button
        onClick={checkNow}
        className="ml-auto text-red-300 hover:text-red-200 underline"
      >
        Recheck
      </button>
    </div>
  );
}

export default BalanceHealthIndicator;
