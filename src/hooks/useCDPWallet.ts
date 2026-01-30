/**
 * CDP Wallet Management Hooks
 * 
 * Centralized exports for Coinbase Developer Platform (CDP) wallet hooks.
 * These hooks provide comprehensive access to embedded wallet functionality,
 * including EVM, Solana, and Smart Account management.
 * 
 * Usage:
 * ```tsx
 * import { useEvmAccounts, useEvmSmartAccounts, useSolanaAccounts } from '@/hooks/useCDPWallet';
 * 
 * function WalletComponent() {
 *   const { evmAccounts } = useEvmAccounts();
 *   const { smartAccounts } = useEvmSmartAccounts();
 *   const { solanaAccounts } = useSolanaAccounts();
 *   
 *   // Use accounts...
 * }
 * ```
 */

// Re-export CDP wallet hooks for centralized access
export {
  // EVM Account Management
  useEvmAccounts,
  useEvmAddress,
  useEvmSmartAccounts,
  
  // Solana Account Management
  useSolanaAccounts,
  useSolanaAddress,
  
  // Account Creation
  useCreateEvmEoaAccount,
  useCreateEvmSmartAccount,
  useCreateSolanaAccount,
  
  // Account Export
  useExportEvmAccount,
  useExportSolanaAccount,
  useEvmKeyExportIframe,
  useSolanaKeyExportIframe,
} from '@coinbase/cdp-hooks';

/**
 * Type re-exports for TypeScript support
 */
export type {
  EvmAddress,
  SolanaAddress,
  CreateEvmSmartAccountOptions,
  ExportEvmAccountOptions,
  ExportEvmAccountResult,
  ExportSolanaAccountOptions,
  ExportSolanaAccountResult,
} from '@coinbase/cdp-hooks';
