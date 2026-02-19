/**
 * Proactive Reservation Monitor Hook
 * 
 * This hook implements the "all powerful and watching eye" functionality
 * that monitors ticket reservations and automatically handles issues:
 * 
 * 1. Auto-cleanup of expired reservations
 * 2. Real-time monitoring of ticket availability
 * 3. Automatic retry on failures
 * 4. Silent recovery from transient errors
 * 5. Aggressive use of Supabase service-level access
 * 
 * The user should never see reservation failures - this hook handles
 * everything quietly and efficiently in the background.
 */

import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { databaseLogger } from '../lib/debug-console';
import { hasAdminAccess, getAdminClient } from '../lib/supabase-admin';

export interface ProactiveMonitorOptions {
  /** Competition ID to monitor */
  competitionId?: string;
  /** Enable aggressive cleanup of expired reservations */
  enableAutoCleanup?: boolean;
  /** Cleanup interval in milliseconds (default: 5000ms) */
  cleanupInterval?: number;
  /** Enable monitoring */
  enabled?: boolean;
}

/**
 * Hook for proactive monitoring and auto-recovery of ticket reservations
 */
export function useProactiveReservationMonitor(options: ProactiveMonitorOptions = {}) {
  const {
    competitionId,
    enableAutoCleanup = false, // Changed default to false - cleanup is handled by RPC, no need for client polling
    cleanupInterval = 30000, // Increased from 5000ms to 30000ms if ever re-enabled
    enabled = true,
  } = options;

  const cleanupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastCleanupRef = useRef<number>(0);

  /**
   * DEPRECATED: Client-side cleanup is no longer needed.
   * The reserve_lucky_dip RPC handles expiry atomically within the database transaction.
   * This function is now a no-op to maintain backward compatibility.
   */
  const cleanupExpiredReservations = useCallback(async () => {
    if (!competitionId || !enableAutoCleanup) return;

    // Debounce: Don't cleanup more than once per second
    const now = Date.now();
    if (now - lastCleanupRef.current < 1000) {
      return;
    }
    lastCleanupRef.current = now;

    // NOTE: Client-side DELETE operations have been removed.
    // The reserve_lucky_dip RPC now handles expiry atomically to prevent race conditions.
    databaseLogger.info('[ProactiveMonitor] Cleanup is now handled by reserve_lucky_dip RPC', { 
      competitionId 
    });
  }, [competitionId, enableAutoCleanup]);

  /**
   * Start proactive monitoring
   */
  useEffect(() => {
    if (!enabled || !competitionId || !enableAutoCleanup) {
      // Clear any existing timer
      if (cleanupTimerRef.current) {
        clearInterval(cleanupTimerRef.current);
        cleanupTimerRef.current = null;
      }
      return;
    }

    databaseLogger.info('[ProactiveMonitor] Starting proactive monitoring', {
      competitionId,
      cleanupInterval,
      hasAdminAccess: hasAdminAccess()
    });

    // Run initial cleanup immediately
    cleanupExpiredReservations();

    // Set up periodic cleanup
    cleanupTimerRef.current = setInterval(() => {
      cleanupExpiredReservations();
    }, cleanupInterval);

    // Cleanup on unmount
    return () => {
      if (cleanupTimerRef.current) {
        clearInterval(cleanupTimerRef.current);
        cleanupTimerRef.current = null;
      }
      databaseLogger.info('[ProactiveMonitor] Stopped proactive monitoring', { competitionId });
    };
  }, [enabled, competitionId, enableAutoCleanup, cleanupInterval, cleanupExpiredReservations]);

  /**
   * Manual trigger for cleanup (exposed for emergency use)
   */
  const triggerCleanup = useCallback(async () => {
    await cleanupExpiredReservations();
  }, [cleanupExpiredReservations]);

  return {
    triggerCleanup,
    isMonitoring: enabled && !!competitionId && enableAutoCleanup,
  };
}
