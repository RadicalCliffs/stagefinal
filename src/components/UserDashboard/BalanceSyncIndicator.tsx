import { useBalanceSyncIndicator } from '../../hooks/useBalanceSyncIndicator';
import { useAuthUser } from '../../contexts/AuthContext';

/**
 * Component that displays real-time balance sync status
 */
export function BalanceSyncIndicator() {
  const { baseUser } = useAuthUser();
  const { lastSync, isOnline, isConnected } = useBalanceSyncIndicator(baseUser?.id || null);

  const formatDistanceToNow = (date: Date): string => {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 10) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  // Only show if offline or disconnected
  if (isOnline && isConnected) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-gray-500/10 border border-gray-500/30 rounded-lg text-xs sequel-45">
      {isOnline && isConnected ? (
        <>
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
          <span className="text-green-400">Synced {formatDistanceToNow(lastSync)}</span>
        </>
      ) : (
        <>
          <span className="w-2 h-2 rounded-full bg-red-500"></span>
          <span className="text-red-400">Offline</span>
        </>
      )}
    </div>
  );
}

export default BalanceSyncIndicator;
