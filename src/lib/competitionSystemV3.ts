/**
 * CompetitionSystemV3 Contract Integration
 *
 * This module provides functions to interact with the CompetitionVRF v2.5 smart contract
 * deployed on Base network.
 *
 * Contract: 0x8ce54644e3313934D663c43Aea29641DFD8BcA1A (Base Mainnet)
 * See: src/lib/vrf-contract.ts for the source of truth
 *
 * Key features:
 * - VRF-based winner selection via Chainlink VRF v2.5
 * - Ticket purchasing (buyTickets for sequential assignment)
 * - Competition lifecycle management
 * - Multi-winner support
 * - Ticket allocation tracking per user
 *
 * Integration with Privy:
 * - Uses Privy wallet provider for signing transactions
 * - Supports embedded wallets, MetaMask, Coinbase Wallet, etc.
 */

import { createPublicClient, http, formatEther, decodeEventLog } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import type { WalletClient, PublicClient, Hash, TransactionReceipt, Address } from 'viem';

// Import from the centralized VRF contract source of truth
import {
  COMPETITION_VRF_ADDRESS,
  COMPETITION_VRF_ABI,
  type Competition as VRFCompetition,
  type Winners as VRFWinners
} from './vrf-contract';

// Re-export the contract address for backward compatibility
export const CONTRACT_ADDRESS = COMPETITION_VRF_ADDRESS;

// Determine which chain to use based on environment
const isBaseMainnet = typeof import.meta !== 'undefined' && import.meta.env?.VITE_BASE_MAINNET === 'true';
export const activeChain = isBaseMainnet ? base : baseSepolia;

// RPC URL for the active chain - must be whitelisted in CSP (public/_headers)
// Using explicit URLs prevents viem from falling back to RPCs like eth.merkle.io
const activeRpcUrl = isBaseMainnet ? 'https://mainnet.base.org' : 'https://sepolia.base.org';

// Competition types enum - the new VRF contract is simpler (no instant win type)
const CompetitionType = {
  REGULAR: 0,
  INSTANT_WIN: 1 // Legacy - kept for backward compatibility but not used in new contract
} as const;

export { CompetitionType };
export type CompetitionTypeValue = typeof CompetitionType[keyof typeof CompetitionType];

// Re-export the ABI for backward compatibility
export const COMPETITION_SYSTEM_ABI = COMPETITION_VRF_ABI;

// TypeScript interfaces for return values
export interface CompetitionDetails {
  compType: CompetitionTypeValue;
  totalTickets: number;
  ticketsSold: number;
  pricePerTicket: string;
  pricePerTicketWei: bigint;
  endTime: number;
  active: boolean;
  drawn: boolean;
  numWinners: number;
  maxTicketsPerTx: number;
  totalCollectedWei: bigint;
  totalPrizePool: string;
  available: number;
  isInstantWin: boolean;
  seedReady: boolean;
  // Legacy field for backward compatibility
  instantWinSeed: string;
  drawSeed: string;
}

export interface PurchaseResult {
  ticketNumbers: number[];
  txHash: Hash;
  totalPaid: string;
  buyerAddress: string;
  instantWins: InstantWinResult[];
}

export interface InstantWinResult {
  ticketNumber: number;
  tierId: string;
}

export interface WinnersResult {
  winningNumbers: number[];
  winners: Address[];
}

export interface DrawResultEvent {
  competitionId: number;
  drawIndex: number;
  winningNumber: number;
  winner: Address;
  sold: boolean;
}

/**
 * Create a public client for reading contract state (no wallet needed)
 * Uses explicit RPC URL to avoid CSP issues with fallback RPCs
 */
export function getPublicClient(): PublicClient {
  return createPublicClient({
    chain: activeChain,
    transport: http(activeRpcUrl)
  }) as any;
}

/**
 * Get competition details from the smart contract
 *
 * @param competitionId - The on-chain competition ID
 * @returns Competition details including prices, availability, and VRF status
 */
