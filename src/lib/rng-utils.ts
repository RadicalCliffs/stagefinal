/**
 * RNG Utilities - VRF-Based Random Number Generation with Fisher-Yates Shuffle
 *
 * This module provides cryptographically secure random number generation
 * using VRF (Verifiable Random Function) seeds with Fisher-Yates shuffle.
 *
 * KEY PRINCIPLE: For instant win competitions, winning tickets are determined
 * UPFRONT when the competition is created, using a VRF seed. This ensures:
 * - Provably fair: Anyone can verify randomness with the seed
 * - Guaranteed wins: If you buy all tickets, you win all prizes
 * - Tamper-proof: Winners cannot be changed after creation
 *
 * HOW VRF-BASED INSTANT WINS WORK:
 * 1. Competition is created with a VRF seed (from Chainlink or server-side VRF)
 * 2. Fisher-Yates shuffle is used with the seed to deterministically select winning tickets
 * 3. Winning ticket numbers are stored in Prize_Instantprizes table
 * 4. When a user purchases tickets, system checks if any match winning tickets
 * 5. If match found, user wins that prize immediately
 *
 * This guarantees: If you buy ALL tickets in a competition, you WILL win ALL prizes
 * because the winning tickets are fixed from the start.
 */

/**
 * VRF-based RNG using Fisher-Yates shuffle algorithm
 * This is the primary class for instant win ticket generation
 */
export class VRFRNG {
  /**
   * Create a seeded PRNG from a VRF seed (string or bigint)
   * Uses xorshift128+ for high-quality pseudo-random numbers
   *
   * @param seed - VRF seed (string, bigint, or number)
   * @returns A function that generates random numbers in [0, 1)
   */
  static createSeededRNG(seed: string | bigint | number): () => number {
    // Convert seed to a pair of 64-bit states for xorshift128+
    let state0: bigint;
    let state1: bigint;

    if (typeof seed === 'bigint') {
      // Use bigint directly - split into two 64-bit parts
      state0 = seed & BigInt('0xFFFFFFFFFFFFFFFF');
      state1 = (seed >> BigInt(64)) | BigInt(1); // Ensure non-zero
    } else if (typeof seed === 'number') {
      // Convert number to bigint
      state0 = BigInt(Math.floor(seed)) & BigInt('0xFFFFFFFFFFFFFFFF');
      state1 = BigInt(Math.floor(seed * 0x100000000)) | BigInt(1);
    } else {
      // Hash string to bigint using FNV-1a
      let hash0 = BigInt('14695981039346656037');
      let hash1 = BigInt('14695981039346656037');
      const fnvPrime = BigInt('1099511628211');

      for (let i = 0; i < seed.length; i++) {
        const byte = BigInt(seed.charCodeAt(i));
        if (i % 2 === 0) {
          hash0 ^= byte;
          hash0 = (hash0 * fnvPrime) & BigInt('0xFFFFFFFFFFFFFFFF');
        } else {
          hash1 ^= byte;
          hash1 = (hash1 * fnvPrime) & BigInt('0xFFFFFFFFFFFFFFFF');
        }
      }

      state0 = hash0 || BigInt(1);
      state1 = hash1 || BigInt(1);
    }

    // xorshift128+ algorithm for high-quality random numbers
    return () => {
      let s1 = state0;
      const s0 = state1;
      state0 = s0;
      s1 ^= s1 << BigInt(23);
      s1 ^= s1 >> BigInt(18);
      s1 ^= s0;
      s1 ^= s0 >> BigInt(5);
      state1 = s1;
      const result = (s0 + s1) & BigInt('0xFFFFFFFFFFFFFFFF');
      // Normalize to [0, 1)
      return Number(result) / Number(BigInt('0xFFFFFFFFFFFFFFFF'));
    };
  }

