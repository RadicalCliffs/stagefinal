import { useCallback, useEffect, useState, useRef } from 'react';
import { useAuthUser } from '../contexts/AuthContext';
import { walletTokensLogger, requestTracker, showDebugHintOnError } from '../lib/debug-console';

/**
 * Wallet Token Balance Hook
 *
 * Fetches token balances for a connected wallet address on Base network.
 * Displays the top tokens by value that the user holds.
 *
 * Rate Limit Protection:
 * - In-memory cache with 30-second TTL prevents redundant fetches
 * - Request deduplication prevents concurrent fetches for same address
 * - Backoff after rate limit errors (60 seconds)
 */

// Global cache for token balances to prevent redundant fetches across hook instances
interface CachedTokenData {
  tokens: TokenBalance[];
  timestamp: number;
}
const tokenCache = new Map<string, CachedTokenData>();
const CACHE_TTL_MS = 30000; // 30 seconds cache TTL

// Track in-flight requests to prevent duplicate concurrent fetches
const inFlightRequests = new Map<string, Promise<TokenBalance[]>>();

// Track rate limit backoff per address
const rateLimitBackoff = new Map<string, number>();
const RATE_LIMIT_BACKOFF_MS = 60000; // 60 seconds backoff after rate limit

export interface TokenBalance {
  /** Token contract address */
  address: string;
  /** Token symbol (e.g., ETH, USDC) */
  symbol: string;
  /** Token name */
  name: string;
  /** Token decimals */
  decimals: number;
  /** Raw balance in smallest unit */
  rawBalance: string;
  /** Formatted balance for display */
  formattedBalance: string;
  /** Logo URL for the token */
  logoUrl: string | null;
  /** USD value if available */
  usdValue?: number;
}

interface UseWalletTokensResult {
  /** List of token balances */
  tokens: TokenBalance[];
  /** Whether token data is loading */
  isLoading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Refresh token balances */
  refresh: () => Promise<void>;
}

// Known token metadata for Base network
const KNOWN_TOKENS: Record<string, { symbol: string; name: string; decimals: number; logoUrl: string }> = {
  // Native ETH
  'native': {
    symbol: 'ETH',
    name: 'Ethereum',
    decimals: 18,
    logoUrl: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  },
  // USDC on Base
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    logoUrl: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
  },
  // USDC on Base Sepolia (testnet)
  '0x036cbd53842c5426634e7929541ec2318f3dcf7e': {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    logoUrl: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
  },
  // WETH on Base
  '0x4200000000000000000000000000000000000006': {
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
    logoUrl: 'https://assets.coingecko.com/coins/images/2518/small/weth.png',
  },
  // DAI on Base
  '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': {
    symbol: 'DAI',
    name: 'Dai Stablecoin',
    decimals: 18,
    logoUrl: 'https://assets.coingecko.com/coins/images/9956/small/Badge_Dai.png',
  },
  // cbETH on Base
  '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22': {
    symbol: 'cbETH',
    name: 'Coinbase Wrapped Staked ETH',
    decimals: 18,
    logoUrl: 'https://assets.coingecko.com/coins/images/27008/small/cbeth.png',
  },
  // USDbC on Base (Bridged USDC)
  '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': {
    symbol: 'USDbC',
    name: 'USD Base Coin',
    decimals: 6,
    logoUrl: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
  },
  // DEGEN on Base
  '0x4ed4e862860bed51a9570b96d89af5e1b0efefed': {
    symbol: 'DEGEN',
    name: 'Degen',
    decimals: 18,
    logoUrl: 'https://assets.coingecko.com/coins/images/34515/small/degen.png',
  },
  // AERO on Base
  '0x940181a94a35a4569e4529a3cdfb74e38fd98631': {
    symbol: 'AERO',
    name: 'Aerodrome Finance',
    decimals: 18,
    logoUrl: 'https://assets.coingecko.com/coins/images/31745/small/token.png',
  },
  // BRETT on Base
  '0x532f27101965dd16442e59d40670faf5ebb142e4': {
    symbol: 'BRETT',
    name: 'Brett',
    decimals: 18,
    logoUrl: 'https://assets.coingecko.com/coins/images/35529/small/brett.jpg',
  },
  // TOSHI on Base
  '0xac1bd2486aaf3b5c0fc3fd868558b082a531b2b4': {
    symbol: 'TOSHI',
    name: 'Toshi',
    decimals: 18,
    logoUrl: 'https://assets.coingecko.com/coins/images/31126/small/toshi.jpg',
  },
  // VIRTUAL on Base
  '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b': {
    symbol: 'VIRTUAL',
    name: 'Virtual Protocol',
    decimals: 18,
    logoUrl: 'https://assets.coingecko.com/coins/images/43957/small/virtual.png',
  },
};

