/**
 * User Identity Resolution Module
 *
 * This module provides a unified interface for resolving user identities across
 * multiple identifier types (wallet_address, canonical_user_id, privy_user_id, userid).
 *
 * UPDATED: Now uses canonical prize:pid: format as the primary identifier.
 * FIXES: Issue #1 - Multi-Source User Identity Resolution Without Atomic Reconciliation
 * FIXES: Issue #2 - Case-insensitive wallet address matching
 */

import { supabase } from './supabase';
import { toPrizePid, isPrizePid, normalizeWalletAddress as normWallet, isWalletAddress as isWallet } from '../utils/userId';

export interface ResolvedIdentity {
  /** Primary identifier - now in canonical prize:pid: format */
  primaryId: string;
  /** Canonical user ID in prize:pid: format */
  canonicalUserId: string;
  /** Wallet address (0x...) if available - ALWAYS stored in lowercase */
  walletAddress: string | null;
  /** Privy user ID (DID format) - LEGACY, being phased out */
  privyUserId: string | null;
  /** Legacy user ID */
  legacyUserId: string | null;
  /** All known identifiers for this user */
  allIdentifiers: string[];
  /** Email associated with the user */
  email: string | null;
  /** User profile record from canonical_users */
  profile: any | null;
}

/**
 * Checks if a string is a valid Ethereum wallet address
 */
export function isWalletAddress(identifier: string): boolean {
  return isWallet(identifier);
}

/**
 * Normalizes a wallet address to lowercase for consistent comparison
 */
export function normalizeWalletAddress(address: string): string {
  return normWallet(address) || address;
}

/**
 * Checks if a string is a Privy DID
 * @deprecated Use isPrizePid() instead to check for canonical format
 */
export function isPrivyDid(identifier: string): boolean {
  return identifier.startsWith('did:privy:');
}

/**
 * Generate a deterministic Privy-style user ID from a wallet address.
 * @deprecated This function is being phased out and will be removed after
 *             2025-12-31. New code MUST NOT use this helper. Instead, call
 *             `toPrizePid(walletAddress)` and persist/use the returned
 *             prize:pid: identifier as the primary user key.
 *
 *             For remaining internal usages (including legacy callers in this
 *             module), first migrate storage and lookups to use the canonical
 *             `canonicalUserId` produced by `toPrizePid()`. Only call
 *             `generatePrivyStyleId()` when a synthetic `privy_user_id` is
 *             still required for backward compatibility with existing
 *             `canonical_users` or other legacy tables. Once all
 *             legacy `privy_user_id` usage has been removed, delete those
 *             calls and this function.
 *
 * This creates a fake but realistic Privy DID for users who authenticate
 * via Base wallet or other methods that don't provide a native Privy ID.
 *
 * Format: did:privy:base_{timestamp_hash}_{address_suffix}
 * The format mimics real Privy DIDs which use alphanumeric strings.
 *
 * IMPORTANT: This is deterministic - the same wallet address always
 * generates the same privy_user_id, ensuring data consistency.
 *
 * @param walletAddress - Ethereum wallet address (0x...)
 * @returns A Privy-style DID string
 */
export function generatePrivyStyleId(walletAddress: string): string {
  if (!isWalletAddress(walletAddress)) {
    throw new Error(`Invalid wallet address: ${walletAddress}`);
  }

  // Normalize to lowercase for consistency
  const normalized = walletAddress.toLowerCase();

  // Extract meaningful parts of the address (skip 0x prefix)
  const addressPart = normalized.slice(2);

  // Create a deterministic hash-like string from the full address
  // Use different parts of the address to create variety like real Privy IDs
  // Real Privy DIDs look like: did:privy:cm4x7abc123def456
  const part1 = addressPart.slice(0, 8);   // First 8 chars
  const part2 = addressPart.slice(16, 24); // Middle 8 chars
  const part3 = addressPart.slice(-8);     // Last 8 chars

  // Combine to create a 24-char alphanumeric ID similar to real Privy IDs
  // Prefix with 'clw' to make it look like a real Privy CUID (they often start with 'c')
  return `did:privy:clw${part1}${part2}${part3}`;
}

