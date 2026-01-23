import { useCallback, useState } from 'react';
import { useAuthUser } from '../contexts/AuthContext';
import { useBaseAccountSDK } from '../contexts/BaseAccountSDKContext';
import type { Hex, Address } from 'viem';
import { useSpendPermission, type SpendPermission, type SpendPermissionConfig } from './useSpendPermission';

/**
 * Base Sub Account Hook
 *
 * Enables seamless, passkey-free transactions for users with Base Accounts.
 * Sub Accounts are derived from the parent Base Account and can be controlled
 * by an embedded wallet, avoiding explicit passkey prompts on every transaction.
 *
 * This implements the Base + CDP Sub Account integration pattern using the
 * centralized Base Account SDK instance.
 *
 * Features:
 * - Automatic Sub Account creation for users with Base Accounts
 * - Embedded wallet control for passkey-free signing
 * - Spend Permissions for true one-click payments
 * - Combined Sub Account + Spend Permission for maximum UX
 * - Uses SDK methods from base-account-sdk.ts for consistency
 */

interface SubAccount {
  address: Hex;
  root: Hex;
  domain: string;
}

interface UseBaseSubAccountResult {
  /** Whether Sub Accounts are supported (user has both Base Account and embedded wallet) */
  isSupported: boolean;
  /** Whether Sub Account operations are currently loading */
  isLoading: boolean;
  /** The user's Sub Account if it exists */
  subAccount: SubAccount | null;
  /** The Base Account (parent account) */
  baseAccount: any | null;
  /** The embedded wallet that controls the Sub Account */
  embeddedWallet: any | null;
  /** Create or get the user's Sub Account */
  getOrCreateSubAccount: () => Promise<SubAccount | null>;
  /** Sign a message using the Sub Account (passkey-free) */
  signMessage: (message: string) => Promise<Hex | null>;
  /** Send a transaction using the Sub Account (passkey-free) */
  sendTransaction: (tx: {
    to: Hex;
    value?: bigint;
    data?: Hex;
  }) => Promise<Hex | null>;
  /** Error message if something went wrong */
  error: string | null;
  // Spend Permission integration
  /** Whether spend permissions are enabled */
  hasSpendPermission: boolean;
  /** Active spend permission details */
  spendPermission: SpendPermission | null;
  /** Request spend permission for one-click payments */
  enableOneClickPayments: (config?: Partial<SpendPermissionConfig>) => Promise<boolean>;
  /** Disable one-click payments by revoking permission */
  disableOneClickPayments: () => Promise<boolean>;
  /** Check if amount can be spent with current permission */
  canOneClickSpend: (amountUSD: number) => boolean;
  /** Current spend limit info */
  spendLimitInfo: {
    spent: bigint;
    allowance: bigint;
    remaining: bigint;
    periodStart: Date;
    periodEnd: Date;
  } | null;
}

