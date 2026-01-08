/**
 * Coinbase CDP SDK Service - Client-side wrapper
 *
 * @deprecated This module is DEPRECATED and should NOT be used for user payments.
 *
 * IMPORTANT: User funds are stored in CDP embedded wallets (created via @coinbase/cdp-react),
 * NOT in server-managed wallets. All payment flows should use:
 *
 * 1. CDP Embedded Wallets - User wallets created via email sign-in with cdp-react
 * 2. Spend Permissions - One-click payments where users authorize spending limits
 * 3. OnchainKit Checkout - For wallet-connected payments
 *
 * The server wallet functions in this module are retained for:
 * - Testnet faucet operations (development only)
 * - Internal/admin operations (if any)
 *
 * DO NOT use transferFromEoa(), transferFromSmartAccount(), or sendTransaction()
 * for user payment flows. User USDC is in their embedded wallet, not server wallets.
 *
 * All sensitive operations are handled server-side via the Netlify function.
 */

const CDP_API_BASE = '/api/cdp';

// Helper to determine default network based on environment
function getDefaultNetwork(): SupportedNetwork {
  const isMainnet = typeof import.meta !== 'undefined' && import.meta.env?.VITE_BASE_MAINNET === 'true';
  return isMainnet ? 'base' : 'base-sepolia';
}

// Supported tokens for transfers
export type SupportedToken = 'eth' | 'usdc' | 'weth' | 'sol' | string;

// Supported networks
export type SupportedNetwork = 'base-sepolia' | 'base' | 'solana-devnet' | string;

export interface CdpAccount {
  address: string;
  name: string;
}

export interface SmartAccount {
  address: string;
  ownerAddress: string;
  ownerName: string;
}

export interface TransferResult {
  transactionHash?: string;
  userOpHash?: string;
  status: string;
  from: string;
  to: string;
  amount: string;
  token: string;
  network: string;
  blockNumber?: number;
  explorerUrl: string;
}

export interface TransferParams {
  receiverAddress: string;
  amount: string;
  token?: SupportedToken;
  network?: SupportedNetwork;
}

export interface EoaTransferParams extends TransferParams {
  senderName: string;
}

export interface SmartAccountTransferParams extends TransferParams {
  ownerName: string;
}

export interface SolanaAccount {
  address: string;
  name: string | null;
  network: string;
}

export interface FaucetResult {
  transactionHash?: string;
  signature?: string;
  status?: string;
  address: string;
  token: string;
  network: string;
  blockNumber?: number;
  explorerUrl: string;
}

export interface SendTransactionParams {
  address: string;
  transaction: {
    to: string;
    value?: string;
    data?: string;
  };
  network?: SupportedNetwork;
}

export interface TransactionResult {
  transactionHash: string;
  status: string;
  from: string;
  to: string;
  value: string;
  network: string;
  blockNumber?: number;
  explorerUrl: string;
}

export interface SignedSolanaTransaction {
  signature: string;
  address: string;
}

/**
 * Helper to make API calls to the CDP function
 */
