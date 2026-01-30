/**
 * Base Account SDK Hooks
 * 
 * React hooks for the Base Account SDK (@base-org/account).
 * These hooks provide seamless integration with Base Account features including:
 * - Sub-account creation and management
 * - Spend permissions for one-click payments
 * - EIP-1193 provider access for wallet operations
 * - Session and authentication management
 * 
 * Architecture:
 * The Base Account SDK is initialized once via BaseAccountSDKProvider and
 * accessed throughout the app via these hooks. This ensures a single SDK instance
 * is shared across all components.
 * 
 * Usage:
 * ```tsx
 * import { useBaseAccountSDK, useBaseProvider, useBaseSession } from '@/hooks/useBaseAccount';
 * 
 * function MyComponent() {
 *   const { sdk } = useBaseAccountSDK();
 *   const { provider } = useBaseProvider();
 *   const { hasSession, account } = useBaseSession();
 *   
 *   // Use SDK, provider, session...
 * }
 * ```
 */

import { useCallback } from 'react';
import { 
  useBaseAccountSDK as useSDKContext,
  useBaseAccountSDKOptional as useSDKContextOptional 
} from '../contexts/BaseAccountSDKContext';
import type { Address } from 'viem';

/**
 * Hook to access the Base Account SDK
 * 
 * This is a convenience re-export of the context hook for easy importing.
 * Provides the SDK instance, provider, and session state from the context.
 * Throws an error if used outside of BaseAccountSDKProvider.
 * 
 * Note: This is the same as importing from '../contexts/BaseAccountSDKContext'
 * but allows importing from '@/hooks' for consistency.
 * 
 * @returns SDK instance, provider, session state, and utility functions
 * 
 * @example
 * ```tsx
 * function SubAccountButton() {
 *   const { sdk, isReady, hasSession } = useBaseAccountSDK();
 *   
 *   const handleCreateSubAccount = async () => {
 *     if (!isReady || !hasSession) return;
 *     
 *     const subAccount = await sdk.subAccount.create({
 *       name: 'My Sub Account',
 *     });
 *     console.log('Created sub-account:', subAccount);
 *   };
 *   
 *   return (
 *     <button onClick={handleCreateSubAccount} disabled={!isReady || !hasSession}>
 *       Create Sub Account
 *     </button>
 *   );
 * }
 * ```
 */
export function useBaseAccountSDK() {
  return useSDKContext();
}

/**
 * Hook to optionally access the Base Account SDK
 * 
 * Returns null if used outside of BaseAccountSDKProvider instead of throwing.
 * Use this for components that may or may not have SDK access.
 * 
 * @returns SDK context or null
 */
export function useBaseAccountSDKOptional() {
  return useSDKContextOptional();
}

/**
 * Hook to access the EIP-1193 provider from Base Account SDK
 * 
 * The provider can be used with viem, wagmi, web3.js, or any library
 * that supports EIP-1193 providers.
 * 
 * @returns Provider instance and loading state
 * 
 * @example
 * ```tsx
 * function ProviderInfo() {
 *   const { provider, isReady } = useBaseProvider();
 *   
 *   const getChainId = async () => {
 *     if (!provider) return;
 *     const chainId = await provider.request({ method: 'eth_chainId' });
 *     console.log('Chain ID:', chainId);
 *   };
 *   
 *   return <button onClick={getChainId} disabled={!isReady}>Get Chain ID</button>;
 * }
 * ```
 */
export function useBaseProvider() {
  const context = useSDKContext();
  
  return {
    provider: context.provider,
    isReady: context.isReady,
    hasSession: context.hasSession,
  };
}

/**
 * Hook to access Base Account session state
 * 
 * Provides session information and account details.
 * 
 * @returns Session state, account info, and refresh function
 * 
 * @example
 * ```tsx
 * function SessionInfo() {
 *   const { hasSession, account, refreshSession } = useBaseSession();
 *   
 *   return (
 *     <div>
 *       {hasSession ? (
 *         <>
 *           <p>Address: {account?.address}</p>
 *           <button onClick={refreshSession}>Refresh</button>
 *         </>
 *       ) : (
 *         <p>No active session</p>
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */
export function useBaseSession() {
  const context = useSDKContext();
  
  return {
    hasSession: context.hasSession,
    account: context.account,
    refreshSession: context.refreshSession,
    isReady: context.isReady,
  };
}

