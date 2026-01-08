/**
 * VRF Debug API Utility
 *
 * Provides functions to interact with the vrf-debug-competition Supabase edge function
 * for checking on-chain competition state for debugging and admin purposes.
 *
 * Contract: 0x8ce54644e3313934D663c43Aea29641DFD8BcA1A (Base Mainnet)
 * See: src/lib/vrf-contract.ts for the source of truth
 */

import { supabase } from './supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://mthwfldcjvpxjtmrqkqm.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

/**
 * Get auth token for API requests.
 * Tries multiple sources in order of preference.
 */
async function getAuthToken(): Promise<string | null> {
  // Try CDP/Base wallet auth
  try {
    const walletAddress = localStorage.getItem('cdp:wallet_address') ||
                          localStorage.getItem('base:wallet_address');
    if (walletAddress) {
      return `wallet:${walletAddress}`;
    }
  } catch {
    // Continue to fallback
  }

  // Try Privy tokens
  try {
    const storedToken = localStorage.getItem('privy:token') ||
                        localStorage.getItem('privy:access_token');
    if (storedToken) {
      return storedToken;
    }

    const authState = localStorage.getItem('privy:authState');
    if (authState) {
      try {
        const parsed = JSON.parse(authState);
        if (parsed.accessToken) {
          return parsed.accessToken;
        }
      } catch {
        // Continue to fallback
      }
    }
  } catch {
    // Continue to fallback
  }

  // Fallback to Supabase session
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

/**
 * On-chain competition state returned from the VRF debug function
 * Updated for the new CompetitionVRF v2.5 contract structure
 */
export interface VRFOnchainState {
  /** Maximum tickets available */
  totalTickets: string;
  /** Number of tickets sold */
  ticketsSold: string;
  /** Price per ticket in wei */
  pricePerTicket: string;
  /** Unix timestamp when competition ends */
  endTime: string;
  /** Whether competition is currently active */
  active: boolean;
  /** Whether winners have already been drawn */
  drawn: boolean;
  /** Number of winners to be selected */
  numWinners: number;
  /** Maximum tickets per transaction */
  maxTicketsPerTx: number;
  /** Total collected in wei (prize pool) */
  totalCollectedWei: string;
}

/**
 * Success response from VRF debug function
 */
export interface VRFDebugSuccessResponse {
  ok: true;
  competitionId: number;
  onchain: VRFOnchainState;
}

/**
 * Error response from VRF debug function
 */
export interface VRFDebugErrorResponse {
  ok: false;
  error: string;
}

/**
 * Union type for VRF debug response
 */
export type VRFDebugResponse = VRFDebugSuccessResponse | VRFDebugErrorResponse;

/**
 * VRF status indicator types
 */
export type VRFStatusType =
  | 'ready_for_draw'    // active=true, drawn=false, endTime passed
  | 'already_drawn'     // drawn=true
  | 'active_not_ready'  // active=true, drawn=false, endTime in future
  | 'inactive';         // active=false

/**
 * Parsed VRF state with computed status
 */
export interface ParsedVRFState extends VRFOnchainState {
  status: VRFStatusType;
  statusLabel: string;
  statusEmoji: string;
  endTimeDate: Date;
  pricePerTicketEth: number;
  isEnded: boolean;
}

/**
 * Fetch on-chain competition state from VRF debug function
 *
 * @param competitionId - The on-chain competition ID (uint256)
 * @returns Promise resolving to the debug response
 */
export async function debugCompetition(competitionId: number): Promise<VRFDebugResponse> {
  if (!SUPABASE_ANON_KEY) {
    return {
      ok: false,
      error: 'Supabase anon key not configured',
    };
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/vrf-debug-competition`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ competitionId }),
    });

    const data = await response.json();
    return data as VRFDebugResponse;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Determine the VRF status based on on-chain state
 *
 * @param onchain - The on-chain state from the debug response
 * @returns The VRF status type
 */
export function getVRFStatus(onchain: VRFOnchainState): VRFStatusType {
  const now = Date.now();
  const endTime = parseInt(onchain.endTime) * 1000;

  if (onchain.drawn) {
    return 'already_drawn';
  }

  if (!onchain.active) {
    return 'inactive';
  }

  if (endTime < now) {
    return 'ready_for_draw';
  }

  return 'active_not_ready';
}

/**
 * Get human-readable status information
 *
 * @param status - The VRF status type
 * @returns Object with label and emoji for the status
 */
export function getStatusInfo(status: VRFStatusType): { label: string; emoji: string } {
  switch (status) {
    case 'ready_for_draw':
      return { label: 'Ready for VRF Draw', emoji: '🟢' };
    case 'already_drawn':
      return { label: 'Already Drawn', emoji: '🔵' };
    case 'active_not_ready':
      return { label: 'Active (Not Ready)', emoji: '🟡' };
    case 'inactive':
      return { label: 'Inactive', emoji: '🔴' };
  }
}

/**
 * Parse VRF on-chain state into a more usable format with computed values
 *
 * @param onchain - The raw on-chain state
 * @returns Parsed state with computed values
 */
export function parseVRFState(onchain: VRFOnchainState): ParsedVRFState {
  const status = getVRFStatus(onchain);
  const statusInfo = getStatusInfo(status);
  const endTimeDate = new Date(parseInt(onchain.endTime) * 1000);
  const pricePerTicketEth = parseInt(onchain.pricePerTicket) / 1e18;
  const isEnded = endTimeDate.getTime() < Date.now();

  return {
    ...onchain,
    status,
    statusLabel: statusInfo.label,
    statusEmoji: statusInfo.emoji,
    endTimeDate,
    pricePerTicketEth,
    isEnded,
  };
}

/**
 * Check if a competition is ready for VRF draw
 *
 * A competition is ready for VRF draw when:
 * 1. active === true
 * 2. drawn === false
 * 3. Current time > endTime
 *
 * @param onchain - The on-chain state
 * @returns True if ready for draw
 */
export function isReadyForDraw(onchain: VRFOnchainState): boolean {
  return getVRFStatus(onchain) === 'ready_for_draw';
}

/**
 * Format on-chain state for logging/display
 *
 * @param response - The VRF debug response
 * @returns Formatted string for display
 */
export function formatDebugOutput(response: VRFDebugResponse): string {
  if (!response.ok) {
    return `Error: ${response.error}`;
  }

  const parsed = parseVRFState(response.onchain);

  return `
Competition #${response.competitionId}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Status: ${parsed.statusEmoji} ${parsed.statusLabel}
Active: ${parsed.active ? '✅ Yes' : '❌ No'}
Drawn: ${parsed.drawn ? '✅ Yes' : '❌ No'}
End Time: ${parsed.endTimeDate.toLocaleString()}
Tickets: ${parsed.ticketsSold} / ${parsed.totalTickets} sold
Price: ${parsed.pricePerTicketEth.toFixed(6)} ETH
Winners: ${parsed.numWinners}
Max per TX: ${parsed.maxTicketsPerTx}
  `.trim();
}

/**
 * Error type constants for error handling
 */
export const VRF_ERROR_TYPES = {
  NOT_FOUND: 'not_found',
  WRONG_NETWORK: 'wrong_network',
  RPC_ERROR: 'rpc_error',
  UNKNOWN: 'unknown',
} as const;

/**
 * Parse error message to determine error type
 *
 * @param errorMessage - The error message from the response
 * @returns Parsed error information
 */
export function parseVRFError(errorMessage: string): {
  type: string;
  message: string;
  competitionId?: number;
} {
  if (errorMessage.includes('execution reverted') || errorMessage.includes('Competition not found')) {
    return {
      type: VRF_ERROR_TYPES.NOT_FOUND,
      message: 'Competition not found on-chain',
    };
  }

  if (errorMessage.includes('Wrong chainId')) {
    return {
      type: VRF_ERROR_TYPES.WRONG_NETWORK,
      message: 'RPC not configured for Base mainnet',
    };
  }

  return {
    type: VRF_ERROR_TYPES.UNKNOWN,
    message: errorMessage,
  };
}

/**
 * Response from VRF trigger draw function
 */
export interface VRFTriggerDrawResponse {
  ok: boolean;
  competitionId?: string;
  txHash?: string;
  error?: string;
  onchain?: {
    active: boolean;
    drawn: boolean;
    endTime?: string;
    ticketsSold?: string;
  };
}

/**
 * Response from VRF sync results function
 */
export interface VRFSyncResultsResponse {
  ok: boolean;
  processed?: number;
  results?: Array<{
    competitionId: string;
    title?: string;
    status: string;
    message?: string;
    winnersCreated?: number;
    winnersSkipped?: number;
    winners?: Array<{
      ticketNumber: number;
      walletAddress: string;
    }>;
    error?: string;
    onchainState?: {
      active: boolean;
      drawn: boolean;
      drawSeed?: string;
    };
  }>;
  message?: string;
  error?: string;
}

/**
 * Trigger VRF draw for a competition
 *
 * This is a ONE-TIME admin call that triggers the VRF draw on-chain.
 * After calling this, wait 30-90 seconds for the VRF callback, then call syncResults.
 *
 * @param competitionId - The ON-CHAIN competition ID (not the Supabase UUID)
 * @param accessToken - Optional access token (will auto-detect if not provided)
 * @returns Promise resolving to the trigger response with txHash on success
 */
export async function triggerDraw(
  competitionId: number,
  accessToken?: string
): Promise<VRFTriggerDrawResponse> {
  try {
    const token = accessToken || await getAuthToken();
    if (!token) {
      return { ok: false, error: 'Not authenticated - please log in' };
    }

    const response = await fetch(`${SUPABASE_URL}/functions/v1/vrf-trigger-draw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ competitionId }),
    });

    const data = await response.json();
    return data as VRFTriggerDrawResponse;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Sync VRF results from on-chain to database
 *
 * This should be called 30-90 seconds after triggerDraw to sync winners.
 * If VRF has fulfilled, it will return winner information.
 *
 * @param accessToken - Optional access token (will auto-detect if not provided)
 * @returns Promise resolving to the sync response
 */
