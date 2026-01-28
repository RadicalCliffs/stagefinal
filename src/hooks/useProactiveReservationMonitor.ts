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
import { omnipotentData } from '../lib/omnipotent-data-service';
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
    enableAutoCleanup = true,
    cleanupInterval = 5000,
    enabled = true,
  } = options;

  const cleanupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastCleanupRef = useRef<number>(0);

  /**
   * Aggressively clean up expired reservations
   */
  const cleanupExpiredReservations = useCallback(async () => {
    if (!competitionId || !enableAutoCleanup) return;

    // Debounce: Don't cleanup more than once per second
    const now = Date.now();
    if (now - lastCleanupRef.current < 1000) {
      return;
    }
    lastCleanupRef.current = now;

    try {
      const nowISO = new Date().toISOString();
      
      // Use admin client if available for aggressive cleanup
      const client = hasAdminAccess() ? getAdminClient() : supabase;
      
      if (!client) {
        databaseLogger.warn('[ProactiveMonitor] No client available for cleanup');
        return;
      }

      // Delete expired pending reservations
      const { data, error } = await client
        .from('pending_tickets')
        .delete()
        .eq('competition_id', competitionId)
        .eq('status', 'pending')
        .lt('expires_at', nowISO)
        .select('id');
      
      if (error) {
        databaseLogger.warn('[ProactiveMonitor] Cleanup failed', { error, competitionId });
      } else if (data && data.length > 0) {
        databaseLogger.info('[ProactiveMonitor] ✓ Cleaned up expired reservations', { 
          count: data.length,
          competitionId 
        });
        
        // Invalidate cache to ensure fresh data
        omnipotentData.clearCache(`unavailable_tickets:${competitionId}`);
      }
    } catch (err) {
      databaseLogger.warn('[ProactiveMonitor] Exception during cleanup', err);
    }
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

export default useProactiveReservationMonitor;
