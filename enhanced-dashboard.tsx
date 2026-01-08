// Enhanced User Dashboard with Instant Win Support
// Main integration component that works with your existing UI

import React, { useState, useEffect } from 'react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { 
  Zap, 
  Clock, 
  RefreshCw, 
  Filter,
  SortAsc,
  SortDesc,
  Gift,
  Star,
  TrendingUp,
  DollarSign,
  Ticket,
  Calendar
} from 'lucide-react';
import { useDashboardWithFallback } from './dashboard-hooks';

// Types for the enhanced dashboard
interface DashboardStats {
  totalEntries: number;
  totalSpent: number;
  totalTickets: number;
  instantWinEntries: number;
  instantWinSpent: number;
  recentActivity: number;
}

interface TabInfo {
  key: 'all' | 'live' | 'drawn' | 'pending' | 'instant';
  label: string;
  icon: React.ReactNode;
  count: number;
}

// Main Enhanced Dashboard Component
export const EnhancedUserDashboard: React.FC<{
  userIdentifier: string; // wallet address or user ID
  className?: string;
}> = ({ userIdentifier, className = '' }) => {
  const [activeTab, setActiveTab] = useState<'all' | 'live' | 'drawn' | 'pending' | 'instant'>('all');
  const [sortBy, setSortBy] = useState<'date' | 'amount' | 'tickets'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const { entries, loading, error, usingFallback, refresh } = useDashboardWithFallback(userIdentifier);

  // Calculate dashboard statistics
  const stats: DashboardStats = React.useMemo(() => {
    const totalEntries = entries.length;
    const totalSpent = entries.reduce((sum, entry) => sum + entry.amount_spent, 0);
    const totalTickets = entries.reduce((sum, entry) => sum + entry.number_of_tickets, 0);
    const instantWinEntries = entries.filter(entry => entry.is_instant_win).length;
    const instantWinSpent = entries
      .filter(entry => entry.is_instant_win)
      .reduce((sum, entry) => sum + entry.amount_spent, 0);

    // Recent activity (last 24 hours)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const recentActivity = entries.filter(entry => 
      new Date(entry.purchase_date) > yesterday
    ).length;

    return {
      totalEntries,
      totalSpent,
      totalTickets,
      instantWinEntries,
      instantWinSpent,
      recentActivity
    };
  }, [entries]);

  // Filter and sort entries
  const filteredEntries = React.useMemo(() => {
    let filtered = entries;

    switch (activeTab) {
      case 'live':
        filtered = entries.filter(entry => entry.status === 'live');
        break;
      case 'drawn':
        filtered = entries.filter(entry => entry.status === 'drawn');
        break;
      case 'pending':
        filtered = entries.filter(entry => entry.status === 'pending');
        break;
      case 'instant':
        filtered = entries.filter(entry => entry.is_instant_win);
        break;
      default:
        filtered = entries;
    }

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

  // Tab configuration
  const tabs: TabInfo[] = [
    {
      key: 'all',
      label: 'ALL ENTRIES',
      icon: <Filter className="w-4 h-4" />,
      count: stats.totalEntries
    },
    {
      key: 'live',
      label: 'LIVE COMPETITIONS',
      icon: <Gift className="w-4 h-4" />,
      count: entries.filter(entry => entry.status === 'live').length
    },
    {
      key: 'drawn',
      label: 'FINISHED COMPETITIONS',
      icon: <Star className="w-4 h-4" />,
      count: entries.filter(entry => entry.status === 'drawn').length
    },
    {
      key: 'instant',
      label: 'INSTANT WINS',
      icon: <Zap className="w-4 h-4" />,
      count: stats.instantWinEntries
    },
    {
      key: 'pending',
      label: 'PENDING RESERVATIONS',
      icon: <Clock className="w-4 h-4" />,
      count: entries.filter(entry => entry.status === 'pending').length
    }
  ];

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

  if (error) {
    return (
      <div className={`bg-gray-900 border border-red-500/20 rounded-lg p-6 ${className}`}>
        <div className="text-center">
          <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <RefreshCw className="w-6 h-6 text-red-400" />
          </div>
          <h3 className="text-lg font-medium text-white mb-2">Error Loading Entries</h3>
          <p className="text-gray-400 mb-4">{error}</p>
          <Button onClick={refresh} variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Total Entries</p>
              <p className="text-2xl font-bold text-white">{stats.totalEntries}</p>
            </div>
            <Ticket className="w-8 h-8 text-blue-400" />
          </div>
        </div>

        <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Total Spent</p>
              <p className="text-2xl font-bold text-white">{formatCurrency(stats.totalSpent)}</p>
            </div>
            <DollarSign className="w-8 h-8 text-green-400" />
          </div>
        </div>

        <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Instant Wins</p>
              <p className="text-2xl font-bold text-white">{stats.instantWinEntries}</p>
              <p className="text-xs text-gray-500">{formatCurrency(stats.instantWinSpent)} spent</p>
            </div>
            <Zap className="w-8 h-8 text-yellow-400" />
          </div>
        </div>

        <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Recent Activity</p>
              <p className="text-2xl font-bold text-white">{stats.recentActivity}</p>
              <p className="text-xs text-gray-500">Last 24 hours</p>
            </div>
            <TrendingUp className="w-8 h-8 text-purple-400" />
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            variant={activeTab === tab.key ? "default" : "outline"}
            className={`flex items-center gap-2 ${
              activeTab === tab.key 
                ? 'bg-yellow-400 text-black hover:bg-yellow-500' 
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700 border-gray-700'
            }`}
          >
            {tab.icon}
            {tab.label}
            <Badge variant="secondary" className="ml-1">
              {tab.count}
            </Badge>
          </Button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="text-gray-400 text-sm">Sort by:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'date' | 'amount' | 'tickets')}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1 text-white text-sm"
          >
            <option value="date">Date</option>
            <option value="amount">Amount</option>
            <option value="tickets">Tickets</option>
          </select>
          <Button
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            variant="outline"
            size="sm"
          >
            {sortOrder === 'asc' ? <SortAsc className="w-4 h-4" /> : <SortDesc className="w-4 h-4" />}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {usingFallback && (
            <Badge variant="outline" className="text-yellow-400 border-yellow-400">
              Using Fallback Mode
            </Badge>
          )}
          <Button onClick={refresh} variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Entries Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          // Loading skeletons
          [...Array(6)].map((_, i) => (
            <div key={i} className="bg-gray-900/50 border border-gray-800 rounded-lg p-4 animate-pulse">
              <div className="h-4 bg-gray-800 rounded mb-2"></div>
              <div className="h-32 bg-gray-800 rounded mb-3"></div>
              <div className="space-y-2">
                <div className="h-3 bg-gray-800 rounded"></div>
                <div className="h-3 bg-gray-800 rounded w-3/4"></div>
                <div className="h-3 bg-gray-800 rounded w-1/2"></div>
              </div>
            </div>
          ))
        ) : filteredEntries.length === 0 ? (
          // Empty state
          <div className="col-span-full text-center py-12">
            <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
              <Gift className="w-8 h-8 text-gray-600" />
            </div>
            <h3 className="text-lg font-medium text-white mb-2">
              {activeTab === 'instant' ? 'No instant win entries yet' :
               activeTab === 'live' ? 'No live competitions entered' :
               activeTab === 'drawn' ? 'No finished competitions' :
               activeTab === 'pending' ? 'No pending reservations' :
               'No entries found'}
            </h3>
            <p className="text-gray-400">Start entering competitions to see your entries here.</p>
          </div>
        ) : (
          // Entry cards
          filteredEntries.map((entry) => (
            <EntryCard key={entry.id} entry={entry} formatCurrency={formatCurrency} formatDate={formatDate} />
          ))
        )}
      </div>
    </div>
  );
};

