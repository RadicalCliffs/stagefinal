/**
 * CDP Spend Permissions Hooks
 * 
 * Centralized exports for Coinbase Developer Platform (CDP) spend permission hooks.
 * These hooks enable gasless, one-click payments by allowing apps to spend
 * pre-approved amounts from user wallets without requiring signatures for each transaction.
 * 
 * Architecture:
 * - Users grant a spend permission once (EIP-712 signature)
 * - Apps can execute payments up to the approved limit
 * - Permissions have configurable allowances, periods, and expiration
 * - Fully compatible with Base Account SDK and Smart Wallets
 * 
 * Usage:
 * ```tsx
 * import { useCreateSpendPermission, useListSpendPermissions } from '@/hooks/useCDPSpendPermissions';
 * 
 * function PaymentComponent() {
 *   const { createSpendPermission, loading } = useCreateSpendPermission();
 *   const { spendPermissions } = useListSpendPermissions();
 *   
 *   const handleCreatePermission = async () => {
 *     const permission = await createSpendPermission({
 *       spender: treasuryAddress,
 *       token: usdcAddress,
 *       allowance: '100000000', // 100 USDC (6 decimals)
 *       period: 2592000, // 30 days in seconds
 *       start: Math.floor(Date.now() / 1000),
 *       end: Math.floor(Date.now() / 1000) + 31536000, // 1 year
 *     });
 *   };
 *   
 *   return (
 *     <div>
 *       <button onClick={handleCreatePermission} disabled={loading}>
 *         Enable One-Click Payments
 *       </button>
 *       <div>Active Permissions: {spendPermissions.length}</div>
 *     </div>
 *   );
 * }
 * ```
 * 
 * Best Practices:
 * - Always set reasonable allowance limits (e.g., $500/month)
 * - Use appropriate period durations (daily/weekly/monthly)
 * - Set expiration dates (e.g., 1 year) for security
 * - Allow users to view and revoke permissions easily
 * - Store permission hashes for tracking and revocation
 */

// Re-export CDP spend permission hooks for centralized access
export {
  // Spend Permission Management
  useCreateSpendPermission,
  useListSpendPermissions,
  useRevokeSpendPermission,
} from '@coinbase/cdp-hooks';

/**
 * Type re-exports for TypeScript support
 */
// Removed some type exports
