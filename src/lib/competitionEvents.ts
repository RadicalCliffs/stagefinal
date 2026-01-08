/**
 * CompetitionSystemV3 Event Listener Hook
 *
 * Provides real-time updates for competition events using viem's watchContractEvent.
 * This is the preferred method over polling for performance and responsiveness.
 *
 * Events (VRF v2.5 Contract):
 * - TicketsPurchased: New tickets purchased
 * - CompetitionCreated: New competition created
 * - WinnersSet: Winners announced for a competition
 * - Requested: VRF randomness requested
 * - Fulfilled: VRF randomness fulfilled
 */

import { useEffect, useCallback, useRef } from 'react';
import type { Address } from 'viem';
import {
  getPublicClient,
  CONTRACT_ADDRESS,
  COMPETITION_SYSTEM_ABI
} from './competitionSystemV3';

// Event callback types for VRF v2.5 contract
export interface TicketsPurchasedEvent {
  competitionId: bigint;
  buyer: Address;
  fromTicket: bigint;
  count: bigint;
}

export interface CompetitionCreatedEvent {
  competitionId: bigint;
  totalTickets: bigint;
  pricePerTicketWei: bigint;
  endTime: bigint;
  numWinners: number;
  maxTicketsPerTx: number;
}

export interface WinnersSetEvent {
  competitionId: bigint;
  ticketNumbers: readonly bigint[];
  winners: readonly Address[];
}

export interface RequestedEvent {
  requestId: bigint;
}

export interface FulfilledEvent {
  requestId: bigint;
  randomWords: readonly bigint[];
}

// Legacy event types for backward compatibility
export interface InstantWinSeedSetEvent {
  competitionId: bigint;
  seed: bigint;
}

export interface DrawSeedSetEvent {
  competitionId: bigint;
  seed: bigint;
}

export interface InstantWinEvent {
  competitionId: bigint;
  buyer: Address;
  ticketNumber: bigint;
  tierId: `0x${string}`;
}

export interface DrawResultEvent {
  competitionId: bigint;
  drawIndex: bigint;
  winningNumber: bigint;
  winner: Address;
  sold: boolean;
}

export interface CompetitionEventCallbacks {
  // VRF v2.5 events
  onTicketsPurchased?: (event: TicketsPurchasedEvent) => void;
  onCompetitionCreated?: (event: CompetitionCreatedEvent) => void;
  onWinnersSet?: (event: WinnersSetEvent) => void;
  onRequested?: (event: RequestedEvent) => void;
  onFulfilled?: (event: FulfilledEvent) => void;
  // Legacy callbacks (no longer fired but kept for compatibility)
  onInstantWinSeedSet?: (event: InstantWinSeedSetEvent) => void;
  onDrawSeedSet?: (event: DrawSeedSetEvent) => void;
  onInstantWin?: (event: InstantWinEvent) => void;
  onDrawResult?: (event: DrawResultEvent) => void;
}

/**
 * Hook to subscribe to CompetitionSystemV3 contract events
 *
 * @param callbacks - Object containing callback functions for each event type
 * @param competitionId - Optional: filter events for a specific competition
 * @returns Object with unsubscribe function
 */
