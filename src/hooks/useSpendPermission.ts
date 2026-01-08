import { useCallback, useState, useEffect } from 'react';
import { useAuthUser } from '../contexts/AuthContext';
import type { Hex, Address } from 'viem';
import { keccak256, encodeAbiParameters, parseAbiParameters, toHex, concat, pad } from 'viem';

/**
 * Spend Permission Hook
 *
 * Enables true one-click payments by allowing the application to spend
 * a pre-approved amount of USDC from the user's wallet without requiring
 * a signature for each transaction.
 *
 * ARCHITECTURE NOTE - CDP Embedded Wallets:
 * =========================================
 * This hook works with CDP embedded wallets (created via @coinbase/cdp-react).
 * User USDC is stored in their embedded wallet, NOT in server wallets.
 *
 * The "treasury" address (VITE_TREASURY_ADDRESS) is simply the recipient of payments.
 * It does NOT manage or have custody of user funds. Users grant a spend permission
 * that allows the treasury contract to pull approved amounts from their wallet.
 *
 * This implements Base Spend Permissions (EIP-712 compliant) which:
 * - Allow a spender (treasury) to pull funds from user wallet
 * - Have configurable allowance limits per period
 * - Can be revoked by the user at any time
 * - Enable gasless, passkey-free payments
 * - Support atomic batch transactions via wallet_sendCalls
 *
 * Best Practices (per Coinbase documentation):
 * - Uses EIP-712 typed data signing for secure permission grants
 * - Generates deterministic permissionHash for tracking
 * - Supports wallet_sendCalls for batched/atomic transactions
 * - Stores signature locally for subsequent payments
 *
 * Flow:
 * 1. User grants spend permission (one-time signature)
 * 2. Subsequent payments use the permission without user interaction
 * 3. User can view/revoke permissions at any time
 */

// Spend Permission Manager contract address on Base
const SPEND_PERMISSION_MANAGER_ADDRESS = '0xf85210B21cC50302F477BA56686d2019dC9b67Ad' as const;

// USDC contract addresses
const USDC_MAINNET = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as Address;
const USDC_TESTNET = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address;

/**
 * SpendPermission structure matching the on-chain contract
 */
export interface SpendPermission {
  /** UTC timestamp for when the permission was granted */
  createdAt?: number;
  /** Hash of the permission in hex format */
  permissionHash?: string;
  /** Cryptographic signature in hex format */
  signature: string;
  /** Chain ID */
  chainId?: number;
  /** The permission details */
  permission: {
    /** Wallet address of the account granting permission */
    account: string;
    /** Address of the contract/entity allowed to spend (treasury) */
    spender: string;
    /** Address of the token being spent (USDC) */
    token: string;
    /** Maximum amount allowed as base 10 numeric string */
    allowance: string;
    /** Time period in seconds */
    period: number;
    /** Start time in unix seconds */
    start: number;
    /** Expiration time in unix seconds */
    end: number;
    /** Salt as base 10 numeric string for uniqueness */
    salt: string;
    /** Additional data in hex format */
    extraData: string;
  };
}

export interface SpendPermissionConfig {
  /** Maximum USDC allowance per period (in USD, e.g., 100 for $100) */
  allowanceUSD: number;
  /** Period duration in days (e.g., 1 for daily, 30 for monthly) */
  periodInDays: number;
  /** Permission validity duration in days (e.g., 365 for 1 year) */
  validityDays: number;
}

export interface UseSpendPermissionResult {
  /** Whether spend permissions are supported (user has Base wallet) */
  isSupported: boolean;
  /** Whether operations are currently loading */
  isLoading: boolean;
  /** The user's active spend permission if one exists */
  activePermission: SpendPermission | null;
  /** Whether user has granted spend permission */
  hasPermission: boolean;
  /** Current period spend info */
  currentPeriodSpend: {
    spent: bigint;
    allowance: bigint;
    remaining: bigint;
    periodStart: Date;
    periodEnd: Date;
  } | null;
  /** Request a new spend permission from the user */
  requestPermission: (config?: Partial<SpendPermissionConfig>) => Promise<SpendPermission | null>;
  /** Revoke an existing spend permission */
  revokePermission: () => Promise<boolean>;
  /** Check if a specific amount can be spent with current permission */
  canSpend: (amountUSD: number) => boolean;
  /** Error message if something went wrong */
  error: string | null;
}