// Format balance for display
function formatBalance(rawBalance: string, decimals: number): string {
  if (!rawBalance || rawBalance === '0') return '0';

  const balanceBigInt = BigInt(rawBalance);
  const divisor = BigInt(10 ** decimals);
  const wholePart = balanceBigInt / divisor;
  const fractionalPart = balanceBigInt % divisor;

  // Format fractional part with proper padding
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0');

  // Show up to 4 decimal places for display
  const displayDecimals = Math.min(4, decimals);
  const truncatedFractional = fractionalStr.slice(0, displayDecimals);

  // Remove trailing zeros
  const cleanFractional = truncatedFractional.replace(/0+$/, '');

  if (cleanFractional) {
    return `${wholePart.toLocaleString()}.${cleanFractional}`;
  }
  return wholePart.toLocaleString();
}

export function useWalletTokens(walletAddress?: string): UseWalletTokensResult {
  const { linkedWallets } = useAuthUser();
  const [tokens, setTokens] = useState<TokenBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastFetchRef = useRef<number>(0);

  // Get the first connected wallet if no address provided
  // Prefer the passed walletAddress, then fall back to linkedWallets from AuthContext
  const address = walletAddress || linkedWallets?.[0]?.address;

  const fetchTokens = useCallback(async (forceRefresh = false) => {
    if (!address) {
      walletTokensLogger.debug('No wallet address available, clearing tokens');
      setTokens([]);
      return;
    }

    // Validate address format
    if (!address.startsWith('0x') || address.length !== 42) {
      walletTokensLogger.error('Invalid wallet address format', { address });
      setError('Invalid wallet address format');
      setTokens([]);
      return;
    }

    const cacheKey = address.toLowerCase();
    const now = Date.now();

    // Check rate limit backoff
    const backoffUntil = rateLimitBackoff.get(cacheKey);
    if (backoffUntil && now < backoffUntil && !forceRefresh) {
      const remainingMs = backoffUntil - now;
      walletTokensLogger.debug('Skipping fetch due to rate limit backoff', {
        address: address.slice(0, 10),
        remainingSeconds: Math.ceil(remainingMs / 1000)
      });
      // Return cached data if available
      const cached = tokenCache.get(cacheKey);
      if (cached) {
        setTokens(cached.tokens);
      }
      return;
    }

    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = tokenCache.get(cacheKey);
      if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
        walletTokensLogger.debug('Using cached token data', {
          address: address.slice(0, 10),
          cacheAge: Math.round((now - cached.timestamp) / 1000) + 's'
        });
        setTokens(cached.tokens);
        return;
      }
    }

    // Check for in-flight request (request deduplication)
    const existingRequest = inFlightRequests.get(cacheKey);
    if (existingRequest) {
      walletTokensLogger.debug('Waiting for existing request', { address: address.slice(0, 10) });
      try {
        const result = await existingRequest;
        setTokens(result);
        return;
      } catch {
        // If the existing request failed, we'll continue and try again
      }
    }

    // Prevent rapid successive fetches (minimum 5 seconds between fetches)
    if (now - lastFetchRef.current < 5000 && !forceRefresh) {
      walletTokensLogger.debug('Throttling fetch - too soon since last fetch', {
        address: address.slice(0, 10),
        timeSinceLastMs: now - lastFetchRef.current
      });
      return;
    }
    lastFetchRef.current = now;

    const startTime = Date.now();
    walletTokensLogger.group(`Fetching tokens for ${address.slice(0, 10)}...`);
    walletTokensLogger.info('Starting token fetch', { address });
    setIsLoading(true);
    setError(null);

    // Create promise for request deduplication
    const fetchPromise = (async (): Promise<TokenBalance[]> => {
      const tokenBalances: TokenBalance[] = [];

      // Determine if we're on mainnet or testnet
      const isMainnet = import.meta.env.VITE_BASE_MAINNET === 'true';
      const rpcUrl = isMainnet
        ? 'https://mainnet.base.org'
        : 'https://sepolia.base.org';

      walletTokensLogger.debug('Network config', { isMainnet, rpcUrl });

      // Fetch native ETH balance
      try {
        const ethStartTime = Date.now();
        walletTokensLogger.request('eth_getBalance', { address });

        const ethBalanceResponse = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_getBalance',
            params: [address, 'latest'],
            id: 1,
          }),
        });

        if (!ethBalanceResponse.ok) {
          walletTokensLogger.warn('ETH balance RPC request failed', { status: ethBalanceResponse.status });
          requestTracker.addRequest({
            timestamp: Date.now(),
            endpoint: 'eth_getBalance',
            method: 'RPC',
            success: false,
            errorCode: ethBalanceResponse.status,
            duration: Date.now() - ethStartTime
          });
        } else {
          const ethBalanceData = await ethBalanceResponse.json();

          if (ethBalanceData.result) {
            const rawBalance = BigInt(ethBalanceData.result).toString();
            walletTokensLogger.success('ETH balance fetched', { rawBalance, formatted: formatBalance(rawBalance, 18) });
            requestTracker.addRequest({
              timestamp: Date.now(),
              endpoint: 'eth_getBalance',
              method: 'RPC',
              success: true,
              duration: Date.now() - ethStartTime
            });

            if (rawBalance !== '0') {
              tokenBalances.push({
                address: 'native',
                symbol: 'ETH',
                name: 'Ethereum',
                decimals: 18,
                rawBalance,
                formattedBalance: formatBalance(rawBalance, 18),
                logoUrl: KNOWN_TOKENS['native'].logoUrl,
              });
            }
          } else if (ethBalanceData.error) {
            walletTokensLogger.warn('ETH balance RPC error', ethBalanceData.error);
            if (ethBalanceData.error.code === -32016) {
              walletTokensLogger.rateLimitError('eth_getBalance', ethBalanceData.error);
              showDebugHintOnError();
            }
          }
        }
      } catch (e) {
        walletTokensLogger.error('Failed to fetch ETH balance', e);
      }

      // Increased to 10 tokens to show more of user's portfolio while managing rate limits
      const tokensToCheck = isMainnet
        ? [
            '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC (primary payment token)
            '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', // USDbC (bridged USDC)
            '0x4200000000000000000000000000000000000006', // WETH
            '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', // DAI
            '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22', // cbETH
            '0x4ed4e862860bed51a9570b96d89af5e1b0efefed', // DEGEN
            '0x940181a94a35a4569e4529a3cdfb74e38fd98631', // AERO
            '0x532f27101965dd16442e59d40670faf5ebb142e4', // BRETT
            '0xac1bd2486aaf3b5c0fc3fd868558b082a531b2b4', // TOSHI
            '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b', // Virtual Protocol
          ]
        : [
            '0x036cbd53842c5426634e7929541ec2318f3dcf7e', // USDC on Base Sepolia
            '0x4200000000000000000000000000000000000006', // WETH
          ];

      // ERC20 balanceOf function signature
      const balanceOfSelector = '0x70a08231';

      // Fetch ERC20 token balances sequentially with delays to avoid rate limiting
      // Using sequential requests instead of batch to prevent RPC rate limit issues
      // The 300ms delay adds ~1.2s total overhead for 5 tokens, but this is acceptable because:
      // - Cache (30s TTL) means this only runs once every 30 seconds at most
      // - This prevents hitting rate limits which causes ALL tokens to fail
      // - Avoiding rate limits prevents the 60-second backoff penalty
      const REQUEST_DELAY_MS = 300; // 300ms delay between requests to stay under rate limits

      try {
        const batchStartTime = Date.now();
        walletTokensLogger.info('Fetching ERC20 token balances sequentially', { tokenCount: tokensToCheck.length });

        let successCount = 0;
        let rateLimitCount = 0;
        let errorCount = 0;

        // Fetch each token balance sequentially with delays
        for (let i = 0; i < tokensToCheck.length; i++) {
          const tokenAddress = tokensToCheck[i].toLowerCase();
          const tokenMeta = KNOWN_TOKENS[tokenAddress];

          // Add delay between requests (skip delay for first request)
          if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
          }

          // Declare timing variable outside try block to avoid reference errors
          const requestStartTime = Date.now();

          try {
            const tokenBalanceResponse = await fetch(rpcUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'eth_call',
                params: [
                  {
                    to: tokenAddress,
                    data: `${balanceOfSelector}000000000000000000000000${address.slice(2).toLowerCase()}`,
                  },
                  'latest',
                ],
                id: i + 2,
              }),
            });

            if (!tokenBalanceResponse.ok) {
              errorCount++;
              walletTokensLogger.warn(`Token ${tokenMeta?.symbol || tokenAddress} RPC request failed`, { 
                status: tokenBalanceResponse.status 
              });
              requestTracker.addRequest({
                timestamp: Date.now(),
                endpoint: tokenAddress,
                method: 'RPC',
                success: false,
                errorCode: tokenBalanceResponse.status,
                duration: Date.now() - requestStartTime
              });
              continue;
            }

            const result = await tokenBalanceResponse.json();

            if (result.result && result.result !== '0x' && result.result !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
              if (tokenMeta) {
                const rawBalance = BigInt(result.result).toString();
                walletTokensLogger.debug(`${tokenMeta.symbol} balance`, { 
                  rawBalance, 
                  formatted: formatBalance(rawBalance, tokenMeta.decimals) 
                });
                successCount++;

                if (rawBalance !== '0') {
                  tokenBalances.push({
                    address: tokenAddress,
                    symbol: tokenMeta.symbol,
                    name: tokenMeta.name,
                    decimals: tokenMeta.decimals,
                    rawBalance,
                    formattedBalance: formatBalance(rawBalance, tokenMeta.decimals),
                    logoUrl: tokenMeta.logoUrl,
                  });
                }

                requestTracker.addRequest({
                  timestamp: Date.now(),
                  endpoint: tokenAddress,
                  method: 'RPC',
                  success: true,
                  duration: Date.now() - requestStartTime
                });
              }
            } else if (result.error) {
              errorCount++;
              if (result.error.code === -32016) {
                rateLimitCount++;
                walletTokensLogger.rateLimitError(tokenAddress, result.error);
                showDebugHintOnError();
                // Stop fetching more tokens after hitting rate limit
                const skippedCount = tokensToCheck.length - i - 1;
                if (skippedCount > 0) {
                  walletTokensLogger.warn('Rate limit hit, skipping remaining tokens', {
                    skipped: skippedCount,
                    fetched: i + 1,
                    total: tokensToCheck.length
                  });
                }
                break;
              } else {
                walletTokensLogger.warn(`Token ${tokenMeta?.symbol || tokenAddress} fetch error`, result.error);
              }

              requestTracker.addRequest({
                timestamp: Date.now(),
                endpoint: tokenAddress,
                method: 'RPC',
                success: false,
                errorCode: result.error.code,
                duration: Date.now() - requestStartTime
              });
            }
          } catch (e) {
            errorCount++;
            walletTokensLogger.error(`Failed to fetch balance for ${tokenMeta?.symbol || tokenAddress}`, e);
            requestTracker.addRequest({
              timestamp: Date.now(),
              endpoint: tokenAddress,
              method: 'RPC',
              success: false,
              error: e instanceof Error ? e.message : String(e),
              duration: Date.now() - requestStartTime
            });
          }
        }

        // If we hit rate limits, set backoff for this address
        if (rateLimitCount > 0) {
          rateLimitBackoff.set(cacheKey, Date.now() + RATE_LIMIT_BACKOFF_MS);
          walletTokensLogger.warn('Rate limit detected, setting backoff', {
            address: address.slice(0, 10),
            backoffSeconds: RATE_LIMIT_BACKOFF_MS / 1000
          });
        }

        walletTokensLogger.info('Sequential fetch summary', {
          total: tokensToCheck.length,
          success: successCount,
          rateLimited: rateLimitCount,
          errors: errorCount,
          duration: Date.now() - batchStartTime
        });
      } catch (e) {
        walletTokensLogger.error('Failed to fetch token balances', e);
      }

      // Sort by raw balance (descending) - tokens with higher quantities first
      tokenBalances.sort((a, b) => {
        // Normalize balances to comparable units (multiply by 10^(18-decimals))
        const aNormalized = BigInt(a.rawBalance) * BigInt(10 ** (18 - a.decimals));
        const bNormalized = BigInt(b.rawBalance) * BigInt(10 ** (18 - b.decimals));
        if (bNormalized > aNormalized) return 1;
        if (bNormalized < aNormalized) return -1;
        return 0;
      });

      // Only keep top 10 tokens (increased from 5 to show more of user's portfolio)
      return tokenBalances.slice(0, 10);
    })();

    // Register in-flight request for deduplication
    inFlightRequests.set(cacheKey, fetchPromise);

    try {
      const finalTokens = await fetchPromise;

      // Update cache
      tokenCache.set(cacheKey, {
        tokens: finalTokens,
        timestamp: Date.now()
      });

      walletTokensLogger.successWithTiming('Token fetch complete', startTime, {
        tokenCount: finalTokens.length,
        tokens: finalTokens.map(t => t.symbol)
      });
      setTokens(finalTokens);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch token balances';
      setError(errorMessage);
      walletTokensLogger.error('Token balance fetch error', err);
      showDebugHintOnError();
    } finally {
      // Clean up in-flight request
      inFlightRequests.delete(cacheKey);
      setIsLoading(false);
      walletTokensLogger.groupEnd();
    }
  }, [address]);

  // Fetch tokens on mount and when address changes
  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  // Refresh periodically (every 60 seconds to reduce rate limit issues)
  useEffect(() => {
    if (!address) return;

    const interval = setInterval(() => fetchTokens(), 60000);
    return () => clearInterval(interval);
  }, [address, fetchTokens]);

  return {
    tokens,
    isLoading,
    error,
    refresh: () => fetchTokens(true), // Force refresh bypasses cache
  };
}
