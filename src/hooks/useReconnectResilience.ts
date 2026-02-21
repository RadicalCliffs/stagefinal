/**
 * Reconnect Resilience Manager
 * 
 * Handles websocket reconnection and ensures data consistency after reconnects.
 * Provides helpers for refetching data and reconciling state.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getChannelState } from '../lib/supabase-realtime';
import { parseBalanceResponse } from '../utils/balanceParser';

export type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'error';

interface ReconnectHandlers {
  onReconnect?: () => void | Promise<void>;
  onDisconnect?: () => void;
  onError?: (error: any) => void;
}

/**
 * Hook for monitoring websocket connection state
 */
export function useConnectionState(handlers?: ReconnectHandlers) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [reconnecting, setReconnecting] = useState(false);
  const [lastReconnect, setLastReconnect] = useState<Date | null>(null);

  useEffect(() => {
    let reconnectTimer: NodeJS.Timeout | null = null;

    // Monitor connection by checking channel status
    const checkConnection = () => {
      // In a real implementation, this would check the actual WebSocket state
      // For now, we assume connected if we haven't seen errors
      const hasActiveChannels = Array.from(supabase.getChannels()).some(
        (channel) => channel.state === 'joined'
      );

      if (hasActiveChannels) {
        if (connectionState !== 'connected') {
          setConnectionState('connected');
          setReconnecting(false);
          console.log('[ReconnectResilience] Connection established');
        }
      } else if (connectionState === 'connected') {
        setConnectionState('connecting');
        console.log('[ReconnectResilience] Connection lost, attempting to reconnect');
      }
    };

    // Check connection every 5 seconds
    const interval = setInterval(checkConnection, 5000);

    // Initial check
    checkConnection();

    return () => {
      clearInterval(interval);
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [connectionState]);

  // Handle reconnect
  const handleReconnect = useCallback(async () => {
    if (reconnecting) return;

    try {
      setReconnecting(true);
      setConnectionState('connecting');
      console.log('[ReconnectResilience] Reconnecting...');

      // Give the connection a moment to stabilize
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Call user handler
      if (handlers?.onReconnect) {
        await handlers.onReconnect();
      }

      setConnectionState('connected');
      setLastReconnect(new Date());
      console.log('[ReconnectResilience] Reconnected successfully');
    } catch (error) {
      console.error('[ReconnectResilience] Reconnect failed:', error);
      setConnectionState('error');
      handlers?.onError?.(error);
    } finally {
      setReconnecting(false);
    }
  }, [reconnecting, handlers]);

  // Trigger reconnect when disconnected
  useEffect(() => {
    if (connectionState === 'disconnected' && !reconnecting) {
      handleReconnect();
    }
  }, [connectionState, reconnecting, handleReconnect]);

  return {
    connectionState,
    reconnecting,
    lastReconnect,
    triggerReconnect: handleReconnect,
  };
}

/**
 * Hook for managing data refetch after reconnect
 */
export function useReconnectRefetch(
  channelNames: string[],
  refetchFn: () => Promise<void> | void
) {
  const [refetching, setRefetching] = useState(false);

  const { connectionState, lastReconnect } = useConnectionState({
    onReconnect: async () => {
      // Wait for channels to be ready
      await waitForChannels(channelNames);

      // Refetch data
      setRefetching(true);
      try {
        await refetchFn();
        console.log('[ReconnectResilience] Data refetched after reconnect');
      } catch (error) {
        console.error('[ReconnectResilience] Failed to refetch data:', error);
      } finally {
        setRefetching(false);
      }
    },
  });

  return {
    connectionState,
    refetching,
    lastReconnect,
  };
}

/**
 * Wait for specific channels to be in SUBSCRIBED state
 */
async function waitForChannels(
  channelNames: string[],
  timeoutMs: number = 10000
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const allReady = channelNames.every((name) => getChannelState(name) === 'SUBSCRIBED');

    if (allReady) {
      console.log('[ReconnectResilience] All channels ready:', channelNames);
      return;
    }

    // Wait a bit before checking again
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  console.warn('[ReconnectResilience] Timeout waiting for channels:', channelNames);
}

/**
 * Helper to reconcile balance after reconnect
 */
export async function reconcileBalance(
  userId: string,
  lastKnownBalance: number | null
): Promise<{ balance: number; changed: boolean }> {
  try {
    // Fetch latest balance from server
    const { data, error }: any = await (supabase.rpc as any)('get_user_balance', {
      p_canonical_user_id: userId,
    });

    if (error) throw error;

    // get_user_balance returns JSONB object: { success, balance, bonus_balance, total_balance }
    const balanceData = parseBalanceResponse(data);
    const currentBalance = balanceData.balance!;
    const changed = lastKnownBalance !== null && currentBalance !== lastKnownBalance;

    if (changed) {
      console.log(
        '[ReconnectResilience] Balance changed during disconnect:',
        lastKnownBalance,
        '->',
        currentBalance
      );
    }

    return { balance: currentBalance, changed };
  } catch (error) {
    console.error('[ReconnectResilience] Failed to reconcile balance:', error);
    throw error;
  }
}

/**
 * Helper to verify reservation after reconnect
 */
export async function verifyReservation(
  reservationId: string
): Promise<{ valid: boolean; status: string | null; expired: boolean }> {
  try {
    const { data, error }: any = await supabase
      .from('pending_tickets')
      .select('status, expires_at')
      .eq('id', reservationId)
      .single() as any;

    if (error || !data) {
      console.log('[ReconnectResilience] Reservation not found:', reservationId);
      return { valid: false, status: null, expired: false };
    }

    const expired = new Date(data.expires_at) < new Date();
    const valid = data.status === 'pending' && !expired;

    console.log('[ReconnectResilience] Reservation verification:', {
      reservationId,
      status: data.status,
      expired,
      valid,
    });

    return { valid, status: data.status, expired };
  } catch (error) {
    console.error('[ReconnectResilience] Failed to verify reservation:', error);
    throw error;
  }
}
