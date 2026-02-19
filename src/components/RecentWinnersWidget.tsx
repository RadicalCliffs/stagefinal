/**
 * Recent Winners Widget
 * 
 * Displays the most recent VRF-verified winners across all competitions
 */

import { useEffect, useState } from 'react';
import { Zap, ExternalLink, Trophy } from 'lucide-react';
import { supabase } from '../lib/supabase';
import vrfMonitor from '../lib/vrf-monitor';

// Simple date formatter
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${month} ${day}, ${year} ${hours}:${minutes}`;
}

interface WinnerEntry {
  id: string;
  ticket_number: number;
  won_at: string;
  canonical_users: {
    username: string;
  };
  competitions: {
    title: string;
    vrf_tx_hash: string | null;
  };
}

interface RecentWinnersWidgetProps {
  limit?: number;
  className?: string;
}

/**
 * Displays a list of recent VRF winners with links to their winning draws
 */
export function RecentWinnersWidget({ limit = 10, className = '' }: RecentWinnersWidgetProps) {
  const [winners, setWinners] = useState<WinnerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadWinners() {
      try {
        // Query winners from joincompetition table
        // Note: Assuming the winner tracking columns exist in joincompetition
        const { data, error } = await supabase
          .from('winners')
          .select(`
            id,
            ticket_number,
            won_at,
            canonical_users (username),
            competitions (title, vrf_tx_hash)
          `)
          .eq('is_winner', true)
          .not('won_at', 'is', null)
          .order('won_at', { ascending: false })
          .limit(limit);

        if (error) {
          console.error('[RecentWinnersWidget] Error loading winners:', error);
          setWinners([]);
        } else {
          setWinners(data || []);
        }
      } catch (error) {
        console.error('[RecentWinnersWidget] Unexpected error:', error);
        setWinners([]);
      } finally {
        setLoading(false);
      }
    }

    loadWinners();

    // Set up real-time subscription for new winners
    const channel = supabase
      .channel('recent-winners')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'winners',
        },
        () => {
          // Reload winners when new winner is added
          loadWinners();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'winners',
          filter: 'is_winner=eq.true',
        },
        () => {
          // Reload winners when winner status is updated
          loadWinners();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [limit]);

  if (loading) {
    return (
      <div className={`space-y-2 ${className}`}>
        <h3 className="text-white sequel-75 text-lg flex items-center gap-2">
          <Trophy className="w-5 h-5 text-yellow-400" />
          Recent VRF Winners
        </h3>
        <div className="bg-[#1A1A1A] p-4 rounded-lg border border-white/10">
          <div className="text-white/60 sequel-45 text-sm">Loading winners...</div>
        </div>
      </div>
    );
  }

  if (winners.length === 0) {
    return (
      <div className={`space-y-2 ${className}`}>
        <h3 className="text-white sequel-75 text-lg flex items-center gap-2">
          <Trophy className="w-5 h-5 text-yellow-400" />
          Recent VRF Winners
        </h3>
        <div className="bg-[#1A1A1A] p-4 rounded-lg border border-white/10">
          <div className="text-white/60 sequel-45 text-sm">No winners yet</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      <h3 className="text-white sequel-75 text-lg flex items-center gap-2">
        <Trophy className="w-5 h-5 text-yellow-400" />
        Recent VRF Winners
      </h3>
      
      <div className="space-y-2">
        {winners.map((winner) => (
          <div
            key={winner.id}
            className="bg-[#1A1A1A] p-3 rounded-lg border border-white/10 hover:border-purple-500/30 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                {/* Winner Info */}
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="w-4 h-4 text-purple-400 flex-shrink-0" />
                  <span className="text-white sequel-45 text-sm truncate">
                    {winner.canonical_users?.username || 'Anonymous'}
                  </span>
                  <span className="text-white/50 sequel-45 text-xs flex-shrink-0">
                    • #{winner.ticket_number}
                  </span>
                </div>

                {/* Competition Title */}
                <p className="text-white/70 sequel-45 text-sm truncate mb-1">
                  {winner.competitions?.title || 'Unknown Competition'}
                </p>

                {/* Win Date */}
                <p className="text-white/50 sequel-45 text-xs">
                  {formatDate(winner.won_at)}
                </p>
              </div>

              {/* VRF Link */}
              {winner.competitions?.vrf_tx_hash && (
                <a
                  href={vrfMonitor.getTransactionUrl(winner.competitions.vrf_tx_hash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 text-purple-400 hover:text-purple-300 p-2 hover:bg-purple-500/10 rounded transition-colors"
                  title="View VRF Draw on BaseScan"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* View All Link */}
      {winners.length >= limit && (
        <div className="text-center pt-2">
          <a
            href="/winners"
            className="text-purple-400 hover:text-purple-300 sequel-45 text-sm inline-flex items-center gap-1"
          >
            View All Winners
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
    </div>
  );
}

export default RecentWinnersWidget;
