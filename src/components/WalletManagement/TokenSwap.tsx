import { X } from 'lucide-react';
import { Swap, SwapAmountInput, SwapToggleButton, SwapButton, SwapMessage, SwapToast } from '@coinbase/onchainkit/swap';
import type { Token } from '@coinbase/onchainkit/token';

/**
 * TokenSwap Component
 * 
 * Allows users to swap tokens on Base network using Coinbase's native swap functionality
 * Uses OnchainKit Swap components with built-in liquidity, gas estimation, and slippage protection
 */

interface TokenSwapProps {
  onClose?: () => void;
  onSuccess?: () => void;
}

// Define tokens using OnchainKit Token type
// All tokens on Base network (chainId: 8453)
const ETH_TOKEN: Token = {
  name: 'ETH',
  address: '',
  symbol: 'ETH',
  decimals: 18,
  image: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  chainId: 8453,
};

const USDC_TOKEN: Token = {
  name: 'USD Coin',
  address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  symbol: 'USDC',
  decimals: 6,
  image: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
  chainId: 8453,
};

const USDBC_TOKEN: Token = {
  name: 'USD Base Coin',
  address: '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca',
  symbol: 'USDbC',
  decimals: 6,
  image: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
  chainId: 8453,
};

const WETH_TOKEN: Token = {
  name: 'Wrapped Ether',
  address: '0x4200000000000000000000000000000000000006',
  symbol: 'WETH',
  decimals: 18,
  image: 'https://assets.coingecko.com/coins/images/2518/small/weth.png',
  chainId: 8453,
};

const DAI_TOKEN: Token = {
  name: 'Dai Stablecoin',
  address: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb',
  symbol: 'DAI',
  decimals: 18,
  image: 'https://assets.coingecko.com/coins/images/9956/small/Badge_Dai.png',
  chainId: 8453,
};

const CBETH_TOKEN: Token = {
  name: 'Coinbase Wrapped Staked ETH',
  address: '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22',
  symbol: 'cbETH',
  decimals: 18,
  image: 'https://assets.coingecko.com/coins/images/27008/small/cbeth.png',
  chainId: 8453,
};

const DEGEN_TOKEN: Token = {
  name: 'Degen',
  address: '0x4ed4e862860bed51a9570b96d89af5e1b0efefed',
  symbol: 'DEGEN',
  decimals: 18,
  image: 'https://assets.coingecko.com/coins/images/34515/small/degen.png',
  chainId: 8453,
};

// All swappable tokens
const SWAPPABLE_TOKENS: Token[] = [
  ETH_TOKEN,
  USDC_TOKEN,
  USDBC_TOKEN,
  WETH_TOKEN,
  DAI_TOKEN,
  CBETH_TOKEN,
  DEGEN_TOKEN,
];


export const TokenSwap: React.FC<TokenSwapProps> = ({ onClose, onSuccess }) => {
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
          aria-label="Close swap modal"
        >
          <X size={24} />
        </button>
      </div>

      {/* OnchainKit Swap Component */}
      <div className="onchainkit-swap-container">
        <Swap>
          <SwapAmountInput
            label="Sell"
            swappableTokens={SWAPPABLE_TOKENS}
            token={ETH_TOKEN}
            type="from"
          />
          <SwapToggleButton />
          <SwapAmountInput
            label="Buy"
            swappableTokens={SWAPPABLE_TOKENS}
            token={USDC_TOKEN}
            type="to"
          />
          <SwapButton />
          <SwapMessage />
          <SwapToast />
        </Swap>
      </div>

      {/* Info Banner */}
      <div className="mt-4 bg-blue-500/10 border border-blue-500/20 rounded-lg px-4 py-3">
        <p className="text-blue-300/70 sequel-45 text-xs">
          Powered by Coinbase's native swap infrastructure. Automatic token approvals, gas optimization, and slippage protection included.
        </p>
      </div>
    </div>
  );
};

export default TokenSwap;