export function useBaseSubAccount(): UseBaseSubAccountResult {
  const { linkedWallets } = useAuthUser();
  const { sdk, provider: sdkProvider, isReady: sdkReady } = useBaseAccountSDK();
  const [subAccount, setSubAccount] = useState<SubAccount | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Integrate spend permissions for true one-click payments
  const {
    isSupported: spendPermissionSupported,
    isLoading: spendPermissionLoading,
    activePermission,
    hasPermission,
    currentPeriodSpend,
    requestPermission,
    revokePermission,
    canSpend,
    error: spendPermissionError,
  } = useSpendPermission();

  // Find the Base Account and embedded wallet from connected wallets
  // Base Account: wallet with type='base_account' or isBaseAccount=true
  // Embedded wallet: wallet with isEmbeddedWallet=true or walletClient='privy'/'cdp'
  const baseAccount = linkedWallets?.find(
    (wallet: any) =>
      wallet.type === 'base_account' ||
      wallet.walletClient === 'base_account' ||
      wallet.isBaseAccount === true
  );
  const embeddedWallet = linkedWallets?.find(
    (wallet: any) =>
      wallet.isEmbeddedWallet === true ||
      wallet.walletClient === 'privy' ||
      wallet.walletClient === 'cdp'
  );

  // Sub Accounts are supported when user has both Base Account and embedded wallet
  const isSupported = Boolean(baseAccount && embeddedWallet);

  /**
   * Get or create a Sub Account for the current user
   * The Sub Account is derived from the Base Account and controlled by the embedded wallet
   * 
   * Uses the centralized SDK instance to ensure consistency across the application.
   */
  const getOrCreateSubAccount = useCallback(async (): Promise<SubAccount | null> => {
    if (!baseAccount || !embeddedWallet) {
      setError('Base Account and embedded wallet required for Sub Accounts');
      return null;
    }

    if (!sdkReady || !sdk) {
      setError('Base Account SDK not ready');
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Switch Base Account to Base network (or Base Sepolia for testnet)
      // The chain must be in the Privy supportedChains array in main.tsx
      const chainId = import.meta.env.VITE_BASE_MAINNET === 'true' ? 8453 : 84532;
      try {
        await baseAccount.switchChain(chainId);
      } catch (switchErr) {
        // If chain switch fails (e.g., chain not supported), log but continue
        // The wallet may already be on the correct chain or support will be limited
        console.warn('Chain switch failed, continuing with current chain:', switchErr);
      }

      // Use SDK provider instead of getting from wallet directly
      const provider = sdkProvider || await baseAccount.getEthereumProvider();
      const domain = window.location.origin;

      // Check for existing Sub Account using SDK methods if available
      // Otherwise fall back to provider requests
      let existingSubAccounts: any[] = [];
      
      try {
        // Type guard: Check if SDK has subAccount.list method
        if (sdk && 'subAccount' in sdk && sdk.subAccount && 
            typeof sdk.subAccount === 'object' && 'list' in sdk.subAccount &&
            typeof sdk.subAccount.list === 'function') {
          existingSubAccounts = await sdk.subAccount.list();
        } else {
          // Fall back to provider request
          const response = await provider.request({
            method: 'wallet_getSubAccounts',
            params: [{
              account: baseAccount.address as Hex,
              domain,
            }],
          });
          existingSubAccounts = response?.subAccounts || [];
        }
      } catch (err) {
        console.warn('[useBaseSubAccount] Error checking existing sub-accounts:', err);
      }

      if (existingSubAccounts && existingSubAccounts.length > 0) {
        const existing = existingSubAccounts[0];
        setSubAccount(existing);
        return existing;
      }

      // Create new Sub Account with embedded wallet as the owner
      // Try SDK method first, fall back to provider request
      let newSubAccount: SubAccount;
      
      try {
        // Type guard: Check if SDK has subAccount.create method
        if (sdk && 'subAccount' in sdk && sdk.subAccount && 
            typeof sdk.subAccount === 'object' && 'create' in sdk.subAccount &&
            typeof sdk.subAccount.create === 'function') {
          // Use SDK method
          newSubAccount = await sdk.subAccount.create({
            keys: [{
              type: 'address',
              publicKey: embeddedWallet.address as Hex,
            }],
          });
        } else {
          // Fall back to provider request
          newSubAccount = await provider.request({
            method: 'wallet_addSubAccount',
            params: [{
              version: '1',
              account: {
                type: 'create',
                keys: [{
                  type: 'address',
                  publicKey: embeddedWallet.address as Hex,
                }],
              },
            }],
          });
        }
      } catch (createErr) {
        console.error('[useBaseSubAccount] Error creating sub-account:', createErr);
        throw createErr;
      }

      setSubAccount(newSubAccount);
      return newSubAccount;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to get or create Sub Account';
      setError(errorMessage);
      console.error('Sub Account error:', err);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [baseAccount, embeddedWallet, sdk, sdkProvider, sdkReady]);

  /**
   * Sign a message using the Sub Account
   * This uses the embedded wallet to sign, avoiding passkey prompts
   */
  const signMessage = useCallback(async (message: string): Promise<Hex | null> => {
    if (!subAccount || !baseAccount) {
      setError('Sub Account not initialized');
      return null;
    }

    try {
      const provider = await baseAccount.getEthereumProvider();
      const { toHex } = await import('viem');

      // Sign with Sub Account address (not parent Base Account)
      const signature = await provider.request({
        method: 'personal_sign',
        params: [toHex(message), subAccount.address],
      });

      return signature as Hex;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to sign message';
      setError(errorMessage);
      console.error('Sign message error:', err);
      return null;
    }
  }, [subAccount, baseAccount]);

  /**
   * Send a transaction using the Sub Account
   * This uses the embedded wallet to sign, avoiding passkey prompts
   */
  const sendTransaction = useCallback(async (tx: {
    to: Hex;
    value?: bigint;
    data?: Hex;
  }): Promise<Hex | null> => {
    if (!subAccount || !baseAccount) {
      setError('Sub Account not initialized');
      return null;
    }

    try {
      const provider = await baseAccount.getEthereumProvider();

      // Send transaction from Sub Account address (not parent Base Account)
      const txHash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{
          from: subAccount.address,
          to: tx.to,
          value: tx.value ? `0x${tx.value.toString(16)}` : undefined,
          data: tx.data,
        }],
      });

      return txHash as Hex;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send transaction';
      setError(errorMessage);
      console.error('Send transaction error:', err);
      return null;
    }
  }, [subAccount, baseAccount]);

  // REMOVED: Auto-initialization was causing repeated popups on every page load
  // Sub Account creation should only happen when explicitly requested by user action
  // (e.g., when they click a "Enable one-click payments" button)
  //
  // The old code was:
  // useEffect(() => {
  //   if (isSupported && !subAccount && !isLoading) {
  //     const timer = setTimeout(() => {
  //       getOrCreateSubAccount();
  //     }, 1000);
  //     return () => clearTimeout(timer);
  //   }
  // }, [isSupported, subAccount, isLoading, getOrCreateSubAccount]);

  /**
   * Enable one-click payments by requesting a spend permission
   */
  const enableOneClickPayments = useCallback(async (
    config?: Partial<SpendPermissionConfig>
  ): Promise<boolean> => {
    const permission = await requestPermission(config);
    return permission !== null;
  }, [requestPermission]);

  /**
   * Disable one-click payments by revoking the spend permission
   */
  const disableOneClickPayments = useCallback(async (): Promise<boolean> => {
    return await revokePermission();
  }, [revokePermission]);

  return {
    isSupported,
    isLoading: isLoading || spendPermissionLoading,
    subAccount,
    baseAccount,
    embeddedWallet,
    getOrCreateSubAccount,
    signMessage,
    sendTransaction,
    error: error || spendPermissionError,
    // Spend permission properties
    hasSpendPermission: hasPermission,
    spendPermission: activePermission,
    enableOneClickPayments,
    disableOneClickPayments,
    canOneClickSpend: canSpend,
    spendLimitInfo: currentPeriodSpend,
  };
}

export default useBaseSubAccount;
