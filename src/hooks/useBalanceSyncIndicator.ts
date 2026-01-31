import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface BalanceSyncIndicatorState {
  lastSync: Date;
  isOnline: boolean;
  isConnected: boolean;
}

/**
 * Hook for monitoring real-time balance sync status
 */
export function useBalanceSyncIndicator(userId: string | null): BalanceSyncIndicatorState {
  const [lastSync, setLastSync] = useState<Date>(new Date());
  const [isOnline, setIsOnline] = useState(true);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!userId) return;

    // Monitor browser online/offline status
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Subscribe to Supabase presence to monitor connection
    const channel = supabase.channel('balance-sync-status')
      .on('presence', { event: 'sync' }, () => {
        setLastSync(new Date());
        setIsConnected(true);
      })
      .on('presence', { event: 'join' }, () => {
        setIsConnected(true);
      })
      .on('presence', { event: 'leave' }, () => {
        setIsConnected(false);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setIsConnected(true);
          setLastSync(new Date());
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setIsConnected(false);
        }
      });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      supabase.removeChannel(channel);
    };
  }, [userId]);

  return {
    lastSync,
    isOnline,
    isConnected,
  };
}

export default useBalanceSyncIndicator;