/**
 * Resolves a user identifier to a complete identity with all known identifiers.
 * This ensures consistent data retrieval across all tables regardless of which
 * identifier type is stored.
 *
 * UPDATED: Now returns canonical prize:pid: format as primaryId
 * MIGRATION APPLIED: canonical_user_id column now exists in canonical_users table
 *
 * @param identifier - Any user identifier (wallet address, prize:pid, privy_user_id, or legacy userid)
 * @returns ResolvedIdentity with all known identifiers for the user, including canonical ID
 */
export async function resolveUserIdentity(identifier: string | null | undefined): Promise<ResolvedIdentity | null> {
  if (!identifier || identifier.trim() === '') {
    return null;
  }

  const trimmedId = identifier.trim();
  
  // Convert to canonical format for consistent lookup
  const canonicalId = toPrizePid(trimmedId);

  try {
    // Build query based on identifier type
    // Priority: canonical_user_id > wallet_address > privy_user_id > uid
    let data: any = null;
    let error: any = null;

    if (isWalletAddress(trimmedId)) {
      // Normalize wallet address to lowercase for case-insensitive comparison
      const normalizedAddress = trimmedId.toLowerCase();

      // Query by canonical_user_id first, then wallet addresses
      // The canonical_user_id column now exists after migration 20260114120000
      // Use limit(1) instead of maybeSingle() to avoid PGRST116 error when multiple rows match
      const result = await supabase
        .from('canonical_users')
        .select('*')
        .or(`canonical_user_id.eq.${canonicalId},wallet_address.ilike.${normalizedAddress},base_wallet_address.ilike.${normalizedAddress}`)
        .order('created_at', { ascending: false }) // Get the most recent record if duplicates exist
        .limit(1);

      data = result.data?.[0] || null;
      error = result.error;
    } else if (isPrizePid(trimmedId)) {
      // Prize PID format - query by canonical_user_id first
      // Format: prize:pid:0x... or prize:pid:<uuid>
      const idPart = trimmedId.substring(10); // Remove "prize:pid:" prefix

      // Try canonical_user_id first (most efficient)
      let result = await supabase
        .from('canonical_users')
        .select('*')
        .eq('canonical_user_id', trimmedId)
        .limit(1);

      data = result.data?.[0] || null;
      
      // If not found by canonical_user_id, try the extracted part
      if (!data) {
        if (isWalletAddress(idPart)) {
          // Extract wallet address from prize:pid:0x... format
          const normalizedAddress = idPart.toLowerCase();
          result = await supabase
            .from('canonical_users')
            .select('*')
            .or(`canonical_user_id.eq.${trimmedId},wallet_address.ilike.${normalizedAddress},base_wallet_address.ilike.${normalizedAddress}`)
            .order('created_at', { ascending: false })
            .limit(1);

          data = result.data?.[0] || null;
        } else {
          // UUID-based prize:pid - try to match by uid or canonical_user_id
          result = await supabase
            .from('canonical_users')
            .select('*')
            .or(`canonical_user_id.eq.${trimmedId},uid.eq.${idPart}`)
            .limit(1);

          data = result.data?.[0] || null;
        }
      }
      error = result.error;
    } else if (isPrivyDid(trimmedId)) {
      // Query by Privy DID (legacy) - use limit(1) for safety
      // NOTE: Privy is being phased out, but we still support legacy lookups
      const result = await supabase
        .from('canonical_users')
        .select('*')
        .eq('privy_user_id', trimmedId)
        .limit(1);

      data = result.data?.[0] || null;
      error = result.error;
    } else {
      // Query by legacy uid - use limit(1) for safety
      const result = await supabase
        .from('canonical_users')
        .select('*')
        .eq('uid', trimmedId)
        .limit(1);

      data = result.data?.[0] || null;
      error = result.error;
    }

    if (error) {
      console.error('Error resolving user identity:', error);
      // Return partial identity with just the provided identifier
      return createPartialIdentity(trimmedId, canonicalId);
    }

    const profile = data;

    if (!profile) {
      // No profile found, return partial identity
      return createPartialIdentity(trimmedId, canonicalId);
    }

    // Build complete identity from profile
    // Normalize all wallet addresses to lowercase for consistent comparison
    const allIdentifiers: string[] = [];

    const normalizedWalletAddress = profile.wallet_address ? normalizeWalletAddress(profile.wallet_address) : null;
    const normalizedBaseWalletAddress = profile.base_wallet_address ? normalizeWalletAddress(profile.base_wallet_address) : null;

    // Add canonical ID first (highest priority)
    const profileCanonicalId = profile.canonical_user_id || canonicalId;
    allIdentifiers.push(profileCanonicalId);

    if (normalizedWalletAddress) allIdentifiers.push(normalizedWalletAddress);
    if (normalizedBaseWalletAddress && normalizedBaseWalletAddress !== normalizedWalletAddress) {
      allIdentifiers.push(normalizedBaseWalletAddress);
    }
    if (profile.privy_user_id) allIdentifiers.push(profile.privy_user_id);
    if (profile.uid) allIdentifiers.push(profile.uid);

    // Determine primary ID - now uses canonical format
    const primaryId = profileCanonicalId;

    return {
      primaryId,
      canonicalUserId: profileCanonicalId,
      walletAddress: normalizedWalletAddress || normalizedBaseWalletAddress,
      privyUserId: profile.privy_user_id || null,
      legacyUserId: profile.uid || null,
      allIdentifiers: [...new Set(allIdentifiers)], // Remove duplicates
      email: profile.email || null,
      profile,
    };
  } catch (err) {
    console.error('Exception resolving user identity:', err);
    return createPartialIdentity(trimmedId, canonicalId);
  }
}

