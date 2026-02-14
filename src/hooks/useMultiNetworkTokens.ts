import { useCallback, useEffect, useState } from 'react';
import { createPublicClient, http, formatUnits } from 'viem';
import { mainnet, base, baseSepolia, polygon, arbitrum, optimism } from 'viem/chains';

/**
 * Multi-Network Token Balance Hook
 * 
 * Fetches token balances across multiple EVM networks
 * Supports: Ethereum, Base, Polygon, Arbitrum, Optimism
 */

export interface NetworkTokenBalance {
  /** Token contract address */
  address: string;
  /** Token symbol */
  symbol: string;
  /** Token name */
  name: string;
  /** Token decimals */
  decimals: number;
  /** Raw balance in smallest unit */
  rawBalance: string;
  /** Formatted balance for display */
  formattedBalance: string;
  /** Network name */
  network: string;
  /** Chain ID */
  chainId: number;
  /** Logo URL */
  logoUrl: string | null;
  /** USD value if available */
  usdValue?: number;
}

interface UseMultiNetworkTokensResult {
  /** List of token balances across all networks */
  tokens: NetworkTokenBalance[];
  /** Whether token data is loading */
  isLoading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Refresh token balances */
  refresh: () => Promise<void>;
}

// Network configurations
const NETWORKS = {
  ethereum: {
    chain: mainnet,
    rpcUrl: 'https://eth.llamarpc.com',
    name: 'Ethereum',
    enabled: true,
  },
  base: {
    chain: base,
    rpcUrl: 'https://mainnet.base.org',
    name: 'Base',
    enabled: true,
  },
  baseSepolia: {
    chain: baseSepolia,
    rpcUrl: 'https://sepolia.base.org',
    name: 'Base Sepolia',
    enabled: false, // Only enable in testnet mode
  },
  polygon: {
    chain: polygon,
    rpcUrl: 'https://polygon-rpc.com',
    name: 'Polygon',
    enabled: true,
  },
  arbitrum: {
    chain: arbitrum,
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    name: 'Arbitrum',
    enabled: true,
  },
  optimism: {
    chain: optimism,
    rpcUrl: 'https://mainnet.optimism.io',
    name: 'Optimism',
    enabled: true,
  },
};

