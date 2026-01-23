/**
 * Base Account SDK Context
 * 
 * Provides a React Context for accessing the Base Account SDK throughout the application.
 * This context initializes the SDK once and makes it available to all components.
 * 
 * Features:
 * - Singleton SDK instance management
 * - EIP-1193 provider access for viem/wagmi integration
 * - Session state tracking
 * - Account information retrieval
 * 
 * Usage:
 * ```tsx
 * import { useBaseAccountSDK } from '@/contexts/BaseAccountSDKContext';
 * 
 * function MyComponent() {
 *   const { sdk, provider, hasSession } = useBaseAccountSDK();
 *   // Use sdk and provider...
 * }
 * ```
 */

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { createBaseAccountSDK } from '@base-org/account';
import { getBaseAccountSDK, getSDKProvider, hasActiveSession, getCryptoKeyAccount } from '../lib/base-account-sdk';

/**
 * Type for the Base Account SDK instance
 * Inferred from the return type of createBaseAccountSDK
 */
type BaseAccountSDK = ReturnType<typeof createBaseAccountSDK>;

interface BaseAccountSDKContextType {
  /** The Base Account SDK instance */
  sdk: BaseAccountSDK;
  /** The EIP-1193 provider from the SDK */
  provider: any;
  /** Whether the SDK is ready to use */
  isReady: boolean;
  /** Whether there's an active session */
  hasSession: boolean;
  /** Current account information */
  account: {
    address?: string;
    publicKey?: string;
  } | null;
  /** Refresh session state */
  refreshSession: () => Promise<void>;
  /** Error if SDK initialization failed */
  error: Error | null;
}

const BaseAccountSDKContext = createContext<BaseAccountSDKContextType | undefined>(undefined);

interface BaseAccountSDKProviderProps {
  children: ReactNode;
}

/**
 * Base Account SDK Provider
 * 
 * Initializes the Base Account SDK and provides it to child components.
 * Should be placed high in the component tree, ideally near the root.
 */
export function BaseAccountSDKProvider({ children }: BaseAccountSDKProviderProps) {
  const [isReady, setIsReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [account, setAccount] = useState<{ address?: string; publicKey?: string } | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Initialize SDK (memoized to prevent re-creation)
  const sdk = useMemo(() => {
    try {
      return getBaseAccountSDK();
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to initialize SDK');
      setError(error);
      console.error('[BaseAccountSDKProvider] SDK initialization error:', error);
      // Return a placeholder to prevent crashes
      return null as any;
    }
  }, []);

  // Get provider (memoized)
  const provider = useMemo(() => {
    if (!sdk) return null;
    
    try {
      return getSDKProvider();
    } catch (err) {
      console.error('[BaseAccountSDKProvider] Failed to get provider:', err);
      return null;
    }
  }, [sdk]);

  /**
   * Refresh session state and account information
   */
  const refreshSession = useCallback(async () => {
    try {
      // Check if there's an active session
      const sessionActive = await hasActiveSession();
      setHasSession(sessionActive);

      // Get account information if session is active
      if (sessionActive) {
        const cryptoKeyAccount = await getCryptoKeyAccount();
        if (cryptoKeyAccount) {
          setAccount({
            address: cryptoKeyAccount.address,
            publicKey: cryptoKeyAccount.publicKey,
          });
        } else {
          setAccount(null);
        }
      } else {
        setAccount(null);
      }
    } catch (err) {
      console.error('[BaseAccountSDKProvider] Error refreshing session:', err);
      setHasSession(false);
      setAccount(null);
    }
  }, []);

  /**
   * Initialize SDK and check session on mount
   */
  useEffect(() => {
    const initialize = async () => {
      if (!sdk) {
        console.error('[BaseAccountSDKProvider] SDK not available, skipping initialization');
        return;
      }

      try {
        console.log('[BaseAccountSDKProvider] Initializing SDK...');
        
        // The SDK is already initialized by getBaseAccountSDK()
        // Just refresh session state
        await refreshSession();
        
        setIsReady(true);
        console.log('[BaseAccountSDKProvider] SDK ready');
      } catch (err) {
        const error = err instanceof Error ? err : new Error('SDK initialization failed');
        setError(error);
        console.error('[BaseAccountSDKProvider] Initialization error:', error);
      }
    };

    initialize();
  }, [sdk, refreshSession]);

  /**
   * Listen for account changes from the provider
   */
  useEffect(() => {
    if (!provider) return;

    const handleAccountsChanged = (accounts: string[]) => {
      console.log('[BaseAccountSDKProvider] Accounts changed:', accounts);
      refreshSession();
    };

    const handleChainChanged = (chainId: string) => {
      console.log('[BaseAccountSDKProvider] Chain changed:', chainId);
      refreshSession();
    };

    // Subscribe to provider events if available
    try {
      if (provider.on) {
        provider.on('accountsChanged', handleAccountsChanged);
        provider.on('chainChanged', handleChainChanged);
      }
    } catch (err) {
      console.warn('[BaseAccountSDKProvider] Provider event subscription failed:', err);
    }

    return () => {
      // Cleanup event listeners
      try {
        if (provider.removeListener) {
          provider.removeListener('accountsChanged', handleAccountsChanged);
          provider.removeListener('chainChanged', handleChainChanged);
        }
      } catch (err) {
        console.warn('[BaseAccountSDKProvider] Provider event cleanup failed:', err);
      }
    };
  }, [provider, refreshSession]);

  const contextValue: BaseAccountSDKContextType = {
    sdk,
    provider,
    isReady,
    hasSession,
    account,
    refreshSession,
    error,
  };

  return (
    <BaseAccountSDKContext.Provider value={contextValue}>
      {children}
    </BaseAccountSDKContext.Provider>
  );
}

/**
 * Hook to access the Base Account SDK context
 * 
 * @throws Error if used outside of BaseAccountSDKProvider
 */
export function useBaseAccountSDK(): BaseAccountSDKContextType {
  const context = useContext(BaseAccountSDKContext);
  
  if (context === undefined) {
    throw new Error('useBaseAccountSDK must be used within a BaseAccountSDKProvider');
  }
  
  return context;
}

/**
 * Hook to check if Base Account SDK is available
 * 
 * This is a safe version that returns null if the provider is not available.
 * Useful for optional SDK features.
 */
export function useBaseAccountSDKOptional(): BaseAccountSDKContextType | null {
  const context = useContext(BaseAccountSDKContext);
  return context || null;
}

export default BaseAccountSDKProvider;