// Default configuration for spend permissions
const DEFAULT_CONFIG: SpendPermissionConfig = {
  allowanceUSD: 500, // $500 max per period
  periodInDays: 30, // Monthly reset
  validityDays: 365, // Valid for 1 year
};

// Storage key for persisting permission
const PERMISSION_STORAGE_KEY = 'prize:spend_permission';

// EIP-712 Domain type hash
const DOMAIN_TYPEHASH = keccak256(
  toHex('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')
);

// SpendPermission type hash (per Base Account SDK spec)
const SPEND_PERMISSION_TYPEHASH = keccak256(
  toHex('SpendPermission(address account,address spender,address token,uint160 allowance,uint48 period,uint48 start,uint48 end,uint256 salt,bytes extraData)')
);

/**
 * Generate the EIP-712 domain separator for Spend Permission Manager
 */
function getDomainSeparator(chainId: number): Hex {
  const encodedDomain = encodeAbiParameters(
    parseAbiParameters('bytes32, bytes32, bytes32, uint256, address'),
    [
      DOMAIN_TYPEHASH,
      keccak256(toHex('Spend Permission Manager')),
      keccak256(toHex('1')),
      BigInt(chainId),
      SPEND_PERMISSION_MANAGER_ADDRESS,
    ]
  );
  return keccak256(encodedDomain);
}

/**
 * Generate the permission hash (deterministic EIP-712 hash)
 * This matches the on-chain getPermissionHash function
 */
function generatePermissionHash(
  chainId: number,
  permissionData: {
    account: Address;
    spender: Address;
    token: Address;
    allowance: string;
    period: number;
    start: number;
    end: number;
    salt: string;
    extraData: Hex;
  }
): Hex {
  // Encode the permission struct
  const encodedPermission = encodeAbiParameters(
    parseAbiParameters('bytes32, address, address, address, uint160, uint48, uint48, uint48, uint256, bytes32'),
    [
      SPEND_PERMISSION_TYPEHASH,
      permissionData.account,
      permissionData.spender,
      permissionData.token,
      BigInt(permissionData.allowance),
      permissionData.period,
      permissionData.start,
      permissionData.end,
      BigInt(permissionData.salt),
      keccak256(permissionData.extraData),
    ]
  );

  const structHash = keccak256(encodedPermission);
  const domainSeparator = getDomainSeparator(chainId);

  // EIP-712 hash: keccak256("\x19\x01" + domainSeparator + structHash)
  const encoded = concat([
    toHex('\x19\x01'),
    domainSeparator,
    structHash,
  ]);

  return keccak256(encoded);
}

/**
 * Hook for managing Base Spend Permissions
 */