async function callCdpApi<T>(
  endpoint: string,
  method: 'GET' | 'POST' = 'POST',
  body?: Record<string, unknown>
): Promise<{ success: boolean; data?: T; error?: string }> {
  const url = `${CDP_API_BASE}${endpoint}`;

  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok || !data.success) {
      return {
        success: false,
        error: data.error || `Request failed with status ${response.status}`,
      };
    }

    return { success: true, data };
  } catch (error) {
    console.error('CDP API call error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

export class CdpSdkService {
  /**
   * Get or create an EVM account by name.
   * If an account with the given name exists, it returns the existing account.
   * Otherwise, it creates a new account.
   */
  static async getOrCreateAccount(name: string): Promise<CdpAccount> {
    const result = await callCdpApi<{ account: CdpAccount }>('/accounts', 'POST', { name });

    if (!result.success || !result.data?.account) {
      throw new Error(result.error || 'Failed to get or create account');
    }

    return result.data.account;
  }

  /**
   * Get an account by name.
   */
  static async getAccount(name: string): Promise<CdpAccount> {
    const result = await callCdpApi<{ account: CdpAccount }>(`/accounts/${encodeURIComponent(name)}`, 'GET');

    if (!result.success || !result.data?.account) {
      throw new Error(result.error || 'Failed to get account');
    }

    return result.data.account;
  }

  /**
   * Create a Smart Account with the specified owner.
   * Smart Accounts support gasless transactions via paymaster.
   */
  static async createSmartAccount(ownerName: string): Promise<SmartAccount> {
    const result = await callCdpApi<{ smartAccount: SmartAccount }>('/accounts/smart', 'POST', { ownerName });

    if (!result.success || !result.data?.smartAccount) {
      throw new Error(result.error || 'Failed to create smart account');
    }

    return result.data.smartAccount;
  }

  /**
   * Transfer tokens using an EOA (Externally Owned Account).
   * The sender pays for gas fees.
   *
   * @deprecated DO NOT use for user payments. User funds are in CDP embedded wallets,
   * not in server-managed EOA accounts. Use OnchainKit Checkout or Spend Permissions instead.
   *
   * @param params - Transfer parameters
   * @param params.senderName - Name of the sender account
   * @param params.receiverAddress - Recipient wallet address
   * @param params.amount - Amount to transfer (as a string, e.g., "0.001")
   * @param params.token - Token to transfer (default: "eth")
   * @param params.network - Network to use (default: based on VITE_BASE_MAINNET env var)
   */
  static async transferFromEoa(params: EoaTransferParams): Promise<TransferResult> {
    const { senderName, receiverAddress, amount, token = 'eth', network } = params;
    const networkId = network || getDefaultNetwork();

    const result = await callCdpApi<{ transfer: TransferResult }>('/transfer/evm', 'POST', {
      senderName,
      receiverAddress,
      amount,
      token,
      network: networkId,
    });

    if (!result.success || !result.data?.transfer) {
      throw new Error(result.error || 'Transfer failed');
    }

    return result.data.transfer;
  }

  /**
   * Transfer tokens using a Smart Account.
   * Supports gasless transactions when a paymaster is configured.
   *
   * @deprecated DO NOT use for user payments. User funds are in CDP embedded wallets,
   * not in server-managed Smart Accounts. Use OnchainKit Checkout or Spend Permissions instead.
   *
   * @param params - Transfer parameters
   * @param params.ownerName - Name of the smart account owner
   * @param params.receiverAddress - Recipient wallet address
   * @param params.amount - Amount to transfer (as a string, e.g., "0.001")
   * @param params.token - Token to transfer (default: "eth")
   * @param params.network - Network to use (default: based on VITE_BASE_MAINNET env var)
   */
  static async transferFromSmartAccount(params: SmartAccountTransferParams): Promise<TransferResult> {
    const { ownerName, receiverAddress, amount, token = 'eth', network } = params;
    const networkId = network || getDefaultNetwork();

    const result = await callCdpApi<{ transfer: TransferResult }>('/transfer/smart-account', 'POST', {
      ownerName,
      receiverAddress,
      amount,
      token,
      network: networkId,
    });

    if (!result.success || !result.data?.transfer) {
      throw new Error(result.error || 'Transfer failed');
    }

    return result.data.transfer;
  }

  /**
   * Create a Solana account.
   * Optionally provide a name for easier retrieval later.
   */
  static async createSolanaAccount(name?: string): Promise<SolanaAccount> {
    const result = await callCdpApi<{ account: SolanaAccount }>('/accounts/solana', 'POST', { name });

    if (!result.success || !result.data?.account) {
      throw new Error(result.error || 'Failed to create Solana account');
    }

    return result.data.account;
  }

  /**
   * Request testnet ETH from the EVM faucet (Base Sepolia).
   * Note: Faucets have rate limits. See CDP documentation for details.
   *
   * @param address - The wallet address to fund
   * @param network - Network to use (default: "base-sepolia")
   * @param token - Token to request (default: "eth")
   */
  static async requestEvmFaucet(
    address: string,
    network: SupportedNetwork = 'base-sepolia',
    token: SupportedToken = 'eth'
  ): Promise<FaucetResult> {
    const result = await callCdpApi<{ faucet: FaucetResult }>('/faucet/evm', 'POST', {
      address,
      network,
      token,
    });

    if (!result.success || !result.data?.faucet) {
      throw new Error(result.error || 'Faucet request failed');
    }

    return result.data.faucet;
  }

  /**
   * Request devnet SOL from the Solana faucet.
   * Note: Faucets have rate limits. See CDP documentation for details.
   *
   * @param address - The Solana wallet address to fund
   * @param token - Token to request (default: "sol")
   */
  static async requestSolanaFaucet(
    address: string,
    token: SupportedToken = 'sol'
  ): Promise<FaucetResult> {
    const result = await callCdpApi<{ faucet: FaucetResult }>('/faucet/solana', 'POST', {
      address,
      token,
    });

    if (!result.success || !result.data?.faucet) {
      throw new Error(result.error || 'Faucet request failed');
    }

    return result.data.faucet;
  }

  /**
   * Send an EVM transaction using a Server Wallet.
   *
   * @deprecated DO NOT use for user payments. User funds are in CDP embedded wallets,
   * not in server-managed wallets. Use OnchainKit Checkout or Spend Permissions instead.
   *
   * @param params - Transaction parameters
   * @param params.address - The sender wallet address
   * @param params.transaction - Transaction details (to, value, data)
   * @param params.network - Network to use (default: based on VITE_BASE_MAINNET env var)
   */
  static async sendTransaction(params: SendTransactionParams): Promise<TransactionResult> {
    const { address, transaction, network } = params;
    const networkId = network || getDefaultNetwork();

    const result = await callCdpApi<{ transaction: TransactionResult }>('/send-transaction', 'POST', {
      address,
      transaction,
      network: networkId,
    });

    if (!result.success || !result.data?.transaction) {
      throw new Error(result.error || 'Transaction failed');
    }

    return result.data.transaction;
  }

  /**
   * Sign a Solana transaction.
   * Returns a base64-encoded signed transaction that can be submitted to the network.
   *
   * @param address - The Solana wallet address to sign with
   * @param transaction - Base64-encoded unsigned transaction
   */
  static async signSolanaTransaction(
    address: string,
    transaction: string
  ): Promise<SignedSolanaTransaction> {
    const result = await callCdpApi<{ signedTransaction: SignedSolanaTransaction }>(
      '/solana/sign-transaction',
      'POST',
      { address, transaction }
    );

    if (!result.success || !result.data?.signedTransaction) {
      throw new Error(result.error || 'Transaction signing failed');
    }

    return result.data.signedTransaction;
  }

  /**
   * Get available tokens for transfer
   */
  static getSupportedTokens(): SupportedToken[] {
    return ['eth', 'usdc', 'weth', 'sol'];
  }

  /**
   * Get available networks
   */
  static getSupportedNetworks(): SupportedNetwork[] {
    return ['base-sepolia', 'base', 'solana-devnet'];
  }

  /**
   * Format amount for display
   */
  static formatAmount(amount: string, token: SupportedToken): string {
    const num = parseFloat(amount);
    if (token.toLowerCase() === 'usdc') {
      return `$${num.toFixed(2)} USDC`;
    }
    return `${num} ${token.toUpperCase()}`;
  }

  /**
   * Get block explorer URL for a transaction
   */
  static getExplorerUrl(txHash: string, network?: SupportedNetwork): string {
    const networkId = network || getDefaultNetwork();
    const baseUrls: Record<string, string> = {
      'base-sepolia': 'https://sepolia.basescan.org',
      'base': 'https://basescan.org',
      'solana-devnet': 'https://explorer.solana.com',
    };

    const baseUrl = baseUrls[networkId] || baseUrls[getDefaultNetwork()];

    if (networkId === 'solana-devnet') {
      return `${baseUrl}/tx/${txHash}?cluster=devnet`;
    }

    return `${baseUrl}/tx/${txHash}`;
  }
}

// Export configuration - note DEFAULT_NETWORK is a getter to support dynamic environments
export const CDP_CONFIG = {
  SUPPORTED_TOKENS: ['eth', 'usdc', 'weth', 'sol'] as const,
  SUPPORTED_NETWORKS: ['base-sepolia', 'base', 'solana-devnet'] as const,
  get DEFAULT_NETWORK() { return getDefaultNetwork(); },
  DEFAULT_TOKEN: 'eth' as const,
  SOLANA_DEFAULT_TOKEN: 'sol' as const,
};

export default CdpSdkService;