  /**
   * Fisher-Yates shuffle using VRF seed - THE CORE ALGORITHM
   *
   * This ensures deterministic, fair selection of winning tickets.
   * Given the same seed and total tickets, ALWAYS produces the same result.
   *
   * @param vrfSeed - The VRF seed (from Chainlink, contract, or database)
   * @param totalTickets - Total number of tickets in the competition
   * @param winningTicketCount - Number of winning tickets to select
   * @returns Array of winning ticket numbers (1-indexed)
   */
  static fisherYatesSelectWinners(
    vrfSeed: string | bigint | number,
    totalTickets: number,
    winningTicketCount: number
  ): number[] {
    if (winningTicketCount > totalTickets) {
      throw new Error(`Cannot select ${winningTicketCount} winners from ${totalTickets} tickets`);
    }

    if (totalTickets <= 0 || winningTicketCount <= 0) {
      throw new Error('Total tickets and winning ticket count must be positive');
    }

    const rng = this.createSeededRNG(vrfSeed);

    // Create array of all ticket numbers (1-indexed)
    const tickets: number[] = Array.from({ length: totalTickets }, (_, i) => i + 1);

    // Fisher-Yates shuffle - only shuffle as much as we need
    // We only need to shuffle the first `winningTicketCount` positions
    for (let i = 0; i < winningTicketCount; i++) {
      // Random index from i to end of array
      const j = i + Math.floor(rng() * (totalTickets - i));
      // Swap tickets[i] and tickets[j]
      [tickets[i], tickets[j]] = [tickets[j], tickets[i]];
    }

    // Return the first `winningTicketCount` tickets (these are the winners)
    return tickets.slice(0, winningTicketCount).sort((a, b) => a - b);
  }

  /**
   * Generate winning tickets for a competition using VRF seed
   *
   * This is the main entry point for instant win prize generation.
   * Results are deterministic and verifiable.
   *
   * @param competitionId - Competition UUID or identifier (used as seed if no VRF seed)
   * @param totalTickets - Total tickets in the competition
   * @param prizeConfig - Array of prizes with their counts
   * @param vrfSeed - Optional VRF seed (if not provided, competitionId is used)
   * @returns Object with winning tickets per prize tier and the seed used
   */
  static generateInstantWinTickets(
    competitionId: string,
    totalTickets: number,
    prizeConfig: Array<{ name: string; count: number; priority: number }>,
    vrfSeed?: string | bigint
  ): {
    winningTickets: Array<{ ticketNumber: number; prizeName: string; priority: number }>;
    seed: string;
    totalWinners: number;
    algorithm: string;
  } {
    const totalWinners = prizeConfig.reduce((sum, p) => sum + p.count, 0);

    if (totalWinners > totalTickets) {
      throw new Error(`Cannot have ${totalWinners} winners with only ${totalTickets} tickets`);
    }

    // Use VRF seed if provided, otherwise use competitionId
    const seedToUse = vrfSeed !== undefined ? vrfSeed : competitionId;
    const seedString = typeof seedToUse === 'bigint' ? seedToUse.toString() : String(seedToUse);

    // Generate all winning ticket numbers using Fisher-Yates
    const allWinningNumbers = this.fisherYatesSelectWinners(
      seedToUse,
      totalTickets,
      totalWinners
    );

    // Distribute winning tickets to prizes by priority
    const sortedPrizes = [...prizeConfig].sort((a, b) => a.priority - b.priority);
    const winningTickets: Array<{ ticketNumber: number; prizeName: string; priority: number }> = [];

    let ticketIndex = 0;
    for (const prize of sortedPrizes) {
      for (let i = 0; i < prize.count && ticketIndex < allWinningNumbers.length; i++) {
        winningTickets.push({
          ticketNumber: allWinningNumbers[ticketIndex],
          prizeName: prize.name,
          priority: prize.priority,
        });
        ticketIndex++;
      }
    }

    return {
      winningTickets: winningTickets.sort((a, b) => a.ticketNumber - b.ticketNumber),
      seed: seedString,
      totalWinners,
      algorithm: 'VRF-Fisher-Yates-xorshift128+',
    };
  }

  /**
   * Verify that a set of winning tickets was generated from a specific seed
   *
   * This allows anyone to verify the fairness of the draw.
   *
   * @param vrfSeed - The VRF seed to verify against
   * @param totalTickets - Total tickets in the competition
   * @param winningTicketCount - Number of winners to verify
   * @param claimedWinners - The winning tickets to verify
   * @returns Whether the winning tickets match the seed
   */
  static verifyWinningTickets(
    vrfSeed: string | bigint | number,
    totalTickets: number,
    winningTicketCount: number,
    claimedWinners: number[]
  ): boolean {
    const expectedWinners = this.fisherYatesSelectWinners(vrfSeed, totalTickets, winningTicketCount);
    const sortedClaimed = [...claimedWinners].sort((a, b) => a - b);

    if (expectedWinners.length !== sortedClaimed.length) {
      return false;
    }

    return expectedWinners.every((ticket, index) => ticket === sortedClaimed[index]);
  }

  /**
   * Generate a server-side VRF seed
   *
   * This creates a cryptographically secure seed that can be used
   * when on-chain VRF is not available.
   *
   * @returns A 256-bit VRF seed as a hex string
   */
  static generateServerVRFSeed(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
}

/**
 * StagingRNG - Backward compatible class (uses VRFRNG internally)
 *
 * Provides the same interface as before but with improved implementation
 */
export class StagingRNG {
  private static generateSecureRandom(): number {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    return array[0] / (0xFFFFFFFF + 1);
  }

