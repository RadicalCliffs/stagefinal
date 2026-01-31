import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useBalanceHealthCheck } from '../../hooks/useBalanceHealthCheck';
import { useAuthUser } from '../../contexts/AuthContext';

/**
 * Component that displays balance synchronization health status.
 * Shows when balances are syncing or if there's a discrepancy between tables.
 */
export function BalanceHealthIndicator() {
  const { baseUser } = useAuthUser();
  const { status, discrepancy, checkNow } = useBalanceHealthCheck(baseUser?.id || null);

  // Don't show anything if healthy
  if (status === 'healthy' || status === 'checking') {
    return null;
  }

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs sequel-45 ${
      status === 'syncing' ? 'bg-blue-500/10 border border-blue-500/30 text-blue-400' :
      status === 'error' ? 'bg-red-500/10 border border-red-500/30 text-red-400' :
      'bg-gray-500/10 border border-gray-500/30 text-gray-400'
    }`}>
      {status === 'syncing' && (
        <>
          <RefreshCw size={14} className="animate-spin" />
          <span>Syncing balance...</span>
          {discrepancy !== null && discrepancy > 0.01 && (
            <span className="text-blue-300/80">(±${discrepancy.toFixed(2)})</span>
          )}
        </>
      )}
      {status === 'error' && (
        <>
          <AlertTriangle size={14} />
          <span>Balance sync issue detected</span>
          <button
            onClick={checkNow}
            className="ml-auto text-red-300 hover:text-red-200 underline"
          >
            Retry
          </button>
        </>
      )}
    </div>
  );
}

export default BalanceHealthIndicator;
