/**
 * VRF Dashboard Stats Component
 * 
 * Displays VRF-related statistics on the user dashboard including:
 * - VRF contract information
 * - Total blockchain-verified draws
 * - Recent winners
 * - Link to VRF contract on BaseScan
 */

import { useEffect, useState } from 'react';
import { ExternalLink, Zap, TrendingUp, Trophy } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import vrfMonitor from '../../lib/vrf-monitor';
import { COMPETITION_VRF_ADDRESS, CONTRACT_CONFIG } from '../../lib/vrf-contract';
import RecentWinnersWidget from '../RecentWinnersWidget';

interface VRFStats {
  totalDraws: number;
  totalWinners: number;
  activeCompetitions: number;
}

/**
 * VRF Stats Card showing blockchain-verified draw statistics
 */
export function VRFStatsCard() {
  const [stats, setStats] = useState<VRFStats>({
    totalDraws: 0,
    totalWinners: 0,
    activeCompetitions: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStats() {
      try {
        // Get total completed VRF draws
        const { count: drawsCount } = await supabase
          .from('competitions')
          .select('*', { count: 'exact', head: true })
          .eq('vrf_status', 'completed')
          .not('vrf_tx_hash', 'is', null);

        // Get total VRF winners
        const { count: winnersCount } = await supabase
          .from('winners')
          .select('*', { count: 'exact', head: true })
          .eq('is_winner', true);

        // Get active competitions with VRF
        const { count: activeCount } = await supabase
          .from('competitions')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'live')
          .not('onchain_competition_id', 'is', null);

        setStats({
          totalDraws: drawsCount || 0,
          totalWinners: winnersCount || 0,
          activeCompetitions: activeCount || 0,
        });
      } catch (error) {
        console.error('[VRFStatsCard] Error loading stats:', error);
      } finally {
        setLoading(false);
      }
    }

    loadStats();
  }, []);

  if (loading) {
    return (
      <div className="bg-[#1A1A1A] border border-purple-500/30 rounded-lg p-6">
        <div className="flex items-center gap-2 text-purple-400 mb-4">
          <Zap className="w-5 h-5 animate-pulse" />
          <h3 className="sequel-75 text-lg">VRF Statistics</h3>
        </div>
        <div className="text-white/60 sequel-45 text-sm">Loading stats...</div>
      </div>
    );
  }

  return (
    <div className="bg-linear-to-br from-purple-500/10 to-blue-500/10 border border-purple-500/30 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-purple-400">
          <Zap className="w-5 h-5" />
          <h3 className="sequel-75 text-lg">VRF Statistics</h3>
        </div>
        <a
          href={vrfMonitor.getContractUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className="text-purple-400 hover:text-purple-300 p-2 hover:bg-purple-500/10 rounded transition-colors"
          title="View VRF Contract on BaseScan"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="text-center">
          <div className="text-2xl text-white sequel-75">{stats.totalDraws}</div>
          <div className="text-white/60 sequel-45 text-xs mt-1">Draws</div>
        </div>
        <div className="text-center">
          <div className="text-2xl text-yellow-400 sequel-75">{stats.totalWinners}</div>
          <div className="text-white/60 sequel-45 text-xs mt-1">Winners</div>
        </div>
        <div className="text-center">
          <div className="text-2xl text-green-400 sequel-75">{stats.activeCompetitions}</div>
          <div className="text-white/60 sequel-45 text-xs mt-1">Active</div>
        </div>
      </div>

      <div className="pt-4 border-t border-white/10">
        <div className="space-y-2 text-sm sequel-45">
          <div className="flex items-center justify-between">
            <span className="text-white/60">Network:</span>
            <span className="text-white">Base Mainnet</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/60">Chain ID:</span>
            <span className="text-white">{CONTRACT_CONFIG.chainId}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/60">Contract:</span>
            <a
              href={vrfMonitor.getContractUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="text-purple-400 hover:text-purple-300 font-mono text-xs flex items-center gap-1"
            >
              {COMPETITION_VRF_ADDRESS.slice(0, 10)}...{COMPETITION_VRF_ADDRESS.slice(-8)}
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Full VRF Dashboard Section
 * Combines stats and recent winners
 */
export function VRFDashboardSection({ className = '' }: { className?: string }) {
  return (
    <div className={`space-y-6 ${className}`}>
      <div className="flex items-center gap-2 text-white mb-4">
        <Zap className="w-6 h-6 text-purple-400" />
        <h2 className="sequel-95 text-2xl uppercase">Blockchain Verification</h2>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* VRF Stats Card */}
        <VRFStatsCard />

        {/* Recent Winners Widget */}
        <RecentWinnersWidget limit={5} />
      </div>

      {/* Info Banner */}
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <TrendingUp className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="text-white sequel-75 text-sm mb-1">
              Verifiable Random Function (VRF)
            </h4>
            <p className="text-white/70 sequel-45 text-xs leading-relaxed">
              All competition winners are selected using Chainlink VRF on the Base blockchain. 
              This ensures provably fair and transparent draws that cannot be manipulated. 
              Click any VRF transaction link to verify the randomness on BaseScan.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default VRFDashboardSection;