  /**
   * Seeded PRNG using xorshift algorithm
   * Now uses VRFRNG internally for better quality
   */
  static createSeededRNG(seed: string): () => number {
    return VRFRNG.createSeededRNG(seed);
  }

  /**
   * Generate winning tickets using VRF-based Fisher-Yates shuffle
   * This replaces the old collision-based approach with proper shuffling
   */
  static generateSeededWinningTickets(
    competitionUid: string,
    totalTickets: number,
    winningTicketCount: number
  ): number[] {
    // Use VRFRNG's Fisher-Yates implementation
    return VRFRNG.fisherYatesSelectWinners(competitionUid, totalTickets, winningTicketCount);
  }

  /**
   * Select winning tickets using cryptographically secure randomness
   */
  static selectWinningTickets(
    totalTickets: number,
    winningTicketCount: number,
    seed?: string
  ): number[] {
    if (winningTicketCount > totalTickets) {
      throw new Error('Cannot select more winning tickets than total tickets');
    }

    // If seed provided, use deterministic selection
    if (seed) {
      return VRFRNG.fisherYatesSelectWinners(seed, totalTickets, winningTicketCount);
    }

    // Otherwise use crypto random for server-side selection
    const newSeed = VRFRNG.generateServerVRFSeed();
    return VRFRNG.fisherYatesSelectWinners(newSeed, totalTickets, winningTicketCount);
  }

  /**
   * Select a single winner using cryptographic randomness
   */
  static selectSingleWinner(totalTickets: number): number {
    const randomNumber = this.generateSecureRandom();
    return Math.floor(randomNumber * totalTickets) + 1;
  }

  /**
   * Select a random winner from a list of purchased tickets
   */
  static selectWinnerFromPurchasedTickets(purchasedTicketNumbers: number[]): number {
    if (purchasedTicketNumbers.length === 0) {
      throw new Error('Cannot select winner from empty ticket list');
    }
    const randomNumber = this.generateSecureRandom();
    const randomIndex = Math.floor(randomNumber * purchasedTicketNumbers.length);
    return purchasedTicketNumbers[randomIndex];
  }

  /**
   * Distribute winners across prize tiers
   */
  static distributeWinnersAcrossPrizes(
    totalTickets: number,
    prizes: Array<{ prize: string; count: number }>
  ): Map<string, number[]> {
    const totalWinners = prizes.reduce((sum, p) => sum + p.count, 0);

    if (totalWinners > totalTickets) {
      throw new Error('Total winners exceeds total tickets');
    }

    const allWinningTickets = this.selectWinningTickets(totalTickets, totalWinners);
    const distribution = new Map<string, number[]>();

    let currentIndex = 0;
    for (const prize of prizes) {
      const prizeWinners = allWinningTickets.slice(currentIndex, currentIndex + prize.count);
      distribution.set(prize.prize, prizeWinners);
      currentIndex += prize.count;
    }

    return distribution;
  }
}

export interface TicketPurchase {
  competitionId: string;
  userId: string;
  ticketNumbers: number[];
  purchaseDate: Date;
}

/**
 * VRFResult - Structure for storing VRF results in database
 */
export interface VRFResult {
  competitionId: string;
  vrfSeed: string;
  winningTickets: number[];
  generatedAt: string;
  algorithm: string;
  verified: boolean;
}

/**
 * TicketManager - Helper for ticket management
 */
export class TicketManager {
  private static ticketInventory = new Map<string, Set<number>>();

  static initializeCompetition(competitionId: string, totalTickets: number): void {
    const availableTickets = new Set<number>();
    for (let i = 1; i <= totalTickets; i++) {
      availableTickets.add(i);
    }
    this.ticketInventory.set(competitionId, availableTickets);
  }

  static getAvailableTickets(competitionId: string): number[] {
    const tickets = this.ticketInventory.get(competitionId);
    return tickets ? Array.from(tickets).sort((a, b) => a - b) : [];
  }

  static reserveTickets(competitionId: string, ticketNumbers: number[]): boolean {
    const availableTickets = this.ticketInventory.get(competitionId);
    if (!availableTickets) return false;

    for (const ticket of ticketNumbers) {
      if (!availableTickets.has(ticket)) {
        return false;
      }
    }

    for (const ticket of ticketNumbers) {
      availableTickets.delete(ticket);
    }

    return true;
  }

  static isInventoryExhausted(competitionId: string): boolean {
    const tickets = this.ticketInventory.get(competitionId);
    return !tickets || tickets.size === 0;
  }
}
