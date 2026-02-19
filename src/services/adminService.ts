/**
 * Admin Service
 * 
 * Service methods for administrative operations including VRF winner management
 */

import { supabase } from '../lib/supabase';

// ============================================================================
// VRF Winner Management
// ============================================================================

export interface WinnerEntry {
  id: string;
  ticket_number: number;
  is_winner: boolean;
  won_at: string | null;
  competition_id: string;
  canonical_users: {
    privy_user_id: string;
    username: string;
    email: string;
    wallet_address: string;
  } | null;
}

/**
 * Get all winners for a specific competition
 * @param competitionId - The competition UUID
 * @returns Array of winner entries with user details
 */
export async function getCompetitionWinners(competitionId: string): Promise<WinnerEntry[]> {
  try {
    const { data, error } = await supabase
      .from('winners')
      .select(`
        *,
        canonical_users (
          privy_user_id,
          username,
          email,
          wallet_address
        )
      `)
      .eq('competition_id', competitionId)
      .eq('is_winner', true)
      .order('won_at', { ascending: true });

    if (error) {
      console.error('[AdminService] Error fetching competition winners:', error);
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('[AdminService] Unexpected error in getCompetitionWinners:', error);
    throw error;
  }
}

/**
 * Check if a specific user won in a specific competition
 * @param userId - The canonical user ID
 * @param competitionId - The competition UUID
 * @returns Winner details if user won, null otherwise
 */
export async function checkUserWinner(
  userId: string,
  competitionId: string
): Promise<{ is_winner: boolean; won_at: string | null; ticket_number: number | null } | null> {
  try {
    const { data, error } = await supabase
      .from('winners')
      .select('is_winner, won_at, ticket_number')
      .eq('canonical_user_id', userId)
      .eq('competition_id', competitionId)
      .eq('is_winner', true)
      .maybeSingle();

    if (error) {
      console.error('[AdminService] Error checking user winner status:', error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error('[AdminService] Unexpected error in checkUserWinner:', error);
    throw error;
  }
}

/**
 * Get count of total VRF winners across all competitions
 * @returns Total number of winners
 */
export async function getTotalWinnersCount(): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('winners')
      .select('*', { count: 'exact', head: true })
      .eq('is_winner', true);

    if (error) {
      console.error('[AdminService] Error fetching total winners count:', error);
      throw error;
    }

    return count || 0;
  } catch (error) {
    console.error('[AdminService] Unexpected error in getTotalWinnersCount:', error);
    throw error;
  }
}

/**
 * Get winners by competition with aggregated stats
 * @returns Array of competitions with winner counts and latest win times
 */
export async function getWinnersByCompetition(): Promise<Array<{
  competition_id: string;
  competition_title: string | null;
  vrf_tx_hash: string | null;
  winner_count: number;
  latest_win: string | null;
}>> {
  try {
    // This would ideally be a database view or RPC function
    // For now, we'll fetch and aggregate in JavaScript
    const { data: competitions, error: compError } = await supabase
      .from('competitions')
      .select('id, title, vrf_tx_hash')
      .eq('status', 'drawn');

    if (compError) throw compError;

    const results = await Promise.all(
      (competitions || []).map(async (comp) => {
        const { data: winners, error: winError } = await supabase
          .from('winners')
          .select('won_at')
          .eq('competition_id', comp.id)
          .eq('is_winner', true);

        if (winError) {
          console.error(`Error fetching winners for ${comp.id}:`, winError);
          return {
            competition_id: comp.id,
            competition_title: comp.title,
            vrf_tx_hash: comp.vrf_tx_hash,
            winner_count: 0,
            latest_win: null,
          };
        }

        const latestWin = winners && winners.length > 0
          ? winners.reduce((latest, w) => {
              if (!latest || (w.won_at && w.won_at > latest)) {
                return w.won_at;
              }
              return latest;
            }, null as string | null)
          : null;

        return {
          competition_id: comp.id,
          competition_title: comp.title,
          vrf_tx_hash: comp.vrf_tx_hash,
          winner_count: winners?.length || 0,
          latest_win: latestWin,
        };
      })
    );

    return results.sort((a, b) => {
      if (!a.latest_win) return 1;
      if (!b.latest_win) return -1;
      return b.latest_win.localeCompare(a.latest_win);
    });
  } catch (error) {
    console.error('[AdminService] Unexpected error in getWinnersByCompetition:', error);
    throw error;
  }
}

// ============================================================================
// Default Export
// ============================================================================

const adminService = {
  getCompetitionWinners,
  checkUserWinner,
  getTotalWinnersCount,
  getWinnersByCompetition,
};

export default adminService;
