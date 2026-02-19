/**
 * VRF Monitor Service - Central Entry Point for VRF Functionality
 * 
 * This service provides a unified interface for monitoring and interacting with VRF
 * (Verifiable Random Function) draws for competitions on the Base blockchain.
 * 
 * Features:
 * - Real-time VRF status monitoring via Supabase Realtime
 * - Transaction URL generation for BaseScan
 * - Admin actions for triggering VRF draws
 * - Queue management for VRF processing
 * 
 * Base Mainnet Details:
 * - Chain ID: 8453
 * - Block Explorer: https://basescan.org
 * - VRF Contract: 0x8ce54644e3313934D663c43Aea29641DFD8BcA1A
 */

import { supabase } from './supabase';
import { COMPETITION_VRF_ADDRESS, CONTRACT_CONFIG } from './vrf-contract';
import { triggerDraw, syncResults } from './vrf-debug';

// ============================================================================
// Types
// ============================================================================

export type VRFStatus = {
  competitionId: string;
  status: 'pending' | 'requested' | 'processing' | 'completed' | 'failed';
  vrfTxHash: string | null;
  vrfVerified: boolean;
  explorerUrl: string | null;
  blockNumber: number | null;
  timestamp: string | null;
  errorMessage?: string;
  onchainCompetitionId?: number | null;
  winnersCount?: number;
};

export type VRFQueueItem = {
  competitionId: string;
  status: string;
  requestedAt: string | null;
  explorerUrl: string | null;
};

export type TransactionStatus = {
  hash: string;
  explorerUrl: string;
  status: 'pending' | 'confirmed' | 'failed';
  blockNumber: number | null;
  timestamp: string | null;
};

// ============================================================================
// URL Generators
// ============================================================================

/**
 * Get the BaseScan URL for a transaction hash
 * @param txHash - The transaction hash (with or without 0x prefix)
 * @returns Full BaseScan transaction URL
 */
export function getTransactionUrl(txHash: string): string {
  const cleanHash = txHash.startsWith('0x') ? txHash : `0x${txHash}`;
  return `${CONTRACT_CONFIG.blockExplorer}/tx/${cleanHash}`;
}

/**
 * Get the BaseScan URL for a contract address
 * @param contractAddress - The contract address (defaults to VRF contract)
 * @returns Full BaseScan contract URL
 */
export function getContractUrl(contractAddress: string = COMPETITION_VRF_ADDRESS): string {
  return `${CONTRACT_CONFIG.blockExplorer}/address/${contractAddress}`;
}

/**
 * Get the BaseScan URL for viewing a specific competition on-chain
 * @param onchainCompetitionId - The on-chain competition ID
 * @returns Full BaseScan contract read URL
 */
export function getOnchainCompetitionUrl(onchainCompetitionId: number): string {
  return `${CONTRACT_CONFIG.blockExplorer}/address/${COMPETITION_VRF_ADDRESS}#readContract`;
}

// ============================================================================
// VRF Status Queries
// ============================================================================

/**
 * Get the current VRF status for a competition
 * @param competitionId - The competition UUID
 * @returns VRF status information
 */