export async function getCompetitionDetails(competitionId: number | bigint): Promise<CompetitionDetails> {
  const publicClient = getPublicClient();

  // Use the new getCompetition function which returns a tuple struct
  const comp = await publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi: COMPETITION_SYSTEM_ABI,
    functionName: 'getCompetition',
    args: [BigInt(competitionId)]
  }) as {
    totalTickets: bigint;
    ticketsSold: bigint;
    pricePerTicketWei: bigint;
    endTime: bigint;
    active: boolean;
    drawn: boolean;
    numWinners: number;
    maxTicketsPerTx: number;
    totalCollectedWei: bigint;
  };

  // The new contract is REGULAR type only (no instant win support in this contract)
  const compType = CompetitionType.REGULAR;
  const isInstantWin = false;
  const seedReady = true; // VRF seed is always ready for regular competitions

  return {
    compType,
    totalTickets: Number(comp.totalTickets),
    ticketsSold: Number(comp.ticketsSold),
    pricePerTicket: formatEther(comp.pricePerTicketWei),
    pricePerTicketWei: comp.pricePerTicketWei,
    endTime: Number(comp.endTime),
    active: comp.active,
    drawn: comp.drawn,
    numWinners: Number(comp.numWinners),
    maxTicketsPerTx: Number(comp.maxTicketsPerTx),
    totalCollectedWei: comp.totalCollectedWei,
    totalPrizePool: formatEther(comp.totalCollectedWei),
    available: Number(comp.totalTickets - comp.ticketsSold),
    isInstantWin,
    seedReady,
    // Legacy fields for backward compatibility
    instantWinSeed: "0",
    drawSeed: "0"
  };
}

/**
 * Buy tickets for a competition
 *
 * Tickets are assigned sequentially by the contract starting from ticketsSold.
 * This is equivalent to a "lucky dip" as you get the next available tickets.
 *
 * @param walletClient - viem WalletClient created from Privy wallet provider
 * @param competitionId - The on-chain competition ID
 * @param numTickets - Number of tickets to purchase
 * @returns Purchase result with ticket numbers, transaction hash
 */
export async function buyLuckyDipTickets(
  walletClient: WalletClient,
  competitionId: number | bigint,
  numTickets: number
): Promise<PurchaseResult> {
  if (!walletClient) {
    throw new Error("Wallet not connected");
  }

  const publicClient = getPublicClient();

  // Get user's address from wallet
  const [account] = await walletClient.getAddresses();
  if (!account) {
    throw new Error("No account found in wallet");
  }

  // Get competition details to calculate cost
  const comp = await getCompetitionDetails(competitionId);

  if (!comp.active) {
    throw new Error("Competition is not active");
  }

  if (numTickets > comp.maxTicketsPerTx) {
    throw new Error(`Maximum ${comp.maxTicketsPerTx} tickets per transaction`);
  }

  if (numTickets > comp.available) {
    throw new Error(`Only ${comp.available} tickets available`);
  }

  const totalCost = comp.pricePerTicketWei * BigInt(numTickets);

  // The first ticket number will be ticketsSold (0-indexed)
  const startTicket = comp.ticketsSold;

  // Write to contract using Privy wallet - use buyTickets for the new VRF contract
  const hash = await walletClient.writeContract({
    address: CONTRACT_ADDRESS,
    abi: COMPETITION_SYSTEM_ABI,
    functionName: 'buyTickets',
    args: [BigInt(competitionId), numTickets],
    value: totalCost,
    account,
    chain: activeChain
  });

  // Wait for transaction confirmation
  const receipt: TransactionReceipt = await publicClient.waitForTransactionReceipt({ hash });

  // Parse logs to get ticket numbers from TicketsPurchased event
  const ticketNumbers: number[] = [];
  const instantWins: InstantWinResult[] = []; // Always empty for new contract

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) continue;

    try {
      const decodedLog = decodeEventLog({
        abi: COMPETITION_SYSTEM_ABI,
        data: log.data,
        topics: log.topics
      });

      if (decodedLog.eventName === 'TicketsPurchased') {
        // New contract emits fromTicket and count, not an array of ticket numbers
        const args = decodedLog.args as any;
        if (args.fromTicket !== undefined && args.count !== undefined) {
          const from = Number(args.fromTicket);
          for (let i = 0; i < Number(args.count); i++) {
            ticketNumbers.push(from + i);
          }
        }
      }
    } catch {
      // Skip logs that don't match our ABI
    }
  }

  // If we couldn't decode from event, calculate from known start position
  if (ticketNumbers.length === 0) {
    for (let i = 0; i < numTickets; i++) {
      ticketNumbers.push(startTicket + i);
    }
  }

  return {
    ticketNumbers,
    txHash: receipt.transactionHash,
    totalPaid: formatEther(totalCost),
    buyerAddress: account,
    instantWins // Always empty for new contract
  };
}

