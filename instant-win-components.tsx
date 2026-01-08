// Instant Win Competition Components for React Frontend
// Add these components to display instant win competitions properly

import React from 'react';
import { Zap, Clock, Gift, Star } from 'lucide-react';

// Re-export types and hook from the dedicated hooks file
// eslint-disable-next-line react-refresh/only-export-components
export { useEnhancedDashboard } from './src/hooks/useEnhancedDashboard';
export type { InstantWinEntry, EntryTabType, EntryCounts } from './src/hooks/useEnhancedDashboard';

// Import the type for local use
import type { InstantWinEntry } from './src/hooks/useEnhancedDashboard';

// Instant Win Badge Component
export const InstantWinBadge: React.FC<{ isInstantWin: boolean }> = ({ isInstantWin }) => {
  if (!isInstantWin) return null;
  
  return (
    <div className="flex items-center gap-1 mb-2">
      <Zap className="w-4 h-4 text-yellow-400" />
      <span className="text-xs font-medium text-yellow-400 bg-yellow-400/10 px-2 py-1 rounded-full">
        INSTANT WIN
      </span>
    </div>
  );
};

// Instant Win Entry Card Component
export const InstantWinEntryCard: React.FC<{ 
  entry: InstantWinEntry;
  className?: string;
}> = ({ entry, className = '' }) => {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusColor = (status: string, isInstantWin: boolean) => {
    if (isInstantWin) {
      switch (status) {
        case 'live': return 'text-green-400';
        case 'drawn': return 'text-purple-400';
        case 'pending': return 'text-yellow-400';
        default: return 'text-gray-400';
      }
    }
    // Regular competition status colors
    switch (status) {
      case 'live': return 'text-green-400';
      case 'drawn': return 'text-purple-400';
      case 'pending': return 'text-yellow-400';
      default: return 'text-gray-400';
    }
  };

  const getStatusIcon = (status: string, isInstantWin: boolean) => {
    if (isInstantWin) {
      switch (status) {
        case 'live': return <Gift className="w-4 h-4" />;
        case 'drawn': return <Star className="w-4 h-4" />;
        case 'pending': return <Clock className="w-4 h-4" />;
        default: return null;
      }
    }
    return null;
  };

  return (
    <div className={`bg-gray-900/50 border border-gray-800 rounded-lg p-4 hover:bg-gray-900/70 transition-colors ${className}`}>
      {/* Instant Win Badge */}
      <InstantWinBadge isInstantWin={entry.is_instant_win} />
      
      {/* Competition Image */}
      {entry.image && (
        <div className="w-full h-32 bg-gray-800 rounded-lg mb-3 overflow-hidden">
          <img 
            src={entry.image} 
            alt={entry.title}
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        </div>
      )}
      
      {/* Competition Title */}
      <h3 className="font-semibold text-white mb-2 truncate">
        {entry.title}
      </h3>
      
      {/* Description */}
      {entry.description && (
        <p className="text-gray-400 text-sm mb-3 line-clamp-2">
          {entry.description}
        </p>
      )}
      
      {/* Entry Details */}
      <div className="space-y-2">
        {/* Tickets */}
        <div className="flex justify-between items-center">
          <span className="text-gray-400 text-sm">Tickets</span>
          <span className="text-white font-medium">{entry.number_of_tickets}</span>
        </div>
        
        {/* Amount Spent */}
        <div className="flex justify-between items-center">
          <span className="text-gray-400 text-sm">Spent</span>
          <span className="text-white font-medium">{formatCurrency(entry.amount_spent)}</span>
        </div>
        
        {/* Purchase Date */}
        <div className="flex justify-between items-center">
          <span className="text-gray-400 text-sm">Date</span>
          <span className="text-white font-medium">{formatDate(entry.purchase_date)}</span>
        </div>
        
        {/* Status */}
        <div className="flex justify-between items-center">
          <span className="text-gray-400 text-sm">Status</span>
          <div className={`flex items-center gap-1 ${getStatusColor(entry.status, entry.is_instant_win)}`}>
            {getStatusIcon(entry.status, entry.is_instant_win)}
            <span className="font-medium capitalize">{entry.status}</span>
          </div>
        </div>
      </div>
      
      {/* Entry Type Indicator */}
      <div className="mt-3 pt-3 border-t border-gray-800">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500">
            {entry.entry_type === 'completed' ? 'Competition Entry' : 
             entry.entry_type === 'completed_transaction' ? 'Instant Win Purchase' : 'Pending Reservation'}
          </span>
          <span className="text-gray-500">
            ID: {entry.id.substring(0, 8)}...
          </span>
        </div>
      </div>
    </div>
  );
};