export function useCompetitionEvents(
  callbacks: CompetitionEventCallbacks,
  competitionId?: number | bigint
) {
  const unsubscribersRef = useRef<(() => void)[]>([]);

  const subscribe = useCallback(() => {
    const publicClient = getPublicClient();
    const unsubscribers: (() => void)[] = [];

    // Common args for filtering by competition ID
    const filterArgs = competitionId !== undefined
      ? { competitionId: BigInt(competitionId) }
      : undefined;

    // Listen for TicketsPurchased
    if (callbacks.onTicketsPurchased) {
      const unsub = publicClient.watchContractEvent({
        address: CONTRACT_ADDRESS,
        abi: COMPETITION_SYSTEM_ABI,
        eventName: 'TicketsPurchased',
        args: filterArgs,
        onLogs: (logs) => {
          logs.forEach(log => {
            const args = log.args as unknown as TicketsPurchasedEvent;
            if (args.competitionId !== undefined && args.buyer && args.fromTicket !== undefined) {
              callbacks.onTicketsPurchased!(args);
            }
          });
        }
      });
      unsubscribers.push(unsub);
    }

    // Listen for CompetitionCreated
    if (callbacks.onCompetitionCreated) {
      const unsub = publicClient.watchContractEvent({
        address: CONTRACT_ADDRESS,
        abi: COMPETITION_SYSTEM_ABI,
        eventName: 'CompetitionCreated',
        args: filterArgs,
        onLogs: (logs) => {
          logs.forEach(log => {
            const args = log.args as unknown as CompetitionCreatedEvent;
            if (args.competitionId !== undefined) {
              callbacks.onCompetitionCreated!(args);
            }
          });
        }
      });
      unsubscribers.push(unsub);
    }

    // Listen for WinnersSet
    if (callbacks.onWinnersSet) {
      const unsub = publicClient.watchContractEvent({
        address: CONTRACT_ADDRESS,
        abi: COMPETITION_SYSTEM_ABI,
        eventName: 'WinnersSet',
        args: filterArgs,
        onLogs: (logs) => {
          logs.forEach(log => {
            const args = log.args as unknown as WinnersSetEvent;
            if (args.competitionId !== undefined && args.ticketNumbers && args.winners) {
              callbacks.onWinnersSet!(args);
            }
          });
        }
      });
      unsubscribers.push(unsub);
    }

    // Listen for VRF Requested event
    if (callbacks.onRequested) {
      const unsub = publicClient.watchContractEvent({
        address: CONTRACT_ADDRESS,
        abi: COMPETITION_SYSTEM_ABI,
        eventName: 'Requested',
        onLogs: (logs) => {
          logs.forEach(log => {
            const args = log.args as unknown as RequestedEvent;
            if (args.requestId !== undefined) {
              callbacks.onRequested!(args);
            }
          });
        }
      });
      unsubscribers.push(unsub);
    }

    // Listen for VRF Fulfilled event
    if (callbacks.onFulfilled) {
      const unsub = publicClient.watchContractEvent({
        address: CONTRACT_ADDRESS,
        abi: COMPETITION_SYSTEM_ABI,
        eventName: 'Fulfilled',
        onLogs: (logs) => {
          logs.forEach(log => {
            const args = log.args as unknown as FulfilledEvent;
            if (args.requestId !== undefined && args.randomWords) {
              callbacks.onFulfilled!(args);
            }
          });
        }
      });
      unsubscribers.push(unsub);
    }

    return unsubscribers;
  }, [callbacks, competitionId]);

  useEffect(() => {
    // Clean up previous subscriptions
    unsubscribersRef.current.forEach(unsub => unsub());

    // Create new subscriptions
    unsubscribersRef.current = subscribe();

    // Cleanup on unmount
    return () => {
      unsubscribersRef.current.forEach(unsub => unsub());
      unsubscribersRef.current = [];
    };
  }, [subscribe]);

  return {
    unsubscribe: () => {
      unsubscribersRef.current.forEach(unsub => unsub());
      unsubscribersRef.current = [];
    }
  };
}

/**
 * Subscribe to events for a specific user to detect their wins
 *
 * @param userAddress - The user's wallet address
 * @param onWin - Callback when user wins in a draw (via WinnersSet event)
 * @param competitionId - Optional: filter for specific competition
 */
export function useUserWinEvents(
  userAddress: string | undefined,
  onInstantWin?: (ticketNumber: number, tierId: string, competitionId: number) => void,
  onDrawWin?: (ticketNumber: number, competitionId: number) => void,
  competitionId?: number | bigint
) {
  useCompetitionEvents({
    // Listen to WinnersSet event for draw wins
    onWinnersSet: userAddress ? (event) => {
      event.winners.forEach((winner, i) => {
        if (winner.toLowerCase() === userAddress.toLowerCase()) {
          onDrawWin?.(Number(event.ticketNumbers[i]), Number(event.competitionId));
        }
      });
    } : undefined
  }, competitionId);
}

/**
 * Subscribe to ticket purchase events for real-time availability updates
 *
 * @param competitionId - The competition to watch
 * @param onUpdate - Callback with new sold count
 */
export function useTicketSalesEvents(
  competitionId: number | bigint,
  onUpdate: (newTicketsSold: number) => void
) {
  const ticketsSoldRef = useRef(0);

  useCompetitionEvents({
    onTicketsPurchased: (event) => {
      // New contract emits fromTicket and count instead of ticketNumbers array
      ticketsSoldRef.current += Number(event.count);
      onUpdate(ticketsSoldRef.current);
    }
  }, competitionId);

  // Method to set initial value
  return {
    setInitialCount: (count: number) => {
      ticketsSoldRef.current = count;
    }
  };
}

export default useCompetitionEvents;