export async function syncResults(accessToken?: string): Promise<VRFSyncResultsResponse> {
  try {
    const token = accessToken || await getAuthToken();
    if (!token) {
      return { ok: false, error: 'Not authenticated - please log in' };
    }

    const response = await fetch(`${SUPABASE_URL}/functions/v1/vrf-sync-results`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    const data = await response.json();
    return data as VRFSyncResultsResponse;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Full VRF draw workflow helper
 *
 * Provides status updates through a callback during the draw process:
 * 1. Validates competition is ready for draw
 * 2. Triggers the draw transaction
 * 3. Waits for VRF callback
 * 4. Syncs results to database
 *
 * @param competitionId - The ON-CHAIN competition ID
 * @param onStatusUpdate - Callback for status updates
 * @param accessToken - Optional access token (will auto-detect if not provided)
 * @param waitTimeMs - Time to wait for VRF callback (default 60000ms = 60s)
 */
export async function executeVRFDraw(
  competitionId: number,
  onStatusUpdate: (status: string, details?: unknown) => void,
  accessToken?: string,
  waitTimeMs: number = 60000
): Promise<{ success: boolean; txHash?: string; winners?: number; error?: string }> {
  // Step 1: Validate competition is ready
  onStatusUpdate('Checking competition state...');
  const debugResult = await debugCompetition(competitionId);

  if (!debugResult.ok) {
    return { success: false, error: debugResult.error };
  }

  if (!isReadyForDraw(debugResult.onchain)) {
    const status = getVRFStatus(debugResult.onchain);
    const statusInfo = getStatusInfo(status);
    return {
      success: false,
      error: `Competition is not ready for draw: ${statusInfo.label}`,
    };
  }

  onStatusUpdate('Competition is ready for VRF draw', debugResult.onchain);

  // Step 2: Trigger the draw
  onStatusUpdate('Sending draw transaction...');
  const triggerResult = await triggerDraw(competitionId, accessToken);

  if (!triggerResult.ok) {
    return { success: false, error: triggerResult.error };
  }

  onStatusUpdate('Draw transaction sent!', { txHash: triggerResult.txHash });

  // Step 3: Wait for VRF callback
  onStatusUpdate(`Waiting ${waitTimeMs / 1000}s for VRF callback...`);
  await new Promise(resolve => setTimeout(resolve, waitTimeMs));

  // Step 4: Sync results
  onStatusUpdate('Syncing results from blockchain...');
  const syncResult = await syncResults(accessToken);

  if (!syncResult.ok) {
    return { success: false, txHash: triggerResult.txHash, error: syncResult.error };
  }

  const compResult = syncResult.results?.find(
    r => r.competitionId === String(competitionId)
  );

  if (compResult?.status === 'synced') {
    onStatusUpdate('VRF draw completed successfully!', compResult);
    return {
      success: true,
      txHash: triggerResult.txHash,
      winners: compResult.winnersCreated,
    };
  }

  if (compResult?.status === 'waiting') {
    onStatusUpdate('VRF callback still pending. Try syncing again in a few seconds.', compResult);
    return {
      success: false,
      txHash: triggerResult.txHash,
      error: 'VRF callback pending - try syncing again later',
    };
  }

  return {
    success: false,
    txHash: triggerResult.txHash,
    error: compResult?.message || 'Unknown sync result',
  };
}
