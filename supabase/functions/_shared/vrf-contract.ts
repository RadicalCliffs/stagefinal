/**
 * CompetitionVRF v2.5 Contract Definition for Supabase Edge Functions
 *
 * This is the source of truth for the VRF contract in Supabase edge functions.
 * Mirrors the contract definition in src/lib/vrf-contract.ts.
 *
 * Contract Address: 0x8ce54644e3313934D663c43Aea29641DFD8BcA1A
 * Network: Base Mainnet (Chain ID: 8453)
 */

import { parseAbi } from "npm:viem@2";

// Contract address on Base Mainnet
export const COMPETITION_VRF_ADDRESS = "0x8ce54644e3313934D663c43Aea29641DFD8BcA1A" as `0x${string}`;

// Network configuration
export const CONTRACT_CONFIG = {
  address: "0x8ce54644e3313934D663c43Aea29641DFD8BcA1A" as `0x${string}`,
  network: "base",
  chainId: 8453,
  rpcUrl: "https://base-rpc.publicnode.com",
  blockExplorer: "https://basescan.org"
};

// ABI for reading competition state (VRF v2.5)
export const READ_ABI = parseAbi([
  "function subscriptionId() view returns (uint256)",
  "function keyHash() view returns (bytes32)",
  "function callbackGasLimit() view returns (uint32)",
  "function requestConfirmations() view returns (uint16)",
  "function numWords() view returns (uint32)",
  "function lastRequestId() view returns (uint256)",
  "function lastRandomWords() view returns (uint256[])",
  "function getCompetition(uint256 competitionId) view returns (tuple(uint256 totalTickets,uint256 ticketsSold,uint256 pricePerTicketWei,uint256 endTime,bool active,bool drawn,uint8 numWinners,uint32 maxTicketsPerTx,uint256 totalCollectedWei))",
  "function getWinners(uint256 competitionId) view returns (uint256[] winningNumbers, address[] winners)",
  "function getTicketAllocation(uint256 competitionId, address user) view returns (uint256)",
  "function getInstantWinNumbers(uint256 competitionId) view returns (uint256[] winningNumbers)",
]);

// ABI for writing (user functions)
export const WRITE_ABI = parseAbi([
  "function buyTickets(uint256 competitionId, uint32 count) payable",
]);

// Combined ABI for convenience
export const COMPETITION_VRF_ABI = parseAbi([
  // VRF read functions
  "function subscriptionId() view returns (uint256)",
  "function keyHash() view returns (bytes32)",
  "function callbackGasLimit() view returns (uint32)",
  "function requestConfirmations() view returns (uint16)",
  "function numWords() view returns (uint32)",
  "function lastRequestId() view returns (uint256)",
  "function lastRandomWords() view returns (uint256[])",
  // Competition read functions
  "function getCompetition(uint256 competitionId) view returns (tuple(uint256 totalTickets,uint256 ticketsSold,uint256 pricePerTicketWei,uint256 endTime,bool active,bool drawn,uint8 numWinners,uint32 maxTicketsPerTx,uint256 totalCollectedWei))",
  "function getWinners(uint256 competitionId) view returns (uint256[] winningNumbers, address[] winners)",
  "function getTicketAllocation(uint256 competitionId, address user) view returns (uint256)",
  "function getInstantWinNumbers(uint256 competitionId) view returns (uint256[] winningNumbers)",
  // User functions
  "function buyTickets(uint256 competitionId, uint32 count) payable",
]);

/**
 * On-chain competition state (VRF v2.5 structure)
 */
export interface OnChainState {
  totalTickets: bigint;
  ticketsSold: bigint;
  pricePerTicketWei: bigint;
  endTime: bigint;
  active: boolean;
  drawn: boolean;
  numWinners: number;
  maxTicketsPerTx: number;
  totalCollectedWei: bigint;
}

/**
 * Parse raw contract result (tuple struct) to OnChainState
 */
export function parseCompetitionState(c: {
  totalTickets: bigint;
  ticketsSold: bigint;
  pricePerTicketWei: bigint;
  endTime: bigint;
  active: boolean;
  drawn: boolean;
  numWinners: number;
  maxTicketsPerTx: number;
  totalCollectedWei: bigint;
}): OnChainState {
  return {
    totalTickets: c.totalTickets,
    ticketsSold: c.ticketsSold,
    pricePerTicketWei: c.pricePerTicketWei,
    endTime: c.endTime,
    active: Boolean(c.active),
    drawn: Boolean(c.drawn),
    numWinners: Number(c.numWinners),
    maxTicketsPerTx: Number(c.maxTicketsPerTx),
    totalCollectedWei: c.totalCollectedWei,
  };
}
