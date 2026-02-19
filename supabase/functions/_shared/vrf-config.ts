/**
 * VRF Contract Configuration - Shared Constants
 * 
 * Single source of truth for VRF contract address used across edge functions.
 * Import this in edge functions to ensure consistency.
 */

// New VRFWinnerSelector contract with 2 gwei + native ETH support
export const VRF_CONTRACT_ADDRESS = '0xc5DfC3f6A227b30161F53f0bC167495158854854' as const;

// Contract features
export const VRF_CONTRACT_FEATURES = {
  registerOffChainTickets: true,
  nativeETHSupport: true,
  gasPrice: '2gwei'
} as const;

export default VRF_CONTRACT_ADDRESS;