/**
 * Creates a partial identity when no profile is found
 * Now includes canonical prize:pid: format
 */
function createPartialIdentity(identifier: string, canonicalId?: string): ResolvedIdentity {
  const isWallet = isWalletAddress(identifier);
  const isPrivy = isPrivyDid(identifier);
  const isPrize = isPrizePid(identifier);
  
  // Always normalize wallet addresses to lowercase
  const normalizedIdentifier = isWallet ? identifier.toLowerCase() : identifier;
  
  // Use provided canonical ID or generate one
  const canonical = canonicalId || toPrizePid(identifier);

  return {
    primaryId: canonical,
    canonicalUserId: canonical,
    walletAddress: isWallet ? normalizedIdentifier : null,
    privyUserId: isPrivy ? identifier : null,
    legacyUserId: !isWallet && !isPrivy && !isPrize ? identifier : null,
    allIdentifiers: [canonical, normalizedIdentifier].filter((v, i, a) => v && a.indexOf(v) === i),
    email: null,
    profile: null,
  };
}

/**
 * Builds a Supabase OR filter for querying entries across all identifier columns.
 * Use this when querying tables that may store different identifier types.
 * Uses ILIKE for wallet addresses to ensure case-insensitive matching.
 *
 * UPDATED: Now includes canonical_user_id in filter generation
 * ISSUE 4D FIX: Improved filter generation to prevent invalid query syntax
 * and ensure proper escaping of special characters.
 *
 * @param identity - Resolved identity
 * @param columns - Column mappings for different identifier types
 * @returns OR filter string for Supabase query
 */
