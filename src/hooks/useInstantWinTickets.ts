import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import {
  getCompetitionDetails,
  didUserWin,
  useCompetitionEvents,
  type InstantWinEvent,
  type DrawResultEvent
} from '../lib/luckyDip';
import { userIdsEqual } from '../utils/userId';

// UUID validation regex (RFC 4122)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Get authentication token for API calls
async function getAuthToken(): Promise<string | null> {
  try {
    const walletAddress = localStorage.getItem('cdp:wallet_address') ||
                         localStorage.getItem('base:wallet_address');
    if (walletAddress) {
      return `wallet:${walletAddress}`;
    }

    const privyToken = localStorage.getItem('privy:token') ||
                       localStorage.getItem('privy:access_token');
    if (privyToken) {
      return privyToken;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      return session.access_token;
    }

    return null;
  } catch (err) {
    console.error('Error getting auth token:', err);
    return null;
  }
}

// Prize tier configuration - Fixed structure: 3 major prizes + 50 minor prizes = 53 total
export const PRIZE_TIERS = {
  GRAND_PRIZE: { name: 'Grand Prize', count: 1, priority: 1 },
  MAJOR_PRIZE: { name: 'Major Prize', count: 1, priority: 2 },
  JACKPOT: { name: 'Jackpot', count: 1, priority: 3 },
} as const;

// Total major prize winning tickets: 1 + 1 + 1 = 3
export const TOTAL_KEY_PRIZE_TICKETS = 3;

// Minor prize configuration - 50 total: 20x$2 + 20x$3 + 10x$5
export const MINOR_PRIZE_CONFIG = {
  TOTAL_PRIZES: 50,
  $2_COUNT: 20,
  $3_COUNT: 20,
  $5_COUNT: 10,
  MIN_PRIORITY: 4, // Priority 4+ are minor prizes
};

// Total winning tickets: 3 major + 50 minor = 53
export const TOTAL_WINNING_TICKETS = TOTAL_KEY_PRIZE_TICKETS + MINOR_PRIZE_CONFIG.TOTAL_PRIZES;

/**
 * ISSUE #2 FIX: Data source enum for tracking win origin
 * This ensures we know where win data came from for debugging and reconciliation
 */
export type WinDataSource = 'contract' | 'database' | 'unified';

export interface WinningTicket {
  ticketNumber: number;
  prizeTier: string;
  prizeValue?: number;
  isClaimed: boolean;
  winnerAddress?: string;
  /** ISSUE #2 FIX: Track data source for each win */
  dataSource?: WinDataSource;
  /** Timestamp when win was detected/claimed */
  detectedAt?: string;
}

export interface InstantWinTicketsState {
  keyPrizeTickets: WinningTicket[];
  minorPrizeTickets: WinningTicket[];
  allTickets: number[];
  loading: boolean;
  initialized: boolean;
  error: string | null;
  isContractBased: boolean;
  seedReady: boolean;
  /** ISSUE #2 FIX: Track last sync time for staleness detection */
  lastSyncedAt: string | null;
  /** ISSUE #2 FIX: Track sync status */
  syncStatus: 'idle' | 'syncing' | 'synced' | 'error';
}

interface UseInstantWinTicketsOptions {
  competitionUid: string;
  totalTickets: number;
  autoInitialize?: boolean;
  /** On-chain competition ID (if using CompetitionSystemV3) */
  onChainCompetitionId?: number;
  /** User's wallet address for checking personal wins */
  userAddress?: string;
}

/**
 * Hook to manage instant win tickets for a competition.
 *
 * UPDATED FOR COMPETITIONSYSTEMV3:
 * - Now uses on-chain VRF for instant win determination instead of frontend RNG
 * - Instant wins are detected via contract events (InstantWin)
 * - The contract uses VRF seed to determine winners at purchase time
 *
 * For INSTANT_WIN competitions in CompetitionSystemV3:
 * 1. Admin creates competition (VRF called immediately)
 * 2. VRF returns instantWinSeed
 * 3. Users buy tickets (lucky dip only)
 * 4. Each purchase checks for instant win against VRF seed
 * 5. Winners announced immediately via InstantWin events
 *
 * BACKWARD COMPATIBILITY:
 * - Still supports database-backed prize tracking via Prize_Instantprizes table
 * - Works alongside contract events for comprehensive tracking
 */
