import { supabase } from './supabase';
import { StagingRNG } from './rng-utils';

/**
 * Competition State Management
 *
 * UPDATED: Now uses Netlify function for write operations to bypass RLS restrictions.
 * This prevents the issue where client-side Supabase calls fail because auth.uid() is null
 * in RLS policies.
 *
 * Handles valid state transitions for competitions and ensures
 * proper lifecycle management from draft to completion.
 */

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

// Valid state transitions - enforced throughout the system
export const VALID_TRANSITIONS: Record<string, string[]> = {
  'draft': ['active'],
  'active': ['drawing', 'cancelled', 'completed'],
  'drawing': ['drawn', 'completed', 'cancelled'],
  'drawn': ['completed'],
  'completed': [], // Terminal state
  'cancelled': []  // Terminal state
};

// All possible competition statuses
export type CompetitionStatus = 'draft' | 'active' | 'drawing' | 'drawn' | 'completed' | 'cancelled';

/**
 * Validate if a status transition is allowed
 */
export function validateStatusTransition(currentStatus: string, newStatus: string): boolean {
  const normalizedCurrent = currentStatus.toLowerCase();
  const normalizedNew = newStatus.toLowerCase();

  const validNext = VALID_TRANSITIONS[normalizedCurrent];
  if (!validNext) {
    console.warn(`Unknown current status: ${currentStatus}`);
    return false;
  }

  return validNext.includes(normalizedNew);
}

/**
 * Get all valid next states for a given status
 */
export function getValidNextStates(currentStatus: string): string[] {
  const normalized = currentStatus.toLowerCase();
  return VALID_TRANSITIONS[normalized] || [];
}

/**
 * Check if a status is a terminal state (no further transitions allowed)
 */
export function isTerminalState(status: string): boolean {
  const normalized = status.toLowerCase();
  const validNext = VALID_TRANSITIONS[normalized];
  return validNext !== undefined && validNext.length === 0;
}

/**
 * Transition a competition to a new status with validation
 * Uses Netlify function to bypass RLS restrictions
 */
export async function transitionCompetitionStatus(
  competitionId: string,
  newStatus: CompetitionStatus
): Promise<{ success: boolean; error?: string }> {
  try {
    const authToken = await getAuthToken();
    if (!authToken) {
      return {
        success: false,
        error: 'Authentication required for status transition'
      };
    }

    const response = await fetch(`/api/competition-status/${competitionId}/transition`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({ status: newStatus }),
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      return {
        success: false,
        error: data.error || `Failed to transition status: ${response.statusText}`
      };
    }

    console.log(`[Competition State] Successfully transitioned (${competitionId}): ${data.previousStatus} → ${data.newStatus}`);
    return { success: true };
  } catch (error) {
    console.error('[Competition State] Error in transitionCompetitionStatus:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Force transition (admin only) - bypasses validation for recovery scenarios
 * Uses Netlify function to bypass RLS restrictions
 */
export async function forceTransitionStatus(
  competitionId: string,
  newStatus: CompetitionStatus,
  adminUserId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const authToken = await getAuthToken();
    if (!authToken) {
      return {
        success: false,
        error: 'Authentication required for force transition'
      };
    }

    const response = await fetch(`/api/competition-status/${competitionId}/force`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({ status: newStatus }),
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      return {
        success: false,
        error: data.error || `Failed to force transition: ${response.statusText}`
      };
    }

    console.warn(`[Competition State] FORCE TRANSITION by admin ${adminUserId}: (${competitionId}): ${data.previousStatus} → ${data.newStatus}`);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Check if competition can accept new entries
 */
export function canAcceptEntries(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized === 'active';
}

/**
 * Check if competition is in a drawable state
 */
export function canDrawWinner(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized === 'active' || normalized === 'drawing';
}

/**
 * Get display-friendly status label
 */
export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    'draft': 'Draft',
    'active': 'Live',
    'drawing': 'Drawing Winner',
    'drawn': 'Winner Drawn',
    'completed': 'Completed',
    'cancelled': 'Cancelled'
  };
  return labels[status.toLowerCase()] || status;
}

/**
 * Get status color for UI display
 */
export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    'draft': 'gray',
    'active': 'green',
    'drawing': 'yellow',
    'drawn': 'blue',
    'completed': 'purple',
    'cancelled': 'red'
  };
  return colors[status.toLowerCase()] || 'gray';
}