// Individual Entry Card Component
const EntryCard: React.FC<{
  entry: any;
  formatCurrency: (amount: number) => string;
  formatDate: (date: string) => string;
}> = ({ entry, formatCurrency, formatDate }) => {
  const getStatusColor = (status: string, isInstantWin: boolean) => {
    if (isInstantWin) {
      switch (status) {
        case 'live': return 'text-green-400 bg-green-400/10';
        case 'drawn': return 'text-purple-400 bg-purple-400/10';
        case 'pending': return 'text-yellow-400 bg-yellow-400/10';
        default: return 'text-gray-400 bg-gray-400/10';
      }
    }
    switch (status) {
      case 'live': return 'text-green-400 bg-green-400/10';
      case 'drawn': return 'text-purple-400 bg-purple-400/10';
      case 'pending': return 'text-yellow-400 bg-yellow-400/10';
      default: return 'text-gray-400 bg-gray-400/10';
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
    <div className={`bg-gray-900/50 border border-gray-800 rounded-lg p-4 hover:bg-gray-900/70 transition-colors ${
      entry.is_instant_win ? 'ring-1 ring-yellow-400/20' : ''
    }`}>
      {/* Instant Win Badge */}
      {entry.is_instant_win && (
        <div className="flex items-center gap-1 mb-2">
          <Zap className="w-4 h-4 text-yellow-400" />
          <span className="text-xs font-medium text-yellow-400 bg-yellow-400/10 px-2 py-1 rounded-full">
            INSTANT WIN
          </span>
        </div>
      )}

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
        <div className="flex justify-between items-center">
          <span className="text-gray-400 text-sm">Tickets</span>
          <span className="text-white font-medium">{entry.number_of_tickets}</span>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-gray-400 text-sm">Spent</span>
          <span className="text-white font-medium">{formatCurrency(entry.amount_spent)}</span>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-gray-400 text-sm">Date</span>
          <span className="text-white font-medium">{formatDate(entry.purchase_date)}</span>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-gray-400 text-sm">Status</span>
          <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(entry.status, entry.is_instant_win)}`}>
            {getStatusIcon(entry.status, entry.is_instant_win)}
            <span className="capitalize">{entry.status}</span>
          </div>
        </div>
      </div>

      {/* Entry Type */}
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

export default EnhancedUserDashboard;