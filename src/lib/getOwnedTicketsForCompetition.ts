/**
 * Dual-Path Ticket Ownership Resolver
 * 
 * This utility provides robust ticket ownership checking with automatic fallback:
 * - Path A: Fast view-based lookup using v_joincompetition_active
 * - Path B: RPC-based lookup using get_user_active_tickets (always works)
 * 
 * If Path A fails (due to RLS, caching, or naming drift), Path B automatically
 * kicks in without user impact. This ensures owned tickets always highlight green.
 */

import { supabase } from './supabase';

interface UserIdentifiers {
  walletAddress?: string | null;
  privyId?: string | null;
  canonicalUserId?: string | null;
}

/**
 * Infer which identifier type is being used (for telemetry)
 */
function inferIdType(id: string | null | undefined): string {
  if (!id) return 'none';
  // Simple heuristics
  if (id.startsWith('0x')) return 'wallet';
  if (id.includes('did:privy:')) return 'privy';
  return 'canonical';
}

/**
 * Get owned tickets for a competition using dual-path strategy
 * 
 * @param competitionId - Competition UUID
 * @param identifiers - User identifiers (wallet, privy, canonical)
 * @returns Set of ticket numbers (as strings) owned by the user
 */
export async function getOwnedTicketsForCompetition(
  competitionId: string,
  { walletAddress, privyId, canonicalUserId }: UserIdentifiers
): Promise<Set<string>> {
  // A: View path - fast, uses stable view with legacy and new column names
  try {
    const filters: Array<[string, string]> = [
      ['competition_id', competitionId],
      ['canonical_user_id', canonicalUserId],
      ['privy_user_id', privyId],
      ['wallet_address', walletAddress],
    ].filter(([, v]) => !!v) as Array<[string, string]>;

    if (filters.length > 0) {
      let query = supabase
        .from('v_joincompetition_active')
        .select('ticket_numbers,ticketnumbers') // request both to be safe
        .limit(1);

      for (const [k, v] of filters) {
        query = query.eq(k, v);
      }

      const { data, error } = await query;

      if (!error && data && data.length > 0) {
        // Try both column names (new snake_case and legacy)
        const tickets = (data[0]?.ticket_numbers ?? data[0]?.ticketnumbers ?? []) as (string | number)[];
        if (tickets.length > 0) {
          console.info('[TicketGreen] A-path success', {
            competitionId,
            idType: inferIdType(canonicalUserId ?? privyId ?? walletAddress),
            ticketCount: tickets.length
          });
          return new Set(tickets.map(String));
        }
      }
    }
  } catch (e) {
    console.warn('[TicketGreen] A-path failed', e);
  }

  // B: RPC fallback - identifier-agnostic, bypasses naming drift and RLS edge cases
  try {
    const id = canonicalUserId ?? privyId ?? walletAddress;
    if (!id) {
      // Guest user - no owned tickets
      return new Set();
    }

    const { data, error } = await supabase.rpc('get_user_active_tickets', {
      p_user_identifier: id,
    });

    if (error) {
      throw error;
    }

    // Find the row for the current competition
    const row = data?.find((r: any) => String(r.competitionid) === String(competitionId));
    const tickets = (row?.ticketnumbers ?? []) as (string | number)[];

    console.info('[TicketGreen] B-path used', {
      competitionId,
      idType: inferIdType(id),
      ticketCount: tickets.length
    });

    return new Set(tickets.map(String));
  } catch (e) {
    console.error('[TicketGreen] B-path failed', e);
    return new Set();
  }
}

/**
 * Check if a specific ticket number is owned
 * 
 * @param ticketNumber - Ticket number to check
 * @param ownedSet - Set of owned ticket numbers (from getOwnedTicketsForCompetition)
 * @returns true if the ticket is owned
 */
export function isTicketOwned(ticketNumber: string | number, ownedSet: Set<string>): boolean {
  return ownedSet.has(String(ticketNumber));
}
