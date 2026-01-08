/**
 * Canonical User ID Utility for Netlify Functions
 *
 * This module provides utilities for converting all user identifiers to a
 * canonical, case-insensitive format: prize:pid:<id>
 *
 * Usage in Netlify Functions:
 * ```typescript
 * import { toPrizePid, validateCanonicalUserId, userIdsEqual } from "./_shared/userId.mts";
 *
 * const prizePid = toPrizePid(inputUserId);
 * validateCanonicalUserId(prizePid); // Throws if not canonical
 * ```
 */

/**
 * Checks if a string is a valid Ethereum wallet address
 */
export function isWalletAddress(identifier: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(identifier);
}

/**
 * Checks if a string is already in prize:pid: format
 */
export function isPrizePid(identifier: string): boolean {
  return identifier.startsWith('prize:pid:');
}

/**
 * Extracts the actual ID from a prize:pid: formatted string
 * Returns the ID without the prize:pid: prefix
 */
export function extractPrizePid(prizePid: string): string {
  if (!isPrizePid(prizePid)) {
    return prizePid;
  }
  return prizePid.substring('prize:pid:'.length);
}

/**
 * Generate a UUID v4
 * Returns a string in the format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 */
function generateUuid(): string {
  return crypto.randomUUID();
}

/**
 * Returns a canonical user ID in the form of:
 * - For wallets: prize:pid:<wallet in lowercase>
 * - For UUIDs: prize:pid:<uuid>
 * - For legacy IDs: prize:pid:<uuid> (generates new UUID)
 * - For existing prize:pid: IDs: returns as-is (normalized)
 *
 * This function ensures all user identifiers are in a consistent,
 * case-insensitive format.
 *
 * @param inputUserId - Any user identifier (wallet, email, UUID, Privy DID, etc.)
 * @returns Canonical prize:pid: formatted user ID
 */
export function toPrizePid(inputUserId: string | null | undefined): string {
  // Handle null/undefined/empty
  if (!inputUserId || inputUserId.trim() === '') {
    // Generate a new UUID for completely missing identifiers
    return `prize:pid:${generateUuid()}`;
  }

  const trimmedId = inputUserId.trim();

  // Already in prize:pid: format - normalize and return
  if (isPrizePid(trimmedId)) {
    const extracted = extractPrizePid(trimmedId);
    // If it's a wallet address, ensure lowercase
    if (isWalletAddress(extracted)) {
      return `prize:pid:${extracted.toLowerCase()}`;
    }
    return trimmedId.toLowerCase();
  }

  // Wallet address - normalize to lowercase
  if (isWalletAddress(trimmedId)) {
    return `prize:pid:${trimmedId.toLowerCase()}`;
  }

  // Check if it's a UUID pattern
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidPattern.test(trimmedId)) {
    return `prize:pid:${trimmedId.toLowerCase()}`;
  }

  // Check if it's a Privy DID (legacy) - convert to new format with UUID
  if (trimmedId.startsWith('did:privy:')) {
    // Generate deterministic UUID from Privy DID to maintain consistency
    // Use the part after "did:privy:" as a base
    const privyPart = trimmedId.substring('did:privy:'.length);
    // For now, use the privy part as-is if it looks like a UUID
    if (uuidPattern.test(privyPart)) {
      return `prize:pid:${privyPart.toLowerCase()}`;
    }
    // Otherwise generate a new UUID
    return `prize:pid:${generateUuid()}`;
  }

  // For email addresses or other identifiers, generate a new UUID
  // In production, you might want to look up existing mappings first
  return `prize:pid:${generateUuid()}`;
}

/**
 * Validates that a user ID is in canonical prize:pid: format
 * Throws an error if not canonical
 */
export function validateCanonicalUserId(userId: string): void {
  if (!isPrizePid(userId)) {
    throw new Error(`User identity must be canonical: prize:pid format required. Got: ${userId}`);
  }
}

/**
 * Compares two user IDs for equality in a case-insensitive manner
 * Handles both canonical and non-canonical formats
 */
export function userIdsEqual(id1: string | null | undefined, id2: string | null | undefined): boolean {
  if (!id1 || !id2) return false;

  const canonical1 = toPrizePid(id1);
  const canonical2 = toPrizePid(id2);

  return canonical1.toLowerCase() === canonical2.toLowerCase();
}

/**
 * Normalize a wallet address to lowercase for case-insensitive comparison
 * Returns null if input is null/undefined
 */
export function normalizeWalletAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const trimmed = address.trim();
  if (isWalletAddress(trimmed)) {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

/**
 * Helper to normalize user ID for database operations
 * Always converts to prize:pid: format and logs the conversion
 */
export function normalizeUserId(userId: string | null | undefined, context: string = ''): string {
  const canonicalId = toPrizePid(userId);

  if (userId && userId !== canonicalId) {
    console.log(`[${context}] Normalized user ID: ${userId} -> ${canonicalId}`);
  }

  return canonicalId;
}

export default {
  toPrizePid,
  isPrizePid,
  extractPrizePid,
  validateCanonicalUserId,
  userIdsEqual,
  isWalletAddress,
  normalizeWalletAddress,
  normalizeUserId,
};
