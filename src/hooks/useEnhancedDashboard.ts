/**
 * Enhanced Dashboard Hook for Instant Win Entries
 *
 * This hook is separated from instant-win-components.tsx to avoid React Fast Refresh issues.
 */

import { useState, useMemo } from 'react';

// Types for instant win entries
export interface InstantWinEntry {
  id: string;
  competition_id: string;
  title: string;
  description: string;
  image: string;
  status: 'live' | 'drawn' | 'cancelled' | 'pending';
  entry_type: 'completed' | 'completed_transaction' | 'pending';
  is_instant_win: boolean;
  number_of_tickets: number;
  amount_spent: number;
  purchase_date: string;
  competition_status: string;
}

export type EntryTabType = 'all' | 'instant' | 'regular' | 'pending';

export interface EntryCounts {
  all: number;
  instant: number;
  regular: number;
  pending: number;
}

export const useEnhancedDashboard = () => {
  const [entries, setEntries] = useState<InstantWinEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<EntryTabType>('all');

  // Filter entries based on active tab
  const filteredEntries = useMemo(() => {
    switch (activeTab) {
      case 'instant':
        return entries.filter(entry => entry.is_instant_win);
      case 'regular':
        return entries.filter(entry => !entry.is_instant_win && entry.entry_type !== 'pending');
      case 'pending':
        return entries.filter(entry => entry.entry_type === 'pending');
      default:
        return entries;
    }
  }, [entries, activeTab]);

  // Calculate counts for each tab
  const counts = useMemo<EntryCounts>(() => {
    return {
      all: entries.length,
      instant: entries.filter(entry => entry.is_instant_win).length,
      regular: entries.filter(entry => !entry.is_instant_win && entry.entry_type !== 'pending').length,
      pending: entries.filter(entry => entry.entry_type === 'pending').length,
    };
  }, [entries]);

  return {
    entries: filteredEntries,
    loading,
    error,
    activeTab,
    setActiveTab,
    counts,
    allEntries: entries,
    setEntries,
    setLoading,
    setError
  };
};