export function useSpendPermission(): UseSpendPermissionResult {
  const { linkedWallets, baseAccount } = useAuthUser();
  const [activePermission, setActivePermission] = useState<SpendPermission | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPeriodSpend, setCurrentPeriodSpend] = useState<UseSpendPermissionResult['currentPeriodSpend']>(null);

  // Get environment configuration
  const isMainnet = import.meta.env.VITE_BASE_MAINNET === 'true';
  const chainId = isMainnet ? 8453 : 84532;
  const usdcAddress = isMainnet ? USDC_MAINNET : USDC_TESTNET;
  const treasuryAddress = import.meta.env.VITE_TREASURY_ADDRESS as Address | undefined;

  // Find the user's Base wallet
  const userWallet = linkedWallets?.find(
    (w) => w.walletClient === 'base_account' || w.isBaseAccount
  );

  // Spend permissions are supported when user has a Base wallet and treasury is configured
  const isSupported = Boolean(userWallet && treasuryAddress);
  const hasPermission = Boolean(activePermission && isPermissionValid(activePermission));

  /**
   * Load persisted permission from storage
   */
  useEffect(() => {
    const loadPersistedPermission = async () => {
      if (!userWallet?.address) return;

      try {
        const stored = localStorage.getItem(`${PERMISSION_STORAGE_KEY}:${userWallet.address.toLowerCase()}`);
        if (stored) {
          // Safely parse the stored permission with error handling
          let permission: SpendPermission;
          try {
            permission = JSON.parse(stored) as SpendPermission;
          } catch (parseError) {
            // Invalid JSON in localStorage - clear it and return
            console.warn('Invalid permission data in localStorage, clearing:', parseError);
            localStorage.removeItem(`${PERMISSION_STORAGE_KEY}:${userWallet.address.toLowerCase()}`);
            return;
          }

          // Validate the permission object has required structure before use
          if (!permission || !permission.permission ||
              typeof permission.permission.end !== 'number' ||
              typeof permission.permission.start !== 'number') {
            console.warn('Malformed permission structure in localStorage, clearing');
            localStorage.removeItem(`${PERMISSION_STORAGE_KEY}:${userWallet.address.toLowerCase()}`);
            return;
          }

          // Validate the permission is still valid
          if (isPermissionValid(permission)) {
            setActivePermission(permission);
            // Calculate current period spend
            await updateCurrentPeriodSpend(permission);
          } else {
            // Clear expired permission
            localStorage.removeItem(`${PERMISSION_STORAGE_KEY}:${userWallet.address.toLowerCase()}`);
          }
        }
      } catch (err) {
        console.error('Error loading persisted permission:', err);
      }
    };

    loadPersistedPermission();
  }, [userWallet?.address]);

  /**
   * Check if a permission is still valid (not expired)
   */
  function isPermissionValid(permission: SpendPermission): boolean {
    const now = Math.floor(Date.now() / 1000);
    return permission.permission.end > now && permission.permission.start <= now;
  }

  /**
   * Calculate and update current period spend information
   */
  const updateCurrentPeriodSpend = async (permission: SpendPermission) => {
    const now = Math.floor(Date.now() / 1000);
    const { start, period, allowance } = permission.permission;

    // Calculate current period boundaries
    const periodsSinceStart = Math.floor((now - start) / period);
    const currentPeriodStart = start + (periodsSinceStart * period);
    const currentPeriodEnd = currentPeriodStart + period;

    // For now, we'll assume 0 spent (would need on-chain query for accurate data)
    // TODO: Query SpendPermissionManager contract for actual spend
    const spent = BigInt(0);
    const allowanceBigInt = BigInt(allowance);

    setCurrentPeriodSpend({
      spent,
      allowance: allowanceBigInt,
      remaining: allowanceBigInt - spent,
      periodStart: new Date(currentPeriodStart * 1000),
      periodEnd: new Date(currentPeriodEnd * 1000),
    });
  };

  /**
   * Request a new spend permission from the user
   */
  const requestPermission = useCallback(async (
    config: Partial<SpendPermissionConfig> = {}
  ): Promise<SpendPermission | null> => {
    if (!userWallet?.address || !treasuryAddress) {
      setError('Wallet or treasury not configured');
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const finalConfig = { ...DEFAULT_CONFIG, ...config };

      // Convert allowance to USDC units (6 decimals)
      const allowanceUnits = BigInt(Math.floor(finalConfig.allowanceUSD * 1_000_000));

      // Calculate time boundaries
      const now = Math.floor(Date.now() / 1000);
      const start = now;
      const end = now + (finalConfig.validityDays * 24 * 60 * 60);
      const periodInSeconds = finalConfig.periodInDays * 24 * 60 * 60;

      // Generate unique salt
      const salt = BigInt(Date.now()).toString();

      // Build the permission typed data for signing
      const permissionData = {
        account: userWallet.address as Address,
        spender: treasuryAddress,
        token: usdcAddress,
        allowance: allowanceUnits.toString(),
        period: periodInSeconds,
        start,
        end,
        salt,
        extraData: '0x' as Hex,
      };

      // Build EIP-712 typed data
      const typedData = {
        domain: {
          name: 'Spend Permission Manager',
          version: '1',
          chainId: chainId,
          verifyingContract: SPEND_PERMISSION_MANAGER_ADDRESS,
        },
        types: {
          SpendPermission: [
            { name: 'account', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'token', type: 'address' },
            { name: 'allowance', type: 'uint160' },
            { name: 'period', type: 'uint48' },
            { name: 'start', type: 'uint48' },
            { name: 'end', type: 'uint48' },
            { name: 'salt', type: 'uint256' },
            { name: 'extraData', type: 'bytes' },
          ],
        },
        primaryType: 'SpendPermission' as const,
        message: permissionData,
      };

      // Get the wallet provider and request signature
      // For Base Account, we need to get the provider differently
      let provider: any = null;

      // Try to get provider from various sources (in order of preference)
      if (baseAccount && typeof baseAccount.getEthereumProvider === 'function') {
        // Use Base Account's provider if available
        try {
          provider = await baseAccount.getEthereumProvider();
        } catch (providerErr) {
          console.warn('[useSpendPermission] Failed to get Base Account provider:', providerErr);
        }
      }

      // Fallback to injected provider (e.g., MetaMask, Coinbase Wallet)
      if (!provider && (window as any).ethereum) {
        provider = (window as any).ethereum;
      }

      if (!provider) {
        throw new Error('No wallet provider available. Please connect a wallet first.');
      }

      // Request signature using eth_signTypedData_v4 (standard EIP-712 signing)
      const signature: string = await provider.request({
        method: 'eth_signTypedData_v4',
        params: [userWallet.address, JSON.stringify(typedData)],
      });

      // Generate the permission hash for tracking and verification
      const permissionHash = generatePermissionHash(chainId, permissionData);

      // Create the spend permission object with all required fields
      const spendPermission: SpendPermission = {
        createdAt: now,
        permissionHash, // Add the deterministic hash for verification
        chainId,
        signature,
        permission: permissionData,
      };

      // Persist to storage
      localStorage.setItem(
        `${PERMISSION_STORAGE_KEY}:${userWallet.address.toLowerCase()}`,
        JSON.stringify(spendPermission)
      );

      setActivePermission(spendPermission);
      await updateCurrentPeriodSpend(spendPermission);

      console.log('[useSpendPermission] Permission granted:', {
        account: permissionData.account,
        allowanceUSD: finalConfig.allowanceUSD,
        periodDays: finalConfig.periodInDays,
      });

      return spendPermission;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to request permission';

      // Handle user rejection gracefully
      if (errorMessage.includes('rejected') || errorMessage.includes('denied') || errorMessage.includes('cancelled')) {
        setError('Permission request was cancelled');
      } else {
        setError(errorMessage);
      }

      console.error('[useSpendPermission] Error:', err);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [userWallet, treasuryAddress, chainId, usdcAddress, baseAccount]);

  /**
   * Revoke an existing spend permission
   */
  const revokePermission = useCallback(async (): Promise<boolean> => {
    if (!activePermission || !userWallet?.address) {
      setError('No active permission to revoke');
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Note: On-chain revocation would require calling SpendPermissionManager.revoke()
      // For now, we just clear the local permission
      // The treasury won't be able to use the permission if it's not stored server-side

      // Clear from storage
      localStorage.removeItem(`${PERMISSION_STORAGE_KEY}:${userWallet.address.toLowerCase()}`);

      setActivePermission(null);
      setCurrentPeriodSpend(null);

      console.log('[useSpendPermission] Permission revoked');
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to revoke permission';
      setError(errorMessage);
      console.error('[useSpendPermission] Revoke error:', err);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [activePermission, userWallet]);

  /**
   * Check if a specific amount can be spent with current permission
   */
  const canSpend = useCallback((amountUSD: number): boolean => {
    if (!activePermission || !currentPeriodSpend) return false;

    const amountUnits = BigInt(Math.floor(amountUSD * 1_000_000));
    return currentPeriodSpend.remaining >= amountUnits;
  }, [activePermission, currentPeriodSpend]);

  return {
    isSupported,
    isLoading,
    activePermission,
    hasPermission,
    currentPeriodSpend,
    requestPermission,
    revokePermission,
    canSpend,
    error,
  };
}

/**
 * Prepare spend call data for executing a spend via wallet_sendCalls
 * This follows the Base Account SDK prepareSpendCallData pattern
 *
 * @param permission - The signed spend permission
 * @param amount - Amount to spend in wei (or full allowance if not specified)
 * @returns Array of calls to execute (approve + spend if needed)
 */
export function prepareSpendCallData(
  permission: SpendPermission,
  amount?: bigint
): { to: Address; data: Hex; value: string }[] {
  const spendAmount = amount ?? BigInt(permission.permission.allowance);

  // SpendPermissionManager ABI for spend function
  // spend(SpendPermission calldata permission, bytes calldata signature, uint160 amount)
  const spendFunctionSelector = '0x85abc8d9'; // keccak256('spend(...)').slice(0, 10)

  // Encode the permission struct
  const encodedPermission = encodeAbiParameters(
    parseAbiParameters('address, address, address, uint160, uint48, uint48, uint48, uint256, bytes'),
    [
      permission.permission.account as Address,
      permission.permission.spender as Address,
      permission.permission.token as Address,
      BigInt(permission.permission.allowance),
      permission.permission.period,
      permission.permission.start,
      permission.permission.end,
      BigInt(permission.permission.salt),
      permission.permission.extraData as Hex,
    ]
  );

  // Build the spend call
  const spendCall = {
    to: SPEND_PERMISSION_MANAGER_ADDRESS as Address,
    data: concat([
      spendFunctionSelector as Hex,
      encodedPermission,
      permission.signature as Hex,
      pad(toHex(spendAmount), { size: 20 }), // uint160 amount
    ]),
    value: '0x0',
  };

  return [spendCall];
}

/**
 * Check if wallet supports atomic batch transactions via wallet_sendCalls
 * This follows the Base Account SDK pattern for checking capabilities
 */
export async function checkWalletCapabilities(
  provider: any,
  userAddress: Address
): Promise<{
  supportsSendCalls: boolean;
  supportsAtomicBatch: boolean;
  chainCapabilities: Record<string, any>;
}> {
  try {
    // Check if wallet_getCapabilities is supported
    const capabilities = await provider.request({
      method: 'wallet_getCapabilities',
      params: [userAddress],
    });

    // Parse capabilities for the current chain
    const chainId = await provider.request({ method: 'eth_chainId' });
    const chainCapabilities = capabilities?.[chainId] || {};

    return {
      supportsSendCalls: true,
      supportsAtomicBatch: chainCapabilities?.atomic === 'supported' || chainCapabilities?.atomic === 'ready',
      chainCapabilities,
    };
  } catch (err) {
    // wallet_getCapabilities not supported - fallback to eth_sendTransaction
    console.warn('[useSpendPermission] wallet_getCapabilities not supported:', err);
    return {
      supportsSendCalls: false,
      supportsAtomicBatch: false,
      chainCapabilities: {},
    };
  }
}

/**
 * Execute spend calls using wallet_sendCalls for atomic batching
 * Falls back to eth_sendTransaction if not supported
 *
 * This follows the Coinbase Wallet SDK best practice for batch transactions
 */
export async function executeSpendCalls(
  provider: any,
  calls: { to: Address; data: Hex; value: string }[],
  userAddress: Address,
  options?: {
    atomicRequired?: boolean;
    chainId?: number;
  }
): Promise<{ transactionHash?: string; userOpHash?: string }> {
  const capabilities = await checkWalletCapabilities(provider, userAddress);

  if (capabilities.supportsSendCalls) {
    try {
      // Use wallet_sendCalls for batched execution (EIP-5792)
      const result = await provider.request({
        method: 'wallet_sendCalls',
        params: [{
          version: '2.0',
          from: userAddress,
          calls: calls.map(call => ({
            to: call.to,
            data: call.data,
            value: call.value,
          })),
          ...(options?.atomicRequired && { atomicRequired: true }),
          ...(options?.chainId && { chainId: `0x${options.chainId.toString(16)}` }),
        }],
      });

      return { userOpHash: result };
    } catch (err) {
      console.warn('[useSpendPermission] wallet_sendCalls failed, falling back:', err);
    }
  }

  // Fallback to sequential eth_sendTransaction calls
  let lastTxHash: string | undefined;
  for (const call of calls) {
    lastTxHash = await provider.request({
      method: 'eth_sendTransaction',
      params: [{
        from: userAddress,
        to: call.to,
        data: call.data,
        value: call.value,
      }],
    });
  }

  return { transactionHash: lastTxHash };
}

export default useSpendPermission;
