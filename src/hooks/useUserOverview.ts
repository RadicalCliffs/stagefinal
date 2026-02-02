/**
 * useUserOverview Hook
 *
 * React hook for fetching and managing user overview data from the user_overview view.
 * This provides a single source of truth for all dashboard data.
 */

import { useState, useEffect, useCallback } from 'react';
import { fetchUserOverview } from '../services/userOverviewService';
import type { UserOverview } from '../types/userOverview';

export interface UseUserOverviewOptions {
  autoFetch?: boolean;
  refreshInterval?: number;
  enabled?: boolean;
}

/**
 * Hook for fetching user overview data
 * 
 * @param canonicalUserId - The canonical user ID (format: "prize:pid:0x...")
 * @param options - Hook options (autoFetch, refreshInterval, enabled)
 * @returns User overview data, loading state, error, and refetch function
 * 
 * @example
 * const { overview, loading, error, refetch } = useUserOverview(canonicalUserId, {
 *   autoFetch: true,
 *   refreshInterval: 30000 // Refresh every 30 seconds
 * });
 * 
 * // Access data
 * const entries = overview?.entries_json || [];
 * const usdcBalance = overview?.balances_json.USDC?.available || 0;
 */
export function useUserOverview(
  canonicalUserId: string | undefined | null,
  options: UseUserOverviewOptions = {}
) {
  const [overview, setOverview] = useState<UserOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { autoFetch = true, refreshInterval, enabled = true } = options;

  const fetchData = useCallback(async (isRefresh = false) => {
    if (!canonicalUserId || !enabled) {
      setLoading(false);
      return;
    }

    try {
      // Only show loading on initial fetch, use refreshing for subsequent fetches
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      const data = await fetchUserOverview(canonicalUserId);
      setOverview(data);
    } catch (err) {
      setError(err as Error);
      console.error('[useUserOverview] Error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [canonicalUserId, enabled]);

  useEffect(() => {
    if (autoFetch && enabled) {
      fetchData(false); // Initial fetch
    }
  }, [autoFetch, enabled, fetchData]);

  // Set up refresh interval if specified
  useEffect(() => {
    if (refreshInterval && refreshInterval > 0 && canonicalUserId && enabled) {
      const interval = setInterval(() => fetchData(true), refreshInterval); // Refresh fetch
      return () => clearInterval(interval);
    }
  }, [refreshInterval, canonicalUserId, enabled, fetchData]);

  return {
    overview,
    loading,
    refreshing,
    error,
    refetch: () => fetchData(true), // Manual refetch should use refreshing state
    // Convenience getters
    entries: overview?.entries_json || [],
    tickets: overview?.tickets_json || [],
    transactions: overview?.transactions_json || [],
    balances: overview?.balances_json || {},
    ledger: overview?.ledger_json || [],
    counts: overview ? {
      entries: overview.entries_count,
      tickets: overview.tickets_count,
      transactions: overview.transactions_count,
      ledger: overview.ledger_count,
    } : {
      entries: 0,
      tickets: 0,
      transactions: 0,
      ledger: 0,
    },
    totals: overview ? {
      credits: overview.total_credits,
      debits: overview.total_debits,
    } : {
      credits: 0,
      debits: 0,
    },
  };
}

/**
 * Example usage in a component:
 * 
 * function Dashboard() {
 *   const { canonicalUserId } = useAuthUser();
 *   const { overview, loading, error, entries, balances, counts } = useUserOverview(canonicalUserId, {
 *     refreshInterval: 30000
 *   });
 * 
 *   if (loading) return <Loader />;
 *   if (error) return <ErrorMessage error={error} />;
 * 
 *   return (
 *     <div>
 *       <h1>My Entries ({counts.entries})</h1>
 *       {entries.map(entry => (
 *         <EntryCard key={entry.entry_id} entry={entry} />
 *       ))}
 *       
 *       <h2>Wallet Balance</h2>
 *       <p>USDC: ${balances.USDC?.available || 0}</p>
 *       <p>BONUS: ${balances.BONUS?.available || 0}</p>
 *     </div>
 *   );
 * }
 */