/**
 * Hook to manage sub-accounts (lightweight version)
 * 
 * This is a simplified sub-account management hook for basic use cases.
 * For full sub-account functionality with spend permissions, use the hook
 * from '@/hooks/useBaseSubAccount' instead (default export).
 * 
 * Note: This function has a naming conflict with the separate useBaseSubAccount file.
 * The comprehensive version from useBaseSubAccount.ts is recommended for most use cases.
 * 
 * Sub-accounts enable frictionless in-app transactions without repeated signing.
 * They're ideal for gaming, social apps, and any use case where UX is critical.
 * 
 * @returns Functions for creating and managing sub-accounts
 * 
 * @example
 * ```tsx
 * function SubAccountManager() {
 *   const { createSubAccount, isReady, hasSession } = useBaseAccountSubAccount();
 *   const [subAccountAddress, setSubAccountAddress] = useState<string | null>(null);
 *   
 *   const handleCreate = async () => {
 *     const result = await createSubAccount({
 *       name: 'Gaming Account',
 *     });
 *     
 *     if (result) {
 *       setSubAccountAddress(result.address);
 *     }
 *   };
 *   
 *   return (
 *     <div>
 *       <button onClick={handleCreate} disabled={!isReady || !hasSession}>
 *         Create Sub Account
 *       </button>
 *       {subAccountAddress && <p>Sub-account: {subAccountAddress}</p>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useBaseAccountSubAccount() {
  const { sdk, isReady, hasSession } = useSDKContext();
  
  /**
   * Create a new sub-account
   */
  const createSubAccount = useCallback(async (options?: {
    name?: string;
  }): Promise<{ address: Address } | null> => {
    if (!isReady || !hasSession) {
      console.warn('[useBaseSubAccount] SDK not ready or no active session');
      return null;
    }
    
    try {
      // Check if SDK has subAccount API
      if ('subAccount' in sdk && sdk.subAccount && 'create' in sdk.subAccount) {
        const result = await sdk.subAccount.create(options || {});
        console.log('[useBaseSubAccount] Sub-account created:', result);
        return result as { address: Address };
      }
      
      console.warn('[useBaseSubAccount] Sub-account API not available in this SDK version');
      return null;
    } catch (error) {
      console.error('[useBaseSubAccount] Failed to create sub-account:', error);
      return null;
    }
  }, [sdk, isReady, hasSession]);
  
  return {
    createSubAccount,
    isReady,
    hasSession,
  };
}

// Note: There is a more comprehensive useBaseSubAccount hook in a separate file.
// Export this with a different name to avoid conflicts when importing from index.
// The separate file version is recommended for most use cases as it includes
// spend permission integration and more features.

/**
 * Hook to work with Base Account payment features
 * 
 * Provides access to USDC payments and subscriptions on Base.
 * 
 * @returns Payment utility functions
 * 
 * @example
 * ```tsx
 * function PaymentButton() {
 *   const { pay, getPaymentStatus, isReady } = useBasePayments();
 *   
 *   const handlePayment = async () => {
 *     const result = await pay({
 *       amount: '10', // 10 USDC
 *       recipient: '0x...',
 *     });
 *     
 *     if (result) {
 *       const status = await getPaymentStatus(result.transactionHash);
 *       console.log('Payment status:', status);
 *     }
 *   };
 *   
 *   return <button onClick={handlePayment} disabled={!isReady}>Pay 10 USDC</button>;
 * }
 * ```
 */
export function useBasePayments() {
  const { sdk, isReady, hasSession } = useSDKContext();
  
  /**
   * Send a USDC payment
   */
  const pay = useCallback(async (options: {
    amount: string;
    recipient: Address;
  }): Promise<{ transactionHash: string } | null> => {
    if (!isReady || !hasSession) {
      console.warn('[useBasePayments] SDK not ready or no active session');
      return null;
    }
    
    try {
      // Check if SDK has payment API
      if ('pay' in sdk && typeof sdk.pay === 'function') {
        const result = await (sdk as any).pay(options);
        console.log('[useBasePayments] Payment sent:', result);
        return result;
      }
      
      console.warn('[useBasePayments] Payment API not available in this SDK version');
      return null;
    } catch (error) {
      console.error('[useBasePayments] Payment failed:', error);
      return null;
    }
  }, [sdk, isReady, hasSession]);
  
  /**
   * Get payment status
   */
  const getPaymentStatus = useCallback(async (transactionHash: string): Promise<any | null> => {
    if (!isReady) {
      console.warn('[useBasePayments] SDK not ready');
      return null;
    }
    
    try {
      // Check if SDK has payment status API
      if ('getPaymentStatus' in sdk && typeof sdk.getPaymentStatus === 'function') {
        const status = await (sdk as any).getPaymentStatus(transactionHash);
        return status;
      }
      
      console.warn('[useBasePayments] Payment status API not available in this SDK version');
      return null;
    } catch (error) {
      console.error('[useBasePayments] Failed to get payment status:', error);
      return null;
    }
  }, [sdk, isReady]);
  
  return {
    pay,
    getPaymentStatus,
    isReady,
    hasSession,
  };
}

/**
 * Re-export context provider for convenience
 */
export { BaseAccountSDKProvider } from '../contexts/BaseAccountSDKContext';

/**
 * Type exports for TypeScript support
 */
export type { Address };
