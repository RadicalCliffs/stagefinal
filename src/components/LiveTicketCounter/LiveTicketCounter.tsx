import React, { useEffect, useState } from 'react';
import { useTicketSalesCounter } from '../../hooks/useRealTimeCompetition';
import { Ticket, TrendingUp, Clock, Zap } from 'lucide-react';

interface LiveTicketCounterProps {
  competitionId: string;
  totalTickets?: number;
  ticketsSold?: number;
  showProgress?: boolean;
  showAnimation?: boolean;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'compact' | 'detailed';
  className?: string;
}

/**
 * Live Ticket Sales Counter Component
 *
 * Displays real-time ticket sales with automatic updates via Supabase subscriptions.
 * Includes visual feedback for sales activity and urgency indicators.
 */
const LiveTicketCounter: React.FC<LiveTicketCounterProps> = ({
  competitionId,
  totalTickets: initialTotal,
  ticketsSold: initialSold,
  showProgress = true,
  showAnimation = true,
  size = 'md',
  variant = 'default',
  className = '',
}) => {
  const {
    ticketsSold,
    totalTickets,
    percentageSold,
    availableTickets,
    isLoading,
    isSoldOut,
    isAlmostSoldOut,
    refresh,
  } = useTicketSalesCounter(competitionId);

  // Animation state for when tickets are sold
  const [isAnimating, setIsAnimating] = useState(false);
  const [prevTicketsSold, setPrevTicketsSold] = useState(initialSold || 0);

  // Trigger animation when tickets are sold
  useEffect(() => {
    if (showAnimation && ticketsSold > prevTicketsSold && prevTicketsSold > 0) {
      setIsAnimating(true);
      const timer = setTimeout(() => setIsAnimating(false), 500);
      return () => clearTimeout(timer);
    }
    setPrevTicketsSold(ticketsSold);
  }, [ticketsSold, prevTicketsSold, showAnimation]);

  // Use real-time data or fall back to initial values
  const displaySold = isLoading ? (initialSold || 0) : ticketsSold;
  const displayTotal = isLoading ? (initialTotal || 0) : totalTickets;
  const displayAvailable = isLoading ? ((initialTotal || 0) - (initialSold || 0)) : availableTickets;
  const displayPercentage = displayTotal > 0 ? Math.round((displaySold / displayTotal) * 100) : 0;

  // Size classes
  const sizeClasses = {
    sm: {
      text: 'text-xs',
      textLg: 'text-sm',
      icon: 14,
      padding: 'px-2 py-1',
      gap: 'gap-1',
    },
    md: {
      text: 'text-sm',
      textLg: 'text-lg',
      icon: 18,
      padding: 'px-3 py-2',
      gap: 'gap-2',
    },
    lg: {
      text: 'text-base',
      textLg: 'text-2xl',
      icon: 24,
      padding: 'px-4 py-3',
      gap: 'gap-3',
    },
  };

  const s = sizeClasses[size];

  // Determine urgency color
  const getUrgencyColor = () => {
    if (isSoldOut) return 'text-red-400';
    if (isAlmostSoldOut) return 'text-orange-400';
    if (displayPercentage >= 50) return 'text-yellow-400';
    return 'text-[#DDE404]';
  };

  // Compact variant
  if (variant === 'compact') {
    return (
      <div className={`flex items-center ${s.gap} ${className}`}>
        <Ticket size={s.icon} className={getUrgencyColor()} />
        <span className={`sequel-75 text-white ${s.text}`}>
          {displayAvailable.toLocaleString()} left
        </span>
        {isAlmostSoldOut && !isSoldOut && (
          <Zap size={s.icon - 4} className="text-orange-400 animate-pulse" />
        )}
        {isSoldOut && (
          <span className="text-red-400 sequel-75 text-xs uppercase">Sold Out</span>
        )}
      </div>
    );
  }

  // Detailed variant
  if (variant === 'detailed') {
    return (
      <div className={`bg-[#1E1E1E] rounded-xl p-4 ${className}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Ticket size={20} className="text-[#DDE404]" />
            <span className="sequel-75 text-white text-sm">Ticket Sales</span>
          </div>
          <button
            onClick={refresh}
            className="text-white/40 hover:text-white transition-colors"
            title="Refresh"
          >
            <Clock size={14} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="relative h-3 bg-[#2A2A2A] rounded-full overflow-hidden mb-3">
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${
              isSoldOut
                ? 'bg-red-500'
                : isAlmostSoldOut
                ? 'bg-orange-500'
                : 'bg-[#DDE404]'
            } ${isAnimating ? 'animate-pulse' : ''}`}
            style={{ width: `${Math.min(displayPercentage, 100)}%` }}
          />
        </div>

        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="sequel-95 text-white text-xl">{displaySold.toLocaleString()}</p>
            <p className="sequel-45 text-white/40 text-xs">Sold</p>
          </div>
          <div>
            <p className={`sequel-95 ${getUrgencyColor()} text-xl`}>
              {displayAvailable.toLocaleString()}
            </p>
            <p className="sequel-45 text-white/40 text-xs">Available</p>
          </div>
          <div>
            <p className="sequel-95 text-white text-xl">{displayTotal.toLocaleString()}</p>
            <p className="sequel-45 text-white/40 text-xs">Total</p>
          </div>
        </div>

        {/* Urgency message */}
        {isAlmostSoldOut && !isSoldOut && (
          <div className="mt-3 bg-orange-500/10 border border-orange-500/30 rounded-lg px-3 py-2 flex items-center gap-2">
            <TrendingUp size={16} className="text-orange-400" />
            <span className="sequel-45 text-orange-400 text-xs">
              Only {displayAvailable} tickets left - selling fast!
            </span>
          </div>
        )}

        {isSoldOut && (
          <div className="mt-3 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-center">
            <span className="sequel-75 text-red-400 text-sm uppercase">Sold Out</span>
          </div>
        )}
      </div>
    );
  }

  // Default variant
  return (
    <div className={`${className}`}>
      <div className={`flex items-center ${s.gap} mb-2`}>
        <Ticket size={s.icon} className={getUrgencyColor()} />
        <span className={`sequel-45 text-white ${s.text}`}>
          {displayPercentage}% Entries Sold
        </span>
        {isAnimating && showAnimation && (
          <span className="text-[#DDE404] text-xs animate-bounce">+1</span>
        )}
      </div>

      {showProgress && (
        <div className="relative h-2.5 bg-[#1A1A1A] rounded-full overflow-hidden">
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${
              isSoldOut
                ? 'bg-red-500'
                : isAlmostSoldOut
                ? 'bg-linear-to-r from-orange-500 to-red-500'
                : 'bg-linear-to-r from-[#DDE404] to-[#B8C700]'
            } ${isAnimating ? 'animate-pulse' : ''}`}
            style={{ width: `${Math.max(Math.min(displayPercentage, 100), 5)}%` }}
          />
        </div>
      )}

      {isSoldOut && (
        <p className="sequel-75 text-red-400 text-xs mt-1 uppercase">Sold Out</p>
      )}
      {isAlmostSoldOut && !isSoldOut && (
        <p className="sequel-45 text-orange-400 text-xs mt-1">
          Only {displayAvailable} left!
        </p>
      )}
    </div>
  );
};

export default LiveTicketCounter;
