/**
 * Base Account SDK Initialization
 * 
 * This module initializes and exports a singleton instance of the Base Account SDK.
 * The SDK provides comprehensive account management, wallet connectivity, and 
 * payment capabilities for Base network integration.
 * 
 * Key Features:
 * - EIP-1193 compliant provider for seamless integration with viem/wagmi
 * - Sub-account creation and management
 * - Spend permissions for one-click payments
 * - Session management and authentication
 * - Crypto key account management
 * 
 * Documentation: https://docs.base.org/base-account/reference/core/sdk-api
 */

import { createBaseAccountSDK } from '@base-org/account';
import { base, baseSepolia } from 'viem/chains';

/**
 * Type for the Base Account SDK instance
 * Since the SDK doesn't export this type, we infer it from the return value
 */
type BaseAccountSDK = ReturnType<typeof createBaseAccountSDK>;

/**
 * Get the active chain ID based on environment configuration
 */
function getActiveChainId(): number {
  const isMainnet = import.meta.env.VITE_BASE_MAINNET === 'true';
  return isMainnet ? base.id : baseSepolia.id;
}

/**
 * Get the app logo URL from environment or use default
 */
function getAppLogoUrl(): string {
  // Try to get from environment, fallback to relative path for self-hosted
  const envLogoUrl = import.meta.env.VITE_APP_LOGO_URL;
  if (envLogoUrl) {
    return envLogoUrl;
  }
  
  // Use production URL or current origin for logo
  if (typeof window !== 'undefined') {
    const origin = window.location.origin;
    return `${origin}/logo.png`;
  }
  
  return 'https://theprize.io/logo.png';
}

/**
 * Get the app name from environment or use default
 */
function getAppName(): string {
  return import.meta.env.VITE_APP_NAME || 'The Prize - Win Big with Crypto';
}

/**
 * Get supported chain IDs for the application
 * 
 * Returns an array of chain IDs that the application supports.
 * In mainnet mode, only Base mainnet (8453) is supported.
 * In testnet mode, both Base mainnet and Base Sepolia (84532) are supported.
 */
function getSupportedChainIds(): number[] {
  const isMainnet = import.meta.env.VITE_BASE_MAINNET === 'true';
  
  if (isMainnet) {
    // Production: Only Base mainnet
    return [base.id];
  } else {
    // Development: Support both Base mainnet and Base Sepolia testnet
    return [base.id, baseSepolia.id];
  }
}

/**
 * Get paymaster URLs for gas sponsorship (if configured)
 * 
 * Paymasters enable gasless transactions by sponsoring gas fees.
 * This is optional but improves UX for users.
 */
function getPaymasterUrls(): Record<number, string> | undefined {
  const paymasterUrl = import.meta.env.VITE_PAYMASTER_URL;
  
  if (!paymasterUrl) {
    return undefined;
  }
  
  const chainId = getActiveChainId();
  return {
    [chainId]: paymasterUrl,
  };
}

/**
 * SDK Configuration
 * 
 * This configuration is used to initialize the Base Account SDK.
 * It defines the app metadata, supported chains, and sub-account behavior.
 */
const sdkConfig = {
  // App metadata displayed in wallet UI (all required by SDK)
  appName: getAppName(),
  appLogoUrl: getAppLogoUrl(),
  
  // Supported chain IDs (Base mainnet and/or Base Sepolia)
  appChainIds: getSupportedChainIds(),
  
  // Sub-account configuration
  // - creation: 'manual' means sub-accounts are created on-demand by user action
  // - defaultAccount: 'universal' uses the parent account by default
  // - funding: 'spend-permissions' enables spend permissions for sub-accounts
  subAccounts: {
    creation: 'manual' as const,        // Don't auto-create sub-accounts, let user trigger it
    defaultAccount: 'universal' as const, // Use parent account by default
    funding: 'spend-permissions' as const, // Enable spend permissions for one-click payments
  },
  
  // Optional: Paymaster URLs for gas sponsorship
  paymasterUrls: getPaymasterUrls(),
  
  // Preferences
  preference: {
    // Enable telemetry for analytics (helps Base improve the SDK)
    telemetry: true,
    
    // Attribution for Smart Wallet usage tracking
    attribution: {
      auto: true, // Auto-generate attribution based on app origin
    } as const,
  },
};

/**
 * Singleton SDK instance
 * 
 * This is initialized once and reused throughout the application.
 * The SDK is lazily initialized on first use to avoid unnecessary setup.
 */
let sdkInstance: BaseAccountSDK | null = null;

/**
 * Get or create the Base Account SDK instance
 * 
 * This function returns a singleton SDK instance, creating it on first call.
 * The instance is cached for subsequent calls to avoid re-initialization.
 * 
 * @returns The Base Account SDK instance
 */
export function getBaseAccountSDK(): BaseAccountSDK {
  if (!sdkInstance) {
    console.log('[BaseAccountSDK] Initializing SDK with config:', {
      appName: sdkConfig.appName,
      appLogoUrl: sdkConfig.appLogoUrl,
      chainIds: sdkConfig.appChainIds,
      subAccounts: sdkConfig.subAccounts,
    });
    
    sdkInstance = createBaseAccountSDK(sdkConfig);
    
    console.log('[BaseAccountSDK] SDK initialized successfully');
  }
  
  return sdkInstance;
}

/**
 * Get the EIP-1193 provider from the SDK
 * 
 * This provider can be used with viem, wagmi, web3.js, or any other
 * library that supports EIP-1193 providers.
 * 
 * Note: The provider is only created when this function is first called.
 * 
 * @returns The EIP-1193 provider
 */
export function getSDKProvider() {
  const sdk = getBaseAccountSDK();
  return sdk.getProvider();
}

/**
 * Get the current crypto key account from the SDK
 * 
 * This returns information about the currently authenticated account,
 * including the address and public key.
 * 
 * @returns Promise resolving to the crypto key account or null if not authenticated
 */
export async function getCryptoKeyAccount() {
  const sdk = getBaseAccountSDK();
  
  try {
    // Type guard to check if getCryptoKeyAccount exists on SDK
    // This method may not be available in all SDK versions
    if ('getCryptoKeyAccount' in sdk && typeof sdk.getCryptoKeyAccount === 'function') {
      return await sdk.getCryptoKeyAccount();
    }
    
    console.warn('[BaseAccountSDK] getCryptoKeyAccount not available in this SDK version');
    return null;
  } catch (error) {
    console.error('[BaseAccountSDK] Error getting crypto key account:', error);
    return null;
  }
}

/**
 * Check if the SDK has an active session
 * 
 * @returns Promise resolving to true if there's an active session
 */
export async function hasActiveSession(): Promise<boolean> {
  try {
    const account = await getCryptoKeyAccount();
    return account !== null;
  } catch (error) {
    console.error('[BaseAccountSDK] Error checking session:', error);
    return false;
  }
}

/**
 * Reset the SDK instance
 * 
 * This is useful for testing or when you need to reinitialize the SDK
 * with different configuration.
 * 
 * WARNING: This will break any existing provider instances.
 */
export function resetSDK() {
  console.warn('[BaseAccountSDK] Resetting SDK instance');
  sdkInstance = null;
}

// Export the SDK configuration for reference
export { sdkConfig };

// Default export is the SDK getter function
export default getBaseAccountSDK;
