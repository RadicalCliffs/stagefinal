// Data fetching utilities and hooks for enhanced dashboard with instant win support
// Integrates with the fixed get_comprehensive_user_dashboard_entries RPC function

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';

// Types matching the RPC function return
export interface DashboardEntry {
  id: string;
  competition_id: string;
  title: string;
  description: string;
  image: string;
  status: 'live' | 'drawn' | 'cancelled' | 'pending';
  entry_type: 'completed' | 'completed_transaction' | 'pending';
  expires_at: string | null;
  is_winner: boolean;
  ticket_numbers: string | null;
  number_of_tickets: number;
  amount_spent: number;
  purchase_date: string;
  wallet_address: string | null;
  transaction_hash: string | null;
  is_instant_win: boolean;
  prize_value: number | null;
  competition_status: string;
  end_date: string | null;
}

// Supabase client setup
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// RPC function to fetch user entries
export const fetchUserEntries = async (userIdentifier: string): Promise<DashboardEntry[]> => {
  try {
    const { data, error } = await supabase.rpc('get_comprehensive_user_dashboard_entries', {
      user_identifier: userIdentifier
    });

    if (error) {
      console.error('RPC Error:', error);
      throw new Error(`Failed to fetch entries: ${error.message}`);
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching user entries:', error);
    throw error;
  }
};

// Hook for fetching user entries with error handling and loading states
export const useUserEntries = (userIdentifier: string | null) => {
  const [entries, setEntries] = useState<DashboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const fetchEntries = useCallback(async () => {
    if (!userIdentifier) {
      setEntries([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      const data = await fetchUserEntries(userIdentifier);
      setEntries(data);
      setLastFetch(new Date());
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch entries';
      setError(errorMessage);
      console.error('Failed to fetch user entries:', err);
    } finally {
      setLoading(false);
    }
  }, [userIdentifier]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!userIdentifier) return;

    const interval = setInterval(() => {
      fetchEntries();
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchEntries, userIdentifier]);

  // Manual refresh function
  const refresh = useCallback(() => {
    fetchEntries();
  }, [fetchEntries]);

  return {
    entries,
    loading,
    error,
    lastFetch,
    refresh,
    refetch: fetchEntries
  };
};

// Enhanced hook with filtering and sorting
export const useEnhancedDashboard = (userIdentifier: string | null) => {
  const [activeTab, setActiveTab] = useState<'all' | 'instant' | 'regular' | 'pending'>('all');
  const [sortBy, setSortBy] = useState<'date' | 'amount' | 'tickets'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const { entries, loading, error, lastFetch, refresh, refetch } = useUserEntries(userIdentifier);

  // Filter entries based on active tab
  const filteredEntries = React.useMemo(() => {
    let filtered = entries;

    switch (activeTab) {
      case 'instant':
        filtered = entries.filter(entry => entry.is_instant_win);
        break;
      case 'regular':
        filtered = entries.filter(entry => !entry.is_instant_win && entry.entry_type !== 'pending');
        break;
      case 'pending':
        filtered = entries.filter(entry => entry.entry_type === 'pending');
        break;
      default:
        filtered = entries;
    }

    // Sort entries
    return filtered.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'date':
          comparison = new Date(a.purchase_date).getTime() - new Date(b.purchase_date).getTime();
          break;
        case 'amount':
          comparison = a.amount_spent - b.amount_spent;
          break;
        case 'tickets':
          comparison = a.number_of_tickets - b.number_of_tickets;
          break;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [entries, activeTab, sortBy, sortOrder]);

  // Calculate counts for each tab
  const counts = React.useMemo(() => {
    return {
      all: entries.length,
      instant: entries.filter(entry => entry.is_instant_win).length,
      regular: entries.filter(entry => !entry.is_instant_win && entry.entry_type !== 'pending').length,
      pending: entries.filter(entry => entry.entry_type === 'pending').length,
    };
  }, [entries]);

  // Get recent entries (last 24 hours)
  const recentEntries = React.useMemo(() => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    return entries.filter(entry => 
      new Date(entry.purchase_date) > yesterday
    );
  }, [entries]);

  // Get instant win statistics
  const instantWinStats = React.useMemo(() => {
    const instantEntries = entries.filter(entry => entry.is_instant_win);
    
    return {
      totalEntries: instantEntries.length,
      totalSpent: instantEntries.reduce((sum, entry) => sum + entry.amount_spent, 0),
      totalTickets: instantEntries.reduce((sum, entry) => sum + entry.number_of_tickets, 0),
      avgSpentPerEntry: instantEntries.length > 0 
        ? instantEntries.reduce((sum, entry) => sum + entry.amount_spent, 0) / instantEntries.length
        : 0,
    };
  }, [entries]);

  return {
    // Data
    entries: filteredEntries,
    allEntries: entries,
    recentEntries,
    instantWinStats,
    
    // State
    loading,
    error,
    lastFetch,
    activeTab,
    sortBy,
    sortOrder,
    counts,
    
    // Actions
    setActiveTab,
    setSortBy,
    setSortOrder,
    refresh,
    refetch,
  };
};

// Fallback hook for when RPC fails (legacy support)
export const useFallbackUserEntries = (userIdentifier: string | null) => {
  const [entries, setEntries] = useState<DashboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFallbackEntries = useCallback(async () => {
    if (!userIdentifier) {
      setEntries([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Fallback to direct table queries
      // Note: Using v_joincompetition_active view for stable read interface
      // Supabase client library handles parameter escaping to prevent SQL injection
      const [joinCompResult, transactionsResult, pendingResult] = await Promise.all([
        supabase.from('v_joincompetition_active').select('*').or(`userid.eq.${userIdentifier},walletaddress.ilike.${userIdentifier.toLowerCase()}`),
        supabase.from('user_transactions').select('*, competitions(*)').or(`canonical_user_id.eq.${userIdentifier},user_privy_id.eq.${userIdentifier},user_id.eq.${userIdentifier},wallet_address.ilike.${userIdentifier.toLowerCase()}`),
        supabase.from('pending_tickets').select('*, competitions(*)').eq('user_id', userIdentifier).eq('status', 'pending')
      ]);

      const transformedEntries: DashboardEntry[] = [];

      // Transform v_joincompetition_active entries
      if (joinCompResult.data) {
        joinCompResult.data.forEach(item => {
          // Case-insensitive status comparison
          const compStatus = (item.competitions?.status || '').toLowerCase().trim();
          transformedEntries.push({
            id: item.id,
            competition_id: item.competitionid,
            title: item.competitions?.title || 'Unknown Competition',
            description: item.competitions?.description || '',
            image: item.competitions?.image_url || '',
            status: compStatus === 'active' ? 'live' : 'drawn',
            entry_type: 'completed',
            expires_at: null,
            is_winner: false,
            ticket_numbers: item.ticketnumbers,
            number_of_tickets: item.numberoftickets || 1,
            amount_spent: item.amountspent || 0,
            purchase_date: item.purchasedate || item.created_at,
            wallet_address: item.walletaddress,
            transaction_hash: item.transactionhash,
            is_instant_win: item.competitions?.is_instant_win || false,
            prize_value: item.competitions?.prize_value,
            competition_status: item.competitions?.status || '',
            end_date: item.competitions?.end_date,
          });
        });
      }

      // Transform transaction entries
      if (transactionsResult.data) {
        transactionsResult.data.forEach(item => {
          // Case-insensitive status comparison
          const compStatus = (item.competitions?.status || '').toLowerCase().trim();
          transformedEntries.push({
            id: item.id,
            competition_id: item.competition_id,
            title: item.competitions?.title || 'Unknown Competition',
            description: item.competitions?.description || '',
            image: item.competitions?.image_url || '',
            status: compStatus === 'active' ? 'live' : 'drawn',
            entry_type: 'completed_transaction',
            expires_at: null,
            is_winner: false,
            ticket_numbers: null,
            number_of_tickets: item.ticket_count || 1,
            amount_spent: item.amount || 0,
            purchase_date: item.created_at,
            wallet_address: item.wallet_address,
            transaction_hash: item.tx_id,
            is_instant_win: item.competitions?.is_instant_win || false,
            prize_value: item.competitions?.prize_value,
            competition_status: item.competitions?.status || '',
            end_date: item.competitions?.end_date,
          });
        });
      }

      // Transform pending tickets
      if (pendingResult.data) {
        pendingResult.data.forEach(item => {
          transformedEntries.push({
            id: item.id,
            competition_id: item.competition_id,
            title: item.competitions?.title || 'Unknown Competition',
            description: item.competitions?.description || '',
            image: item.competitions?.image_url || '',
            status: 'pending',
            entry_type: 'pending',
            expires_at: item.expires_at,
            is_winner: false,
            ticket_numbers: item.ticket_numbers?.join(',') || '',
            number_of_tickets: item.ticket_count || 0,
            amount_spent: item.total_amount || 0,
            purchase_date: item.created_at,
            wallet_address: null,
            transaction_hash: item.transaction_hash,
            is_instant_win: item.competitions?.is_instant_win || false,
            prize_value: item.competitions?.prize_value,
            competition_status: item.competitions?.status || '',
            end_date: item.competitions?.end_date,
          });
        });
      }

      setEntries(transformedEntries);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch entries';
      setError(errorMessage);
      console.error('Failed to fetch fallback entries:', err);
    } finally {
      setLoading(false);
    }
  }, [userIdentifier]);

  useEffect(() => {
    fetchFallbackEntries();
  }, [fetchFallbackEntries]);

  return {
    entries,
    loading,
    error,
    refresh: fetchFallbackEntries
  };
};

// Combined hook with automatic fallback
export const useDashboardWithFallback = (userIdentifier: string | null) => {
  const [useFallback, setUseFallback] = useState(false);
  const { entries, loading, error, refresh } = useEnhancedDashboard(useFallback ? null : userIdentifier);
  const fallbackData = useFallbackUserEntries(useFallback ? userIdentifier : null);

  useEffect(() => {
    if (error && !useFallback) {
      console.log('RPC failed, switching to fallback...');
      setUseFallback(true);
    }
  }, [error, useFallback]);

  const finalEntries = useFallback ? fallbackData.entries : entries;
  const finalLoading = useFallback ? fallbackData.loading : loading;
  const finalError = useFallback ? fallbackData.error : error;

  return {
    entries: finalEntries,
    loading: finalLoading,
    error: finalError,
    usingFallback: useFallback,
    refresh
  };
};

export default {
  fetchUserEntries,
  useUserEntries,
  useEnhancedDashboard,
  useDashboardWithFallback,
  useFallbackUserEntries
};