export function buildIdentityFilter(
  identity: ResolvedIdentity,
  columns: {
    canonicalColumn?: string;
    walletColumn?: string;
    privyColumn?: string;
    userIdColumn?: string;
  } = {}
): string {
  const {
    canonicalColumn = 'canonical_user_id',
    walletColumn = 'walletaddress',
    privyColumn = 'privy_user_id',
    userIdColumn = 'userid',
  } = columns;

  const filters: string[] = [];

  // ISSUE 4D FIX: Helper to safely escape filter values
  // PostgREST uses period-separated syntax, so we need to handle special chars
  const escapeFilterValue = (value: string): string => {
    if (!value || typeof value !== 'string') return '';
    // Remove any characters that could break PostgREST syntax
    // Also handle potential URL-encoded characters and quotes
    return value.replace(/[,()%'"\\]/g, '').trim();
  };

  // ISSUE 4D FIX: Validate that a value is safe to use in a filter
  const isValidFilterValue = (value: string | null | undefined): boolean => {
    if (!value || typeof value !== 'string') return false;
    const trimmed = value.trim();
    // Must have reasonable length
    if (trimmed.length < 3 || trimmed.length > 200) return false;
    // Must not contain dangerous patterns
    if (/[;'"\\]/.test(trimmed)) return false;
    return true;
  };

  // PRIORITY 1: Add canonical_user_id filter (HIGHEST PRIORITY!)
  // This is the new standard and should be checked first
  if (identity.canonicalUserId && isValidFilterValue(identity.canonicalUserId)) {
    const escapedCanonical = escapeFilterValue(identity.canonicalUserId);
    if (escapedCanonical) {
      filters.push(`${canonicalColumn}.eq.${escapedCanonical}`);
    }
  }

  // PRIORITY 2: Wallet address filter
  // Only add wallet address filter if it's a valid wallet address
  // Use ILIKE for case-insensitive matching since Ethereum addresses are case-insensitive
  if (identity.walletAddress && isWalletAddress(identity.walletAddress) && isValidFilterValue(identity.walletAddress)) {
    // Normalize to lowercase for consistent querying
    const normalizedWallet = identity.walletAddress.toLowerCase();
    const escapedWallet = escapeFilterValue(normalizedWallet);
    if (escapedWallet) {
      filters.push(`${walletColumn}.ilike.${escapedWallet}`);
      // Also check privy_user_id column for wallet address (Base auth stores wallet address in privy_user_id)
      // This ensures we find entries created by Base wallet users
      if (privyColumn !== walletColumn) {
        filters.push(`${privyColumn}.ilike.${escapedWallet}`);
      }
    }
  }

  // PRIORITY 3: Privy user ID filter
  // Only add privy_user_id filter if it's actually a Privy DID (not a wallet address)
  // This prevents invalid queries like privy_user_id.eq.0x75fa... which cause 400 errors
  if (identity.privyUserId && isPrivyDid(identity.privyUserId) && isValidFilterValue(identity.privyUserId)) {
    const escapedPrivyId = escapeFilterValue(identity.privyUserId);
    if (escapedPrivyId) {
      filters.push(`${privyColumn}.eq.${escapedPrivyId}`);
    }
  }

  // PRIORITY 4: Legacy userid filter
  // Only add legacy userid filter if it looks like a UUID (not a wallet address or privy DID)
  if (identity.legacyUserId && !isWalletAddress(identity.legacyUserId) && !isPrivyDid(identity.legacyUserId) && isValidFilterValue(identity.legacyUserId)) {
    // Additional validation: check if it looks like a UUID
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isUuid = uuidPattern.test(identity.legacyUserId);

    // Only include if it's a valid UUID format to prevent query errors
    if (isUuid) {
      const escapedUserId = escapeFilterValue(identity.legacyUserId);
      if (escapedUserId) {
        filters.push(`${userIdColumn}.eq.${escapedUserId}`);
      }
    }
  }

  // Fallback: always include the primary ID in the appropriate column as last resort
  if (filters.length === 0 && isValidFilterValue(identity.primaryId)) {
    if (isPrizePid(identity.primaryId)) {
      // It's a prize:pid: format - add as canonical_user_id
      const escapedPrimaryId = escapeFilterValue(identity.primaryId);
      if (escapedPrimaryId) {
        filters.push(`${canonicalColumn}.eq.${escapedPrimaryId}`);
      }
    } else if (isWalletAddress(identity.primaryId)) {
      const normalizedPrimaryWallet = identity.primaryId.toLowerCase();
      const escapedPrimaryWallet = escapeFilterValue(normalizedPrimaryWallet);
      if (escapedPrimaryWallet) {
        filters.push(`${walletColumn}.ilike.${escapedPrimaryWallet}`);
        // Also check privy_user_id for Base auth compatibility
        if (privyColumn !== walletColumn) {
          filters.push(`${privyColumn}.ilike.${escapedPrimaryWallet}`);
        }
      }
    } else if (isPrivyDid(identity.primaryId)) {
      const escapedPrimaryId = escapeFilterValue(identity.primaryId);
      if (escapedPrimaryId) {
        filters.push(`${privyColumn}.eq.${escapedPrimaryId}`);
      }
    } else {
      const escapedPrimaryId = escapeFilterValue(identity.primaryId);
      if (escapedPrimaryId) {
        filters.push(`${userIdColumn}.eq.${escapedPrimaryId}`);
      }
    }
  }

  // ISSUE 4D FIX: Validate the final filter string format
  // Ensure we don't have empty or malformed filters
  const validFilters = filters.filter(f => {
    // Filter must have the format: column.operator.value
    const parts = f.split('.');
    return parts.length >= 3 && parts[0] && parts[1] && parts[2];
  });

  return validFilters.join(',');
}

/**
 * Fetches user entries from joincompetition using unified identity resolution.
 * This replaces the sequential fallback queries with a single OR query.
 *
 * @param identifier - Any user identifier
 * @returns User entries with competition details
 */
export async function fetchUserEntriesWithIdentity(identifier: string): Promise<any[]> {
  const identity = await resolveUserIdentity(identifier);

  if (!identity) {
    return [];
  }

  const filter = buildIdentityFilter(identity);

  try {
    const { data, error } = await supabase
      .from('v_joincompetition_active')
      .select(`
        *,
        competitions!inner (
          id,
          uid,
          title,
          description,
          image_url,
          status,
          prize_value,
          is_instant_win,
          end_date,
          winner_address
        )
      `)
      .or(filter)
      .order('purchasedate', { ascending: false });

    if (error) {
      console.error('Error fetching user entries:', error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('Exception fetching user entries:', err);
    return [];
  }
}

/**
 * Fetches user transactions using unified identity resolution.
 *
 * @param identifier - Any user identifier
 * @returns User transactions
 */
export async function fetchUserTransactionsWithIdentity(identifier: string): Promise<any[]> {
  const identity = await resolveUserIdentity(identifier);

  if (!identity) {
    return [];
  }

  const filter = buildIdentityFilter(identity, {
    canonicalColumn: 'canonical_user_id',
    walletColumn: 'wallet_address',
    privyColumn: 'user_id',
    userIdColumn: 'user_id',
  });

  try {
    const { data, error } = await supabase
      .from('user_transactions')
      .select('*')
      .or(filter)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching user transactions:', error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('Exception fetching user transactions:', err);
    return [];
  }
}

/**
 * Fetches pending tickets using unified identity resolution.
 *
 * @param identifier - Any user identifier
 * @returns Pending ticket reservations
 */
export async function fetchPendingTicketsWithIdentity(identifier: string): Promise<any[]> {
  const identity = await resolveUserIdentity(identifier);

  if (!identity) {
    return [];
  }

  try {
    // Try standard RPC first (staging compatible with anon key)
    let data: any[] | null = null;
    let error: any = null;

    const { data: standardData, error: standardError } = await supabase.rpc(
      'get_user_pending_tickets',
      { user_identifier: identity.primaryId }
    );

    if (!standardError && standardData) {
      data = standardData;
    } else {
      // Fallback to bypass_rls version if standard fails
      console.warn('[fetchPendingTicketsWithIdentity] Standard RPC not available, trying bypass_rls');
      const { data: bypassData, error: bypassError } = await supabase.rpc(
        'get_user_pending_tickets_bypass_rls',
        { user_identifier: identity.primaryId }
      );
      data = bypassData;
      error = bypassError;
    }

    if (error) {
      // Fallback to direct query if RPC doesn't exist yet
      console.warn('[fetchPendingTicketsWithIdentity] RPC not available, using fallback:', error.message);

      const filter = buildIdentityFilter(identity, {
        canonicalColumn: 'canonical_user_id',
        walletColumn: 'wallet_address',
        privyColumn: 'user_id',
        userIdColumn: 'user_id',
      });

      const { data: fallbackData, error: fallbackError } = await supabase
        .from('pending_tickets')
        .select('*')
        .or(filter)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });

      if (fallbackError) {
        console.error('Error fetching pending tickets (fallback):', fallbackError);
        return [];
      }

      return fallbackData || [];
    }

    return data || [];
  } catch (err) {
    console.error('Exception fetching pending tickets:', err);
    return [];
  }
}

export default {
  resolveUserIdentity,
  buildIdentityFilter,
  fetchUserEntriesWithIdentity,
  fetchUserTransactionsWithIdentity,
  fetchPendingTicketsWithIdentity,
  isWalletAddress,
  isPrivyDid,
  normalizeWalletAddress,
  generatePrivyStyleId,
};
