/**
 * Admin Service
 *
 * Service methods for administrative operations including VRF winner management
 */

import { supabase } from "../lib/supabase";

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
export async function getCompetitionWinners(
  competitionId: string,
): Promise<WinnerEntry[]> {
  try {
    const { data, error } = await supabase
      .from("winners")
      .select(
        `
        *,
        canonical_users (
          privy_user_id,
          username,
          email,
          wallet_address
        )
      `,
      )
      .eq("competition_id", competitionId)
      .eq("is_winner", true)
      .order("won_at", { ascending: true } as any);

    if (error) {
      console.error(
        "[AdminService] Error fetching competition winners:",
        error,
      );
      throw error;
    }

    return (data as unknown as WinnerEntry[]) || [];
  } catch (error) {
    console.error(
      "[AdminService] Unexpected error in getCompetitionWinners:",
      error,
    );
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
  competitionId: string,
): Promise<{
  is_winner: boolean;
  won_at: string | null;
  ticket_number: number | null;
} | null> {
  try {
    const { data, error } = (await supabase
      .from("winners")
      .select("is_winner, won_at, ticket_number")
      .eq("canonical_user_id", userId)
      .eq("competition_id", competitionId)
      .eq("is_winner", true)
      .maybeSingle()) as any;

    if (error) {
      console.error("[AdminService] Error checking user winner status:", error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error("[AdminService] Unexpected error in checkUserWinner:", error);
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
      .from("winners")
      .select("*", { count: "exact", head: true })
      .eq("is_winner", true);

    if (error) {
      console.error(
        "[AdminService] Error fetching total winners count:",
        error,
      );
      throw error;
    }

    return count || 0;
  } catch (error) {
    console.error(
      "[AdminService] Unexpected error in getTotalWinnersCount:",
      error,
    );
    throw error;
  }
}

/**
 * Get winners by competition with aggregated stats
 * Uses optimized query to avoid N+1 problem
 * @returns Array of competitions with winner counts and latest win times
 */
export async function getWinnersByCompetition(): Promise<
  Array<{
    competition_id: string;
    competition_title: string | null;
    vrf_tx_hash: string | null;
    winner_count: number;
    latest_win: string | null;
  }>
> {
  try {
    // Fetch all winners and competitions in one query using a join
    const { data: winners, error: winnersError } = (await supabase
      .from("winners")
      .select("competition_id, won_at, competitions(id, title, vrf_tx_hash)")
      .eq("is_winner", true)) as any;

    if (winnersError) throw winnersError;

    // Group winners by competition
    const competitionMap = new Map<
      string,
      {
        title: string | null;
        vrf_tx_hash: string | null;
        winners: Array<{ won_at: string | null }>;
      }
    >();

    for (const winner of winners || []) {
      const compId = winner.competition_id;
      if (!competitionMap.has(compId)) {
        competitionMap.set(compId, {
          title: (winner.competitions as any)?.title || null,
          vrf_tx_hash: (winner.competitions as any)?.vrf_tx_hash || null,
          winners: [],
        });
      }
      competitionMap.get(compId)!.winners.push({ won_at: winner.won_at });
    }

    // Convert to result format
    const results = Array.from(competitionMap.entries()).map(
      ([compId, data]) => {
        const latestWin = data.winners.reduce(
          (latest, w) => {
            if (!latest || (w.won_at && w.won_at > latest)) {
              return w.won_at;
            }
            return latest;
          },
          null as string | null,
        );

        return {
          competition_id: compId,
          competition_title: data.title,
          vrf_tx_hash: data.vrf_tx_hash,
          winner_count: data.winners.length,
          latest_win: latestWin,
        };
      },
    );

    // Sort by latest win (most recent first)
    return results.sort((a, b) => {
      if (!a.latest_win) return 1;
      if (!b.latest_win) return -1;
      return b.latest_win.localeCompare(a.latest_win);
    });
  } catch (error) {
    console.error(
      "[AdminService] Unexpected error in getWinnersByCompetition:",
      error,
    );
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
