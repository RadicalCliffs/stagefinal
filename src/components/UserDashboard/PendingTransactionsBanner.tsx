import { Clock } from 'lucide-react';
import { useRealTimeBalance } from '../../hooks/useRealTimeBalance';

interface PendingTransactionsBannerProps {
  userId: string;
}

/**
 * Displays a banner showing pending top-up transactions that are awaiting blockchain confirmation.
 * Shows the number of pending transactions and provides links to view them on BaseScan.
 */
export function PendingTransactionsBanner({ userId: _userId }: PendingTransactionsBannerProps) {
  const { pendingTopUps } = useRealTimeBalance();

  if (pendingTopUps.length === 0) return null;

  const totalPendingAmount = pendingTopUps.reduce((sum, tx) => sum + tx.amount, 0);
  const isMainnet = import.meta.env.VITE_BASE_MAINNET === 'true';
  const explorerDomain = isMainnet ? 'basescan.org' : 'sepolia.basescan.org';

  return (
    <div className="mb-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-yellow-500 border-t-transparent"></div>
        </div>
        <div className="flex-1">
          <p className="text-yellow-400 sequel-75 text-sm uppercase">
            {pendingTopUps.length} Transaction{pendingTopUps.length > 1 ? 's' : ''} Pending
          </p>
          <p className="text-yellow-400/80 sequel-45 text-xs mt-1">
            ${totalPendingAmount.toFixed(2)} confirming on blockchain...
          </p>
        </div>
        <div className="text-yellow-400/60 sequel-45 text-xs flex items-center gap-1">
          <Clock size={12} />
          <span>~30 sec</span>
        </div>
      </div>
      
      {pendingTopUps.length <= 3 && pendingTopUps.map((tx, idx) => (
        <div key={tx.id} className="mt-3 pt-3 border-t border-yellow-500/20 flex items-center justify-between">
          <div className="text-yellow-400/90 sequel-45 text-xs">
            +${tx.amount.toFixed(2)} top-up
          </div>
          <div className="text-yellow-400/60 sequel-45 text-xs">
            Confirming...
          </div>
        </div>
      ))}
    </div>
  );
}

export default PendingTransactionsBanner;
