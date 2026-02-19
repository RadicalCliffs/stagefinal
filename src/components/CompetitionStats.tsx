/**
 * Competition Stats Component
 * 
 * Displays statistics for a competition including winner count
 */

import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface CompetitionStatsProps {
  competitionId: string;
  className?: string;
}

/**
 * Displays the count of VRF-verified winners for a competition
 */
export function CompetitionStats({ competitionId, className = '' }: CompetitionStatsProps) {
  const [winnerCount, setWinnerCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function getCount() {
      try {
        // Count winners from the winners table
        const { count, error } = await supabase
          .from('winners')
          .select('*', { count: 'exact', head: true })
          .eq('competition_id', competitionId)
          .eq('is_winner', true);

        if (error) {
          console.error('[CompetitionStats] Error fetching winner count:', error);
          setWinnerCount(0);
        } else {
          setWinnerCount(count || 0);
        }
      } catch (error) {
        console.error('[CompetitionStats] Unexpected error:', error);
        setWinnerCount(0);
      } finally {
        setLoading(false);
      }
    }

    getCount();

    // Set up real-time subscription for winner updates
    const channel = supabase
      .channel(`competition-stats-${competitionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'winners',
          filter: `competition_id=eq.${competitionId}`,
        },
        () => {
          // Reload count when winners change
          getCount();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [competitionId]);

  if (loading) {
    return (
      <div className={`inline-flex items-center gap-2 text-white/60 ${className}`}>
        <Trophy className="w-4 h-4" />
        <span className="sequel-45 text-sm">Loading...</span>
      </div>
    );
  }

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <Trophy className="w-4 h-4 text-yellow-400" />
      <span className="text-white sequel-45">
        {winnerCount} {winnerCount === 1 ? 'Winner' : 'Winners'} Selected
      </span>
    </div>
  );
}

export default CompetitionStats;