export function useInstantWinTickets({
  competitionUid,
  totalTickets: _totalTickets,
  autoInitialize = true,
  onChainCompetitionId,
  userAddress,
}: UseInstantWinTicketsOptions) {
  const [state, setState] = useState<InstantWinTicketsState>({
    keyPrizeTickets: [],
    minorPrizeTickets: [],
    allTickets: [],
    loading: true,
    initialized: false,
    error: null,
    isContractBased: false,
    seedReady: false,
    // ISSUE #2 FIX: Initialize sync tracking fields
    lastSyncedAt: null,
    syncStatus: 'idle',
  });

  const [recentWins, setRecentWins] = useState<InstantWinEvent[]>([]);
  const [userWins, setUserWins] = useState<number[]>([]);

  // Check if competition has on-chain VRF support
  const checkContractStatus = useCallback(async () => {
    if (onChainCompetitionId === undefined) return null;

    try {
      const details = await getCompetitionDetails(onChainCompetitionId);
      return {
        isContractBased: details.isInstantWin,
        seedReady: details.seedReady,
        instantWinSeed: details.instantWinSeed,
      };
    } catch (error) {
      console.error('Error checking contract status:', error);
      return null;
    }
  }, [onChainCompetitionId]);

  // Subscribe to contract events for real-time instant win detection
  useCompetitionEvents(
    onChainCompetitionId !== undefined
      ? {
          onInstantWin: (event) => {
            // Add to recent wins
            setRecentWins((prev) => [...prev, event]);

            // Check if current user won using userIdsEqual for case-insensitive comparison
            if (userAddress && userIdsEqual(event.buyer, userAddress)) {
              setUserWins((prev) => [...prev, Number(event.ticketNumber)]);
            }

            // ISSUE #2 FIX: Sync contract win to database for consistency
            syncContractWinToDatabase(competitionUid, event);
          },
          onInstantWinSeedSet: (_event) => {
            // VRF seed received, update state
            setState((prev) => ({
              ...prev,
              seedReady: true,
              isContractBased: true,
            }));
          },
        }
      : {},
    onChainCompetitionId
  );

  /**
   * ISSUE #2 FIX: Sync a contract event win to the database
   * Uses Netlify function for atomic upsert to prevent TOCTOU race conditions
   */
  const syncContractWinToDatabase = async (competitionId: string, event: InstantWinEvent) => {
    try {
      // Use Netlify function for atomic sync operation
      const response = await fetch('/api/instant-win-sync/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          competitionId,
          ticketNumber: Number(event.ticketNumber),
          buyerAddress: event.buyer,
          tierId: event.tierId || 'Instant Win',
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        console.error('Error syncing contract win:', data.error || response.statusText);
      }
    } catch (error) {
      console.error('Error syncing contract win to database:', error);
    }
  };

  // Initialize tickets when competition loads
  const initializeTickets = useCallback(async () => {
    if (!competitionUid || !UUID_REGEX.test(competitionUid)) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: 'Invalid competition UID',
        syncStatus: 'error',
      }));
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null, syncStatus: 'syncing' }));

    try {
      // Check contract status first
      const contractStatus = await checkContractStatus();

      // ISSUE #2 FIX: Always fetch database records regardless of contract status
      // This creates a unified view combining both sources
      const { data: claimedData, error: fetchError }: any = (await supabase
        .from('Prize_Instantprizes')
        .select('winningTicket, winningWalletAddress, prize, wonAt')
        .eq('competitionId', competitionUid)) as any;

      if (fetchError) {
        console.error('Error fetching claimed tickets:', fetchError);
      }

      // Build tickets from database records with source tracking
      const keyTickets: WinningTicket[] = [];
      const minorTickets: WinningTicket[] = [];
      const allTickets: number[] = [];
      const dbTicketSet = new Set<number>();

      if (claimedData) {
        claimedData.forEach((item: any) => {
          if (item.winningTicket !== null) {
            const ticket: WinningTicket = {
              ticketNumber: item.winningTicket,
              prizeTier: item.prize || 'Unknown',
              isClaimed: !!item.winningWalletAddress,
              winnerAddress: item.winningWalletAddress || undefined,
              // ISSUE #2 FIX: Track data source (default to database since we're fetching from DB)
              dataSource: 'database',
              detectedAt: item.wonAt || undefined,
            };

            // Categorize as key or minor prize based on prize name
            if (
              item.prize?.includes('Grand') ||
              item.prize?.includes('Major') ||
              item.prize?.includes('Jackpot')
            ) {
              keyTickets.push(ticket);
            } else {
              minorTickets.push(ticket);
            }

            allTickets.push(item.winningTicket);
            dbTicketSet.add(item.winningTicket);
          }
        });
      }

      // ISSUE #2 FIX: If contract-based, also check on-chain wins and merge
      if (contractStatus?.isContractBased && userAddress && onChainCompetitionId !== undefined) {
        try {
          const { won, winningTickets } = await didUserWin(onChainCompetitionId, userAddress);
          if (won) {
            setUserWins(winningTickets);

            // Add any contract wins not in database to the list
            winningTickets.forEach((ticketNum) => {
              if (!dbTicketSet.has(ticketNum)) {
                const ticket: WinningTicket = {
                  ticketNumber: ticketNum,
                  prizeTier: 'Contract Win',
                  isClaimed: true,
                  winnerAddress: userAddress,
                  dataSource: 'contract',
                  detectedAt: new Date().toISOString(),
                };
                minorTickets.push(ticket);
                allTickets.push(ticketNum);
              }
            });
          }
        } catch (contractError) {
          console.error('Error checking contract wins:', contractError);
        }
      }

      setState({
        keyPrizeTickets: keyTickets,
        minorPrizeTickets: minorTickets,
        allTickets: allTickets.sort((a, b) => a - b),
        loading: false,
        initialized: true,
        error: null,
        isContractBased: contractStatus?.isContractBased || false,
        seedReady: contractStatus?.seedReady || false,
        // ISSUE #2 FIX: Update sync tracking
        lastSyncedAt: new Date().toISOString(),
        syncStatus: 'synced',
      });
    } catch (err) {
      console.error('Error initializing tickets:', err);
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to initialize tickets',
        syncStatus: 'error',
      }));
    }
  }, [competitionUid, checkContractStatus, userAddress, onChainCompetitionId]);

  // Auto-initialize on mount if enabled
  useEffect(() => {
    if (autoInitialize && competitionUid && UUID_REGEX.test(competitionUid)) {
      initializeTickets();
    }
  }, [autoInitialize, competitionUid, initializeTickets]);

  // Check if a ticket number is a winner (from contract events or database)
  const isWinningTicket = useCallback(
    (ticketNumber: number): boolean => {
      // Check contract events first
      if (recentWins.some((w) => Number(w.ticketNumber) === ticketNumber)) {
        return true;
      }
      // Fall back to database records
      return state.allTickets.includes(ticketNumber);
    },
    [state.allTickets, recentWins]
  );

  // Get prize info for a winning ticket
  const getPrizeInfo = useCallback(
    (ticketNumber: number): WinningTicket | null => {
      // Check contract events first
      const contractWin = recentWins.find((w) => Number(w.ticketNumber) === ticketNumber);
      if (contractWin) {
        return {
          ticketNumber,
          prizeTier: contractWin.tierId, // tierId from contract
          isClaimed: true, // Contract wins are immediately claimed
          winnerAddress: contractWin.buyer,
        };
      }

      // Fall back to database
      const keyPrize = state.keyPrizeTickets.find((t) => t.ticketNumber === ticketNumber);
      if (keyPrize) return keyPrize;

      const minorPrize = state.minorPrizeTickets.find((t) => t.ticketNumber === ticketNumber);
      return minorPrize || null;
    },
    [state.keyPrizeTickets, state.minorPrizeTickets, recentWins]
  );

  // Stats for display
  const stats = useMemo(() => {
    const keyPrizeClaimed = state.keyPrizeTickets.filter((t) => t.isClaimed).length;
    const minorPrizeClaimed = state.minorPrizeTickets.filter((t) => t.isClaimed).length;

    // ISSUE #2 FIX: Count wins by data source for debugging
    const contractWinCount = [...state.keyPrizeTickets, ...state.minorPrizeTickets]
      .filter((t) => t.dataSource === 'contract').length;
    const databaseWinCount = [...state.keyPrizeTickets, ...state.minorPrizeTickets]
      .filter((t) => t.dataSource === 'database').length;

    return {
      totalKeyPrizes: state.keyPrizeTickets.length,
      claimedKeyPrizes: keyPrizeClaimed,
      remainingKeyPrizes: state.keyPrizeTickets.length - keyPrizeClaimed,
      totalMinorPrizes: state.minorPrizeTickets.length,
      claimedMinorPrizes: minorPrizeClaimed,
      remainingMinorPrizes: state.minorPrizeTickets.length - minorPrizeClaimed,
      totalWinningTickets: state.allTickets.length + recentWins.length,
      recentContractWins: recentWins.length,
      userWinCount: userWins.length,
      // ISSUE #2 FIX: Expose source counts for debugging
      contractWinCount,
      databaseWinCount,
      lastSyncedAt: state.lastSyncedAt,
      syncStatus: state.syncStatus,
    };
  }, [state.keyPrizeTickets, state.minorPrizeTickets, state.allTickets, recentWins, userWins, state.lastSyncedAt, state.syncStatus]);

  return {
    ...state,
    initializeTickets,
    isWinningTicket,
    getPrizeInfo,
    stats,
    recentWins,
    userWins,
  };
}
