/**
 * CDP Transaction Hooks
 * 
 * Centralized exports for Coinbase Developer Platform (CDP) transaction hooks.
 * These hooks handle EVM and Solana transaction signing and sending.
 * 
 * Usage:
 * ```tsx
 * import { useSendEvmTransaction, useSignEvmMessage } from '@/hooks/useCDPTransactions';
 * 
 * function TransactionComponent() {
 *   const { sendEvmTransaction, loading, error } = useSendEvmTransaction();
 *   const { signEvmMessage } = useSignEvmMessage();
 *   
 *   const handleSend = async () => {
 *     await sendEvmTransaction({
 *       to: '0x...',
 *       value: '1000000000000000000', // 1 ETH in wei
 *     });
 *   };
 *   
 *   return <button onClick={handleSend} disabled={loading}>Send Transaction</button>;
 * }
 * ```
 */

// Re-export CDP transaction hooks for centralized access
export {
  // EVM Transactions
  useSendEvmTransaction,
  useSignEvmTransaction,
  useSignEvmMessage,
  useSignEvmHash,
  useSignEvmTypedData,
  
  // Solana Transactions
  useSendSolanaTransaction,
  useSignSolanaTransaction,
  useSignSolanaMessage,
  
  // User Operations (ERC-4337 Account Abstraction)
  useSendUserOperation,
  useWaitForUserOperation,
} from '@coinbase/cdp-hooks';

/**
 * Type re-exports for TypeScript support
 */
// Removed some type exports
