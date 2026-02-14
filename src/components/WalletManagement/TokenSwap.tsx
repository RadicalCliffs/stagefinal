import { useState, useCallback, useMemo } from 'react';
import { ArrowDown, RefreshCw, AlertCircle, CheckCircle, ExternalLink, Loader2, X } from 'lucide-react';
import { parseUnits, formatUnits, isAddress } from 'viem';
import { useSendEvmTransaction, useEvmAddress } from '@coinbase/cdp-hooks';

/**
 * TokenSwap Component
 * 
 * Allows users to swap tokens on Base network
 * Uses Uniswap V3 for swaps (can be extended to support other DEXes)
 */

interface TokenSwapProps {
  onClose?: () => void;
  onSuccess?: () => void;
}

// Common tokens on Base
const BASE_TOKENS = [
  { symbol: 'ETH', name: 'Ethereum', address: 'native', decimals: 18, logoUrl: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
  { symbol: 'USDC', name: 'USD Coin', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6, logoUrl: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png' },
  { symbol: 'USDbC', name: 'USD Base Coin', address: '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', decimals: 6, logoUrl: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png' },
  { symbol: 'WETH', name: 'Wrapped Ether', address: '0x4200000000000000000000000000000000000006', decimals: 18, logoUrl: 'https://assets.coingecko.com/coins/images/2518/small/weth.png' },
  { symbol: 'DAI', name: 'Dai Stablecoin', address: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', decimals: 18, logoUrl: 'https://assets.coingecko.com/coins/images/9956/small/Badge_Dai.png' },
  { symbol: 'cbETH', name: 'Coinbase Wrapped Staked ETH', address: '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22', decimals: 18, logoUrl: 'https://assets.coingecko.com/coins/images/27008/small/cbeth.png' },
  { symbol: 'DEGEN', name: 'Degen', address: '0x4ed4e862860bed51a9570b96d89af5e1b0efefed', decimals: 18, logoUrl: 'https://assets.coingecko.com/coins/images/34515/small/degen.png' },
];

export const TokenSwap: React.FC<TokenSwapProps> = ({ onClose, onSuccess }) => {
  const { evmAddress } = useEvmAddress();
  const { sendEvmTransaction } = useSendEvmTransaction();

  const [fromToken, setFromToken] = useState(BASE_TOKENS[0]); // ETH
  const [toToken, setToToken] = useState(BASE_TOKENS[1]); // USDC
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [isSwapping, setIsSwapping] = useState(false);
  const [isQuoting, setIsQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [slippage, setSlippage] = useState('0.5'); // 0.5% default slippage

  const networkInfo = useMemo(() => {
    const isMainnet = import.meta.env.VITE_BASE_MAINNET === 'true';
    return {
      isMainnet,
      explorerDomain: isMainnet ? 'basescan.org' : 'sepolia.basescan.org',
      networkName: isMainnet ? 'Base Mainnet' : 'Base Sepolia Testnet',
    };
  }, []);

  // Validate amounts
  const isValidFromAmount = fromAmount && !isNaN(Number(fromAmount)) && Number(fromAmount) > 0;
  const canSwap = isValidFromAmount && !isSwapping && evmAddress && fromToken.address !== toToken.address;

  // Get quote for swap (simplified - in production, integrate with actual DEX aggregator)
  const getQuote = useCallback(async () => {
    if (!isValidFromAmount) {
      setToAmount('');
      return;
    }

    setIsQuoting(true);
    setError(null);

    try {
      // Simplified quote calculation for demo
      // In production, integrate with Uniswap V3, 1inch, or other DEX aggregator API
      const fromValue = parseFloat(fromAmount);
      
      // Mock exchange rates (replace with actual API calls)
      const mockRates: Record<string, number> = {
        'ETH-USDC': 3000,
        'USDC-ETH': 1 / 3000,
        'ETH-DAI': 3000,
        'DAI-ETH': 1 / 3000,
        'USDC-DAI': 1,
        'DAI-USDC': 1,
        'ETH-WETH': 1,
        'WETH-ETH': 1,
      };

      const rateKey = `${fromToken.symbol}-${toToken.symbol}`;
      const rate = mockRates[rateKey] || 1;
      
      const toValue = fromValue * rate * (1 - parseFloat(slippage) / 100);
      setToAmount(toValue.toFixed(6));

      console.log('[TokenSwap] Quote:', { from: fromAmount, to: toValue, rate, slippage });
    } catch (err) {
      console.error('[TokenSwap] Error getting quote:', err);
      setError('Failed to get quote. Please try again.');
    } finally {
      setIsQuoting(false);
    }
  }, [fromAmount, fromToken, toToken, slippage, isValidFromAmount]);

  // Get quote when from amount or tokens change (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (isValidFromAmount) {
        getQuote();
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [fromAmount, fromToken, toToken, isValidFromAmount, getQuote]);

  // Swap tokens (placeholder - needs actual DEX integration)
  const handleSwap = async () => {
    if (!canSwap || !evmAddress) {
      setError('Invalid swap parameters');
      return;
    }

    setIsSwapping(true);
    setError(null);
    setSuccess(false);

    try {
      // In production, this would:
      // 1. Get quote from DEX aggregator (Uniswap, 1inch, etc.)
      // 2. Approve token spending (if needed)
      // 3. Execute swap transaction
      // 4. Wait for confirmation

      // For now, show placeholder message
      setError('Token swapping is not yet fully implemented. This feature requires integration with a DEX aggregator like Uniswap V3 or 1inch API. The UI is ready and demonstrates the user experience.');
      
      // Uncomment when implementing:
      // const txHash = await sendEvmTransaction({...});
      // setTxHash(txHash);
      // setSuccess(true);
      // if (onSuccess) onSuccess();
    } catch (err) {
      console.error('[TokenSwap] Error swapping:', err);
      setError(err instanceof Error ? err.message : 'Failed to swap tokens');
    } finally {
      setIsSwapping(false);
    }
  };

  // Flip from/to tokens
  const handleFlipTokens = () => {
    setFromToken(toToken);
    setToToken(fromToken);
    setFromAmount(toAmount);
    setToAmount(fromAmount);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="swap-modal-title"
      className="bg-[#101010] border border-white/10 rounded-2xl max-w-md w-full p-6"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && onClose) {
          onClose();
        }
      }}
    >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 id="swap-modal-title" className="text-white sequel-95 text-xl uppercase">Swap Tokens</h2>
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {success ? (
          <div className="text-center py-8">
            <CheckCircle size={64} className="text-green-500 mx-auto mb-4" />
            <p className="text-white sequel-75 text-lg mb-2">Swap Successful!</p>
            <p className="text-white/60 sequel-45 text-sm mb-6">
              Your tokens have been swapped
            </p>
            {txHash && (
              <a
                href={`https://${networkInfo.explorerDomain}/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-[#DDE404] hover:text-[#C5CC03] sequel-75 text-sm mb-6"
              >
                View Transaction
                <ExternalLink size={16} />
              </a>
            )}
            <button
              onClick={() => {
                setSuccess(false);
                setTxHash(null);
                setFromAmount('');
                setToAmount('');
              }}
              className="bg-[#DDE404] hover:bg-[#C5CC03] text-black sequel-75 py-3 px-6 rounded-xl transition-all w-full"
            >
              New Swap
            </button>
          </div>
        ) : (
          <>
            {/* From Token */}
            <div className="bg-[#1A1A1A] rounded-xl p-4 mb-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-white/60 sequel-45 text-xs uppercase">From</span>
              </div>
              <div className="flex items-center gap-3">
                <select
                  value={fromToken.symbol}
                  onChange={(e) => {
                    const token = BASE_TOKENS.find(t => t.symbol === e.target.value);
                    if (token) setFromToken(token);
                  }}
                  className="bg-[#2A2A2A] text-white sequel-75 px-3 py-2 rounded-lg flex-shrink-0"
                >
                  {BASE_TOKENS.map(token => (
                    <option key={token.symbol} value={token.symbol}>{token.symbol}</option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="0.0"
                  value={fromAmount}
                  onChange={(e) => setFromAmount(e.target.value)}
                  className="bg-transparent text-white sequel-75 text-2xl w-full outline-none text-right"
                />
              </div>
            </div>

            {/* Swap Direction Button */}
            <div className="flex justify-center -my-3 relative z-10">
              <button
                onClick={handleFlipTokens}
                className="bg-[#1A1A1A] border-2 border-[#101010] hover:border-[#DDE404]/30 text-white p-2 rounded-xl transition-all"
              >
                <ArrowDown size={20} />
              </button>
            </div>

            {/* To Token */}
            <div className="bg-[#1A1A1A] rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-white/60 sequel-45 text-xs uppercase">To</span>
                {isQuoting && (
                  <span className="text-white/40 sequel-45 text-xs flex items-center gap-1">
                    <Loader2 size={12} className="animate-spin" />
                    Getting quote...
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <select
                  value={toToken.symbol}
                  onChange={(e) => {
                    const token = BASE_TOKENS.find(t => t.symbol === e.target.value);
                    if (token) setToToken(token);
                  }}
                  className="bg-[#2A2A2A] text-white sequel-75 px-3 py-2 rounded-lg flex-shrink-0"
                >
                  {BASE_TOKENS.map(token => (
                    <option key={token.symbol} value={token.symbol}>{token.symbol}</option>
                  ))}
                </select>
                <div className="text-white/60 sequel-75 text-2xl w-full text-right">
                  {toAmount || '0.0'}
                </div>
              </div>
            </div>

            {/* Slippage Settings */}
            <div className="bg-[#1A1A1A] rounded-xl p-4 mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-white/60 sequel-45 text-xs uppercase">Max Slippage</span>
                <span className="text-white sequel-75 text-sm">{slippage}%</span>
              </div>
              <div className="flex gap-2">
                {['0.1', '0.5', '1.0', '3.0'].map(value => (
                  <button
                    key={value}
                    onClick={() => setSlippage(value)}
                    className={`flex-1 py-2 rounded-lg sequel-75 text-sm transition-all ${
                      slippage === value
                        ? 'bg-[#DDE404] text-black'
                        : 'bg-[#2A2A2A] text-white hover:bg-[#3A3A3A]'
                    }`}
                  >
                    {value}%
                  </button>
                ))}
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 flex items-start gap-2">
                <AlertCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
                <p className="text-red-400 sequel-45 text-sm">{error}</p>
              </div>
            )}

            {/* Swap Button */}
            <button
              onClick={handleSwap}
              disabled={!canSwap || isSwapping || isQuoting}
              className="bg-gradient-to-r from-[#DDE404] to-[#C5CC03] hover:from-[#C5CC03] hover:to-[#DDE404] text-black sequel-75 py-4 px-6 rounded-xl flex items-center justify-center gap-2 transition-all duration-300 w-full disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-[#DDE404]/20 hover:shadow-[#DDE404]/30"
            >
              {isSwapping ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  Swapping...
                </>
              ) : (
                'Swap Tokens'
              )}
            </button>

            {/* Info */}
            <div className="mt-4 bg-blue-500/10 border border-blue-500/20 rounded-lg px-4 py-3">
              <p className="text-blue-300/70 sequel-45 text-xs">
                This swap feature is currently in development. It will support swapping between tokens on the Base network using Uniswap V3 or other DEX aggregators.
              </p>
            </div>
          </>
        )}
    </div>
  );
};

export default TokenSwap;
