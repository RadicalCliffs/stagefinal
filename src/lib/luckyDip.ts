/**
 * Lucky Dip VRF Contract Helper
 *
 * This module provides functions to interact with the CompetitionVRF v2.5 smart contract
 * deployed on Base network. The contract uses VRF (Verifiable Random Function) for
 * fair random winner selection via Chainlink VRF v2.5.
 *
 * Contract: 0x8ce54644e3313934D663c43Aea29641DFD8BcA1A (Base Mainnet)
 * See: src/lib/vrf-contract.ts for the source of truth
 *
 * This file maintains backward compatibility with the old LuckyDipTicketSystem interface
 * while using the new CompetitionVRF contract underneath.
 *
 * Key features:
 * - Buy tickets (sequential assignment via buyTickets)
 * - Query available tickets
 * - Get competition details
 * - VRF-based winner selection
 * - Ticket allocation tracking per user
 *
 * Integration with Privy:
 * - Uses Privy wallet provider for signing transactions
 * - Supports embedded wallets, MetaMask, Coinbase Wallet, etc.
 */

import { formatEther } from 'viem';
import type { WalletClient, Hash } from 'viem';

// Re-export everything from the new CompetitionSystemV3 module
export {
  CONTRACT_ADDRESS,
  activeChain,
  CompetitionType,
  COMPETITION_SYSTEM_ABI,
  getPublicClient,
  getCompetitionDetails,
  buyLuckyDipTickets,
  pickSpecificTickets,
  getWinners,
  didUserWin,
  getTicketOwner,
  getTicketAllocation,
  getInstantWinNumbers,
  COMPETITION_SYSTEM_CONTRACT
} from './competitionSystemV3';

export type {
  CompetitionDetails,
  PurchaseResult,
  InstantWinResult,
  WinnersResult
} from './competitionSystemV3';

// Re-export event utilities
export {
  useCompetitionEvents,
  useUserWinEvents,
  useTicketSalesEvents
} from './competitionEvents';

export type {
  // VRF v2.5 event types
  TicketsPurchasedEvent,
  CompetitionCreatedEvent,
  WinnersSetEvent,
  RequestedEvent,
  FulfilledEvent,
  // Legacy event types (kept for backward compatibility)
  InstantWinSeedSetEvent,
  DrawSeedSetEvent,
  InstantWinEvent,
  DrawResultEvent,
  CompetitionEventCallbacks
} from './competitionEvents';

// ============================================================================
// BACKWARD COMPATIBILITY LAYER
// The functions below maintain the old interface for existing code
// ============================================================================

import {
  CONTRACT_ADDRESS,
  activeChain,
  COMPETITION_SYSTEM_ABI,
  getPublicClient,
  getCompetitionDetails as getCompDetails,
  buyLuckyDipTickets as buyTickets,
  getTicketAllocation as getTicketAlloc
} from './competitionSystemV3';

// Legacy interface for CreateCompetitionResult (admin functions not exposed in new contract)
export interface CreateCompetitionResult {
  competitionId: number;
  txHash: Hash;
}

/**
 * @deprecated Use getCompetitionDetails instead
 * Get available tickets for a competition (backward compatibility)
 */
export async function getAvailableTickets(competitionId: number | bigint): Promise<number> {
  const details = await getCompDetails(competitionId);
  return details.available;
}

/**
 * Legacy export for the contract configuration
 * @deprecated Use COMPETITION_SYSTEM_CONTRACT instead
 */
export const LUCKY_DIP_CONTRACT = {
  address: CONTRACT_ADDRESS,
  abi: COMPETITION_SYSTEM_ABI,
  chain: activeChain
};

/**
 * @deprecated Admin functions are handled differently in CompetitionSystemV3
 * This function is kept for reference but should not be used
 */
export async function createCompetition(
  _walletClient: WalletClient,
  _totalTickets: number,
  _priceInETH: string
): Promise<CreateCompetitionResult> {
  throw new Error(
    'createCompetition is not available in CompetitionSystemV3. ' +
    'Use createRegularCompetition or createInstantWinCompetition admin functions instead.'
  );
}