// Competition Grid Component
export const CompetitionGrid: React.FC<{
  entries: InstantWinEntry[];
  loading?: boolean;
  emptyMessage?: string;
  className?: string;
}> = ({ 
  entries, 
  loading = false, 
  emptyMessage = "No entries found",
  className = '' 
}) => {
  if (loading) {
    return (
      <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 ${className}`}>
        {[...Array(6)].map((_, i) => (
          <div key={i} className="bg-gray-900/50 border border-gray-800 rounded-lg p-4 animate-pulse">
            <div className="h-4 bg-gray-800 rounded mb-2"></div>
            <div className="h-32 bg-gray-800 rounded mb-3"></div>
            <div className="space-y-2">
              <div className="h-3 bg-gray-800 rounded"></div>
              <div className="h-3 bg-gray-800 rounded w-3/4"></div>
              <div className="h-3 bg-gray-800 rounded w-1/2"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
          <Gift className="w-8 h-8 text-gray-600" />
        </div>
        <h3 className="text-lg font-medium text-white mb-2">{emptyMessage}</h3>
        <p className="text-gray-400">Start entering competitions to see your entries here.</p>
      </div>
    );
  }

  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 ${className}`}>
      {entries.map((entry) => (
        <InstantWinEntryCard 
          key={entry.id} 
          entry={entry}
          className={entry.is_instant_win ? 'ring-1 ring-yellow-400/20' : ''}
        />
      ))}
    </div>
  );
};

// Filter Component for Different Entry Types
export const EntryTypeFilter: React.FC<{
  activeTab: 'all' | 'instant' | 'regular' | 'pending';
  onTabChange: (tab: 'all' | 'instant' | 'regular' | 'pending') => void;
  counts: {
    all: number;
    instant: number;
    regular: number;
    pending: number;
  };
}> = ({ activeTab, onTabChange, counts }) => {
  const tabs = [
    { key: 'all' as const, label: 'All Entries', count: counts.all, icon: null },
    { key: 'instant' as const, label: 'Instant Wins', count: counts.instant, icon: <Zap className="w-4 h-4" /> },
    { key: 'regular' as const, label: 'Competitions', count: counts.regular, icon: null },
    { key: 'pending' as const, label: 'Pending', count: counts.pending, icon: <Clock className="w-4 h-4" /> },
  ];

  return (
    <div className="flex flex-wrap gap-2 mb-6">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onTabChange(tab.key)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            activeTab === tab.key
              ? 'bg-yellow-400 text-black'
              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          {tab.icon}
          {tab.label}
          <span className={`text-xs px-2 py-1 rounded-full ${
            activeTab === tab.key 
              ? 'bg-black/20 text-black' 
              : 'bg-gray-700 text-gray-300'
          }`}>
            {tab.count}
          </span>
        </button>
      ))}
    </div>
  );
};

// Usage Example:
/*
import { CompetitionGrid, EntryTypeFilter, useEnhancedDashboard } from './instant-win-components';

const UserDashboard = () => {
  const {
    entries,
    loading,
    error,
    activeTab,
    setActiveTab,
    counts
  } = useEnhancedDashboard();

  if (error) {
    return <div className="text-red-400">Error: {error}</div>;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-white mb-6">My Entries</h1>

      <EntryTypeFilter
        activeTab={activeTab}
        onTabChange={setActiveTab}
        counts={counts}
      />

      <CompetitionGrid
        entries={entries}
        loading={loading}
        emptyMessage={
          activeTab === 'instant' ? 'No instant win entries yet' :
          activeTab === 'regular' ? 'No competition entries yet' :
          activeTab === 'pending' ? 'No pending reservations' :
          'No entries found'
        }
      />
    </div>
  );
};
*/