/**
 * Pick specific ticket numbers
 *
 * NOTE: The new VRF contract does not support manual ticket picking.
 * Tickets are assigned sequentially via buyTickets.
 * This function is kept for backward compatibility but will throw an error.
 *
 * @deprecated Use buyLuckyDipTickets instead - the new contract assigns tickets sequentially
 * @param walletClient - viem WalletClient
 * @param competitionId - The on-chain competition ID
 * @param ticketNumbers - Array of specific ticket numbers to purchase
 * @throws Error - Always throws as manual picking is not supported
 */
export async function pickSpecificTickets(
  _walletClient: WalletClient,
  _competitionId: number | bigint,
  _ticketNumbers: number[]
): Promise<PurchaseResult> {
  throw new Error(
    "Manual ticket picking is not supported in the new VRF contract. " +
    "The contract uses sequential ticket assignment. Use buyLuckyDipTickets instead."
  );
}

/**
 * Get winners for a competition
 *
 * @param competitionId - The on-chain competition ID
 * @returns Winning ticket numbers and their owners
 */
export async function getWinners(competitionId: number | bigint): Promise<WinnersResult> {
  const publicClient = getPublicClient();

  const [winningNumbers, winners] = await publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi: COMPETITION_SYSTEM_ABI,
    functionName: 'getWinners',
    args: [BigInt(competitionId)]
  });

  return {
    winningNumbers: winningNumbers.map((n: bigint) => Number(n)),
    winners: winners as Address[]
  };
}

/**
 * Check if a specific user won in a competition
 *
 * @param competitionId - The on-chain competition ID
 * @param userAddress - The user's wallet address
 * @returns Whether the user won and their winning ticket numbers
 */
export async function didUserWin(
  competitionId: number | bigint,
  userAddress: string
): Promise<{ won: boolean; winningTickets: number[] }> {
  try {
    const { winningNumbers, winners } = await getWinners(competitionId);

    const myWins: number[] = [];
    winners.forEach((winner, i) => {
      if (winner.toLowerCase() === userAddress.toLowerCase()) {
        myWins.push(winningNumbers[i]);
      }
    });

    return {
      won: myWins.length > 0,
      winningTickets: myWins
    };
  } catch {
    return { won: false, winningTickets: [] };
  }
}

/**
 * Get the owner of a specific ticket
 *
 * NOTE: The new VRF contract does not expose a getTicketOwner function.
 * This function is kept for backward compatibility but will always throw.
 *
 * @deprecated The new contract does not support querying individual ticket owners
 * @param competitionId - The on-chain competition ID
 * @param ticketNumber - The ticket number to check
 * @throws Error - Always throws as this function is not supported
 */
export async function getTicketOwner(
  _competitionId: number | bigint,
  _ticketNumber: number
): Promise<Address> {
  throw new Error(
    "getTicketOwner is not supported in the new VRF contract. " +
    "Winners can be queried via getWinners after the draw is complete."
  );
}

/**
 * Get the number of tickets a user owns in a competition
 *
 * @param competitionId - The on-chain competition ID
 * @param userAddress - The user's wallet address
 * @returns Number of tickets the user owns
 */
export async function getTicketAllocation(
  competitionId: number | bigint,
  userAddress: string
): Promise<number> {
  const publicClient = getPublicClient();

  const allocation = await publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi: COMPETITION_SYSTEM_ABI,
    functionName: 'getTicketAllocation',
    args: [BigInt(competitionId), userAddress as Address]
  }) as bigint;

  return Number(allocation);
}

/**
 * Get instant win numbers for a competition
 *
 * @param competitionId - The on-chain competition ID
 * @returns Array of instant win ticket numbers
 */
export async function getInstantWinNumbers(
  competitionId: number | bigint
): Promise<number[]> {
  const publicClient = getPublicClient();

  const winningNumbers = await publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi: COMPETITION_SYSTEM_ABI,
    functionName: 'getInstantWinNumbers',
    args: [BigInt(competitionId)]
  }) as bigint[];

  return winningNumbers.map(n => Number(n));
}

// Export the contract configuration for external use
export const COMPETITION_SYSTEM_CONTRACT = {
  address: CONTRACT_ADDRESS,
  abi: COMPETITION_SYSTEM_ABI,
  chain: activeChain
};
