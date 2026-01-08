/**
 * CompetitionVRF v2.5 Contract Definition - Source of Truth
 *
 * This is the SINGLE source of truth for the VRF-enabled Competition smart contract.
 * All other files in the codebase should import from this file.
 *
 * Contract Address: 0x8ce54644e3313934D663c43Aea29641DFD8BcA1A
 * Network: Base Mainnet (Chain ID: 8453)
 *
 * Key Features:
 * - VRF-based random winner selection via Chainlink VRF v2.5
 * - Ticket purchasing (buyTickets for sequential assignment)
 * - Competition lifecycle management
 * - Multi-winner support
 * - Instant win number support
 */

// Contract address on Base Mainnet
export const COMPETITION_VRF_ADDRESS = "0x8ce54644e3313934D663c43Aea29641DFD8BcA1A" as const;

// Network configuration
export const CONTRACT_CONFIG = {
  address: "0x8ce54644e3313934D663c43Aea29641DFD8BcA1A" as const,
  network: "base" as const,
  chainId: 8453,
  rpcUrl: "https://base-rpc.publicnode.com",
  blockExplorer: "https://basescan.org"
};

// Full ABI for the CompetitionVRF v2.5 contract
export const COMPETITION_VRF_ABI = [
  // ============================================================================
  // VRF Read Functions
  // ============================================================================

  /**
   * Get VRF subscription ID
   */
  {
    name: "subscriptionId",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },

  /**
   * Get VRF key hash
   */
  {
    name: "keyHash",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }]
  },

  /**
   * Get callback gas limit
   */
  {
    name: "callbackGasLimit",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint32" }]
  },

  /**
   * Get request confirmations
   */
  {
    name: "requestConfirmations",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }]
  },

  /**
   * Get number of words requested from VRF
   */
  {
    name: "numWords",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint32" }]
  },

  /**
   * Get last VRF request ID
   */
  {
    name: "lastRequestId",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },

  /**
   * Get last random words from VRF
   */
  {
    name: "lastRandomWords",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256[]" }]
  },

  // ============================================================================
  // Core Functions
  // ============================================================================

  /**
   * Buy tickets for a competition
   * Tickets are assigned sequentially starting from ticketsSold
   * @param competitionId - The competition to buy tickets for
   * @param count - Number of tickets to purchase
   */
  {
    name: "buyTickets",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "competitionId", type: "uint256" },
      { name: "count", type: "uint32" }
    ],
    outputs: []
  },

  // ============================================================================
  // View Functions
  // ============================================================================

  /**
   * Get competition details
   * @param competitionId - The competition to query
   * @returns Competition struct with all details
   */
  {
    name: "getCompetition",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "competitionId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "totalTickets", type: "uint256" },
          { name: "ticketsSold", type: "uint256" },
          { name: "pricePerTicketWei", type: "uint256" },
          { name: "endTime", type: "uint256" },
          { name: "active", type: "bool" },
          { name: "drawn", type: "bool" },
          { name: "numWinners", type: "uint8" },
          { name: "maxTicketsPerTx", type: "uint32" },
          { name: "totalCollectedWei", type: "uint256" }
        ]
      }
    ]
  },

  /**
   * Get winners for a drawn competition
   * @param competitionId - The competition to get winners for
   * @returns winningNumbers - Array of winning ticket numbers
   * @returns winners - Array of winner addresses
   */
  {
    name: "getWinners",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "competitionId", type: "uint256" }],
    outputs: [
      { name: "winningNumbers", type: "uint256[]" },
      { name: "winners", type: "address[]" }
    ]
  },

  /**
   * Get ticket allocation for a user in a competition
   * @param competitionId - The competition to query
   * @param user - The user address
   * @returns Number of tickets owned by user
   */
  {
    name: "getTicketAllocation",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "competitionId", type: "uint256" },
      { name: "user", type: "address" }
    ],
    outputs: [{ name: "", type: "uint256" }]
  },

  /**
   * Get instant win numbers for a competition
   * @param competitionId - The competition to query
   * @returns winningNumbers - Array of instant win ticket numbers
   */
  {
    name: "getInstantWinNumbers",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "competitionId", type: "uint256" }],
    outputs: [{ name: "winningNumbers", type: "uint256[]" }]
  },

  // ============================================================================
  // Events
  // ============================================================================

  /**
   * Emitted when tickets are purchased
   */
  {
    name: "TicketsPurchased",
    type: "event",
    inputs: [
      { name: "competitionId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "fromTicket", type: "uint256", indexed: false },
      { name: "count", type: "uint256", indexed: false }
    ]
  },

  /**
   * Emitted when a new competition is created
   */
  {
    name: "CompetitionCreated",
    type: "event",
    inputs: [
      { name: "competitionId", type: "uint256", indexed: true },
      { name: "totalTickets", type: "uint256", indexed: false },
      { name: "pricePerTicketWei", type: "uint256", indexed: false },
      { name: "endTime", type: "uint256", indexed: false },
      { name: "numWinners", type: "uint8", indexed: false },
      { name: "maxTicketsPerTx", type: "uint32", indexed: false }
    ]
  },

  /**
   * Emitted when winners are determined
   */
  {
    name: "WinnersSet",
    type: "event",
    inputs: [
      { name: "competitionId", type: "uint256", indexed: true },
      { name: "ticketNumbers", type: "uint256[]", indexed: false },
      { name: "winners", type: "address[]", indexed: false }
    ]
  },

  /**
   * Emitted when VRF randomness is requested
   */
  {
    name: "Requested",
    type: "event",
    inputs: [
      { name: "requestId", type: "uint256", indexed: false }
    ]
  },

  /**
   * Emitted when VRF randomness is fulfilled
   */
  {
    name: "Fulfilled",
    type: "event",
    inputs: [
      { name: "requestId", type: "uint256", indexed: false },
      { name: "randomWords", type: "uint256[]", indexed: false }
    ]
  }
] as const;

// ============================================================================
// TypeScript Types
// ============================================================================

/**
 * Competition struct as returned by the contract getCompetition function
 */
export type Competition = {
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

/**
 * Winners data as returned by getWinners
 */
export type Winners = {
  winningNumbers: readonly bigint[];
  winners: readonly `0x${string}`[];
};

/**
 * Competition details with computed fields for UI display
 */
export type CompetitionDetails = Competition & {
  id: number;
  available: number;
  pricePerTicketEth: string;
  totalPrizePool: string;
  endTimeDate: Date;
  isEnded: boolean;
  isReadyForDraw: boolean;
};

/**
 * VRF status information
 */
export type VRFStatus = {
  subscriptionId: string;
  lastRequestId: string;
  lastRandomWords: string[];
  hasRandomness: boolean;
  latestRandom: bigint | null;
};

// ============================================================================
// Contract Configuration Export
// ============================================================================

/**
 * Complete contract configuration for use with viem/wagmi
 */
export const COMPETITION_VRF_CONTRACT = {
  address: COMPETITION_VRF_ADDRESS,
  abi: COMPETITION_VRF_ABI,
} as const;

/**
 * Legacy alias for backward compatibility
 * @deprecated Use COMPETITION_VRF_ADDRESS instead
 */
export const CONTRACT_ADDRESS = COMPETITION_VRF_ADDRESS;

/**
 * Legacy alias for backward compatibility
 * @deprecated Use COMPETITION_VRF_ABI instead
 */
export const COMPETITION_SYSTEM_ABI = COMPETITION_VRF_ABI;