// Common token addresses across networks
const COMMON_TOKENS = {
  ethereum: [
    { address: 'native', symbol: 'ETH', name: 'Ethereum', decimals: 18, logoUrl: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC', name: 'USD Coin', decimals: 6, logoUrl: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png' },
    { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', symbol: 'USDT', name: 'Tether USD', decimals: 6, logoUrl: 'https://assets.coingecko.com/coins/images/325/small/Tether.png' },
    { address: '0x6b175474e89094c44da98b954eedeac495271d0f', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18, logoUrl: 'https://assets.coingecko.com/coins/images/9956/small/Badge_Dai.png' },
  ],
  base: [
    { address: 'native', symbol: 'ETH', name: 'Ethereum', decimals: 18, logoUrl: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', symbol: 'USDC', name: 'USD Coin', decimals: 6, logoUrl: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png' },
    { address: '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', symbol: 'USDbC', name: 'USD Base Coin', decimals: 6, logoUrl: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png' },
    { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18, logoUrl: 'https://assets.coingecko.com/coins/images/2518/small/weth.png' },
    { address: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18, logoUrl: 'https://assets.coingecko.com/coins/images/9956/small/Badge_Dai.png' },
  ],
  baseSepolia: [
    { address: 'native', symbol: 'ETH', name: 'Ethereum', decimals: 18, logoUrl: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    { address: '0x036cbd53842c5426634e7929541ec2318f3dcf7e', symbol: 'USDC', name: 'USD Coin', decimals: 6, logoUrl: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png' },
  ],
  polygon: [
    { address: 'native', symbol: 'MATIC', name: 'Polygon', decimals: 18, logoUrl: 'https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png' },
    { address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', symbol: 'USDC', name: 'USD Coin', decimals: 6, logoUrl: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png' },
    { address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', symbol: 'USDT', name: 'Tether USD', decimals: 6, logoUrl: 'https://assets.coingecko.com/coins/images/325/small/Tether.png' },
  ],
  arbitrum: [
    { address: 'native', symbol: 'ETH', name: 'Ethereum', decimals: 18, logoUrl: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    { address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', symbol: 'USDC', name: 'USD Coin', decimals: 6, logoUrl: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png' },
    { address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', symbol: 'USDT', name: 'Tether USD', decimals: 6, logoUrl: 'https://assets.coingecko.com/coins/images/325/small/Tether.png' },
  ],
  optimism: [
    { address: 'native', symbol: 'ETH', name: 'Ethereum', decimals: 18, logoUrl: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    { address: '0x0b2c639c533813f4aa9d7837caf62653d097ff85', symbol: 'USDC', name: 'USD Coin', decimals: 6, logoUrl: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png' },
    { address: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', symbol: 'USDT', name: 'Tether USD', decimals: 6, logoUrl: 'https://assets.coingecko.com/coins/images/325/small/Tether.png' },
  ],
};

// ERC20 balanceOf ABI
const ERC20_BALANCE_ABI = [
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    type: 'function',
  },
] as const;

export function useMultiNetworkTokens(walletAddress?: string): UseMultiNetworkTokensResult {
  const [tokens, setTokens] = useState<NetworkTokenBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTokens = useCallback(async () => {
    if (!walletAddress || !walletAddress.startsWith('0x') || walletAddress.length !== 42) {
      setTokens([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Determine which networks to query based on mainnet flag
      const isMainnet = import.meta.env.VITE_BASE_MAINNET === 'true';
      const networksToQuery = Object.entries(NETWORKS).filter(([key, config]) => {
        if (key === 'baseSepolia') return !isMainnet;
        return isMainnet ? config.enabled : key === 'baseSepolia';
      });

      const allTokens: NetworkTokenBalance[] = [];

      // Fetch tokens from each network in parallel
      await Promise.all(
        networksToQuery.map(async ([networkKey, networkConfig]) => {
          try {
            const client = createPublicClient({
              chain: networkConfig.chain,
              transport: http(networkConfig.rpcUrl),
            });

            const tokenList = COMMON_TOKENS[networkKey as keyof typeof COMMON_TOKENS] || [];

            // Fetch balances for all tokens on this network
            const balances = await Promise.allSettled(
              tokenList.map(async (token) => {
                try {
                  let balance: bigint;

                  if (token.address === 'native') {
                    // Fetch native token balance
                    balance = await client.getBalance({ address: walletAddress as `0x${string}` });
                  } else {
                    // Fetch ERC20 token balance
                    balance = await client.readContract({
                      address: token.address as `0x${string}`,
                      abi: ERC20_BALANCE_ABI,
                      functionName: 'balanceOf',
                      args: [walletAddress as `0x${string}`],
                    }) as bigint;
                  }

                  // Only include tokens with non-zero balance
                  if (balance > 0n) {
                    const formattedBalance = formatUnits(balance, token.decimals);
                    return {
                      address: token.address,
                      symbol: token.symbol,
                      name: token.name,
                      decimals: token.decimals,
                      rawBalance: balance.toString(),
                      formattedBalance,
                      network: networkConfig.name,
                      chainId: networkConfig.chain.id,
                      logoUrl: token.logoUrl,
                    };
                  }
                  return null;
                } catch (err) {
                  console.warn(`[useMultiNetworkTokens] Failed to fetch ${token.symbol} on ${networkConfig.name}:`, err);
                  return null;
                }
              })
            );

            // Add successful results to the list
            balances.forEach((result) => {
              if (result.status === 'fulfilled' && result.value) {
                allTokens.push(result.value);
              }
            });
          } catch (err) {
            console.error(`[useMultiNetworkTokens] Error fetching from ${networkConfig.name}:`, err);
          }
        })
      );

      // Sort tokens by network and symbol
      allTokens.sort((a, b) => {
        if (a.network === b.network) {
          return a.symbol.localeCompare(b.symbol);
        }
        return a.network.localeCompare(b.network);
      });

      setTokens(allTokens);
    } catch (err) {
      console.error('[useMultiNetworkTokens] Error fetching tokens:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch tokens');
    } finally {
      setIsLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  return {
    tokens,
    isLoading,
    error,
    refresh: fetchTokens,
  };
}