export async function getVRFStatus(competitionId: string): Promise<VRFStatus> {
  try {
    const { data, error } = await supabase
      .from('competitions')
      .select('vrf_status, vrf_tx_hash, vrf_draw_completed_at, onchain_competition_id, num_winners, status')
      .eq('id', competitionId)
      .single();

    if (error) throw error;

    if (!data) {
      return {
        competitionId,
        status: 'pending',
        vrfTxHash: null,
        vrfVerified: false,
        explorerUrl: null,
        blockNumber: null,
        timestamp: null,
      };
    }

    // Determine status based on vrf_status and competition status
    let status: VRFStatus['status'] = 'pending';
    
    if (data.vrf_status === 'completed' || data.vrf_draw_completed_at) {
      status = 'completed';
    } else if (data.vrf_status === 'processing' || data.vrf_status === 'requested') {
      status = 'processing';
    } else if (data.vrf_status === 'failed') {
      status = 'failed';
    } else if (data.status === 'drawn') {
      status = 'completed';
    }

    return {
      competitionId,
      status,
      vrfTxHash: data.vrf_tx_hash,
      vrfVerified: !!data.vrf_draw_completed_at,
      explorerUrl: data.vrf_tx_hash ? getTransactionUrl(data.vrf_tx_hash) : null,
      blockNumber: null, // Could be fetched from blockchain if needed
      timestamp: data.vrf_draw_completed_at,
      onchainCompetitionId: data.onchain_competition_id,
      winnersCount: data.num_winners,
    };
  } catch (error) {
    console.error('[VRF Monitor] Error fetching VRF status:', error);
    return {
      competitionId,
      status: 'failed',
      vrfTxHash: null,
      vrfVerified: false,
      explorerUrl: null,
      blockNumber: null,
      timestamp: null,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Real-time Subscriptions
// ============================================================================

/**
 * Subscribe to VRF status updates for a specific competition
 * @param competitionId - The competition UUID to monitor
 * @param callback - Function called when status updates
 * @returns Unsubscribe function
 */
export function subscribeToVRFStatus(
  competitionId: string,
  callback: (status: VRFStatus) => void
): () => void {
  // Fetch initial status
  getVRFStatus(competitionId).then(callback);

  // Set up real-time subscription
  const channel = supabase
    .channel(`vrf-status-${competitionId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'competitions',
        filter: `id=eq.${competitionId}`,
      },
      () => {
        // Fetch updated status when competition changes
        getVRFStatus(competitionId).then(callback);
      }
    )
    .subscribe();

  // Return unsubscribe function
  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Subscribe to all VRF status updates (for admin dashboard)
 * @param callback - Function called when any competition's VRF status updates
 * @returns Unsubscribe function
 */
export function subscribeToAllVRFUpdates(
  callback: (competitionId: string, status: VRFStatus) => void
): () => void {
  const channel = supabase
    .channel('all-vrf-updates')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'competitions',
      },
      (payload) => {
        const competitionId = payload.new.id;
        getVRFStatus(competitionId).then((status) => {
          callback(competitionId, status);
        });
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// ============================================================================
// Admin Actions
// ============================================================================

/**
 * Manually trigger VRF draw for a competition (admin only)
 * @param competitionId - The competition UUID
 * @returns Result with success status and transaction hash
 */
export async function triggerVRF(competitionId: string): Promise<{
  success: boolean;
  txHash?: string;
  message: string;
}> {
  try {
    // Get competition details first
    const { data: competition, error } = await supabase
      .from('competitions')
      .select('onchain_competition_id, status, vrf_status')
      .eq('id', competitionId)
      .single();

    if (error) throw error;

    if (!competition) {
      return {
        success: false,
        message: 'Competition not found',
      };
    }

    if (!competition.onchain_competition_id) {
      return {
        success: false,
        message: 'Competition has no on-chain ID',
      };
    }

    if (competition.vrf_status === 'completed') {
      return {
        success: false,
        message: 'VRF draw already completed',
      };
    }

    // Trigger the draw using vrf-debug helper
    const result = await triggerDraw(competition.onchain_competition_id);

    if (result.success) {
      // Note: Sync will be handled by backend scheduler after VRF callback
      // Manual sync can be triggered later via the sync script if needed
      
      return {
        success: true,
        txHash: result.txHash,
        message: 'VRF draw triggered successfully',
      };
    }

    return {
      success: false,
      message: result.message || 'Failed to trigger VRF draw',
    };
  } catch (error) {
    console.error('[VRF Monitor] Error triggering VRF:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get the VRF processing queue
 * @returns List of competitions waiting for or processing VRF
 */
export async function getVRFQueue(): Promise<VRFQueueItem[]> {
  try {
    const { data, error } = await supabase
      .from('competitions')
      .select('id, vrf_status, vrf_tx_hash, vrf_draw_requested_at')
      .in('vrf_status', ['requested', 'processing'])
      .order('vrf_draw_requested_at', { ascending: true });

    if (error) throw error;

    return (data || []).map((item) => ({
      competitionId: item.id,
      status: item.vrf_status || 'unknown',
      requestedAt: item.vrf_draw_requested_at,
      explorerUrl: item.vrf_tx_hash ? getTransactionUrl(item.vrf_tx_hash) : null,
    }));
  } catch (error) {
    console.error('[VRF Monitor] Error fetching VRF queue:', error);
    return [];
  }
}

/**
 * Check the status of a VRF transaction on the blockchain
 * Note: This is a placeholder - actual implementation would require
 * viem/wagmi to fetch transaction receipt from Base chain
 * 
 * @param txHash - The transaction hash to check
 * @returns Transaction status
 */
export async function checkVRFTransactionStatus(txHash: string): Promise<TransactionStatus> {
  // For now, return a basic status with explorer URL
  // In a full implementation, this would use viem to fetch the transaction receipt
  return {
    hash: txHash,
    explorerUrl: getTransactionUrl(txHash),
    status: 'confirmed', // Would check actual status
    blockNumber: null,
    timestamp: null,
  };
}

// ============================================================================
// Default Export
// ============================================================================

const vrfMonitor = {
  // URL generators
  getTransactionUrl,
  getContractUrl,
  getOnchainCompetitionUrl,
  
  // Status queries
  getVRFStatus,
  
  // Real-time subscriptions
  subscribeToVRFStatus,
  subscribeToAllVRFUpdates,
  
  // Admin actions
  triggerVRF,
  getVRFQueue,
  checkVRFTransactionStatus,
};

export default vrfMonitor;
