import { useState, useMemo, useCallback } from 'react';
import { Send, AlertCircle, CheckCircle, ExternalLink, Loader2 } from 'lucide-react';
import { useSendEvmTransaction, useEvmAddress } from '@coinbase/cdp-hooks';
import { parseEther, isAddress, createPublicClient, http } from 'viem';
import { base, baseSepolia } from 'viem/chains';

// Success message display duration in milliseconds
const SUCCESS_DISPLAY_DURATION = 3000;

// Fallback gas values for EIP-1559 transactions (in wei)
// Used when gas estimation fails. Base network has low fees, so 1 gwei is safe.
const FALLBACK_MAX_FEE_PER_GAS = BigInt(1000000000); // 1 gwei
const FALLBACK_MAX_PRIORITY_FEE_PER_GAS = BigInt(1000000000); // 1 gwei

// Base network RPC URLs
// Using public endpoints - can be overridden via environment variables if needed
const BASE_MAINNET_RPC = import.meta.env.VITE_BASE_MAINNET_RPC || 'https://mainnet.base.org';
const BASE_SEPOLIA_RPC = import.meta.env.VITE_BASE_SEPOLIA_RPC || 'https://sepolia.base.org';

// Helper to get network info
const getNetworkInfo = () => {
  const isMainnet = import.meta.env.VITE_BASE_MAINNET === 'true';
  return {
    isMainnet,
    explorerDomain: isMainnet ? 'basescan.org' : 'sepolia.basescan.org',
    networkName: isMainnet ? 'Base Mainnet' : 'Base Sepolia Testnet',
    // CDP network identifier for sendEvmTransaction
    cdpNetwork: isMainnet ? 'base' : 'base-sepolia',
    // Viem chain for gas estimation
    chain: isMainnet ? base : baseSepolia,
    // RPC URL for public client
    rpcUrl: isMainnet ? BASE_MAINNET_RPC : BASE_SEPOLIA_RPC,
  };
};

interface SendTransactionProps {
  onClose?: () => void;
  onSuccess?: () => void;
}

/**
 * SendTransaction Component
 * 
 * Allows users to send ETH or tokens from their embedded wallet to other addresses.
 * Uses CDP's useSendEvmTransaction hook for secure transaction signing.
 */
export const SendTransaction: React.FC<SendTransactionProps> = ({ onClose, onSuccess }) => {
  const { evmAddress } = useEvmAddress();
  const { sendEvmTransaction } = useSendEvmTransaction();

  const [recipientAddress, setRecipientAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  // Memoize network info to avoid recreating object on every render
  const networkInfo = useMemo(() => getNetworkInfo(), []);

  // Memoize public client for gas estimation to avoid recreation on every transaction
  const publicClient = useMemo(() => {
    return createPublicClient({
      chain: networkInfo.chain,
      transport: http(networkInfo.rpcUrl),
    });
  }, [networkInfo.chain, networkInfo.rpcUrl]);

  // Validate recipient address
  const isValidAddress = recipientAddress && isAddress(recipientAddress);
  const addressError = recipientAddress && !isValidAddress ? 'Invalid Ethereum address' : null;

  // Validate amount - use strict validation with Number() and isNaN check (memoized)
  const { isValidAmount, amountError } = useMemo(() => {
    const numericValue = Number(amount);
    const isValidAmount = amount && !isNaN(numericValue) && numericValue > 0;
    const amountError = amount && !isValidAmount ? 'Amount must be a valid number greater than 0' : null;
    return { isValidAmount, amountError };
  }, [amount]);

  const canSend = isValidAddress && isValidAmount && !isSending && evmAddress;

  // Memoized explorer URL generator
  const getExplorerUrl = useCallback(() => {
    if (!txHash) return null;
    return `https://${networkInfo.explorerDomain}/tx/${txHash}`;
  }, [txHash, networkInfo.explorerDomain]);

  const handleSend = async () => {
    if (!canSend) return;

    setIsSending(true);
    setError(null);
    setSuccess(false);
    setTxHash(null);

    try {
      // Convert amount to wei (ETH has 18 decimals)
      const valueInWei = parseEther(amount);

      // Estimate gas fees for EIP-1559 transaction with error handling
      let maxFeePerGas: bigint;
      let maxPriorityFeePerGas: bigint;
      
      try {
        const feeData = await publicClient.estimateFeesPerGas();
        
        // Validate that gas values are present and use fallback if not
        if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
          maxFeePerGas = feeData.maxFeePerGas;
          maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
        } else {
          console.warn('Gas estimation returned null/undefined values, using fallback');
          maxFeePerGas = FALLBACK_MAX_FEE_PER_GAS;
          maxPriorityFeePerGas = FALLBACK_MAX_PRIORITY_FEE_PER_GAS;
        }
      } catch (gasEstimateError) {
        console.error('Gas estimation failed, using fallback values:', gasEstimateError);
        // Fallback to reasonable gas values if estimation fails
        maxFeePerGas = FALLBACK_MAX_FEE_PER_GAS;
        maxPriorityFeePerGas = FALLBACK_MAX_PRIORITY_FEE_PER_GAS;
      }

      // Send transaction with EIP-1559 parameters
      // recipientAddress is already validated by isAddress()
      const result = await sendEvmTransaction({
        evmAccount: evmAddress!,
        network: networkInfo.cdpNetwork as any,
        transaction: {
          to: recipientAddress as `0x${string}`,
          value: valueInWei,
          maxFeePerGas,
          maxPriorityFeePerGas,
          chainId: networkInfo.chain.id,
        } as any,
      });

      setTxHash(result.transactionHash || null);
      setSuccess(true);
      
      // Call success callback after a delay to show success message
      setTimeout(() => {
        if (onSuccess) onSuccess();
      }, SUCCESS_DISPLAY_DURATION);
    } catch (err) {
      console.error('Transaction failed:', err);
      const errorMessage = err instanceof Error ? err.message : 'Transaction failed';
      setError(errorMessage);
    } finally {
      setIsSending(false);
    }
  };

  if (!evmAddress) {
    return (
      <div className="bg-[#1E1E1E] rounded-xl p-6 border border-red-500/30">
        <div className="flex items-start gap-3">
          <AlertCircle size={24} className="text-red-400 flex-shrink-0 mt-1" />
          <div>
            <h3 className="text-white sequel-75 text-lg mb-2">Wallet Not Found</h3>
            <p className="text-white/60 sequel-45 text-sm">
              No embedded wallet address found. Please ensure you're signed in with a Base account.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (success && txHash) {
    return (
      <div className="bg-[#1E1E1E] rounded-xl p-6 border border-white/10">
        <div className="flex items-start gap-3 mb-6">
          <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center flex-shrink-0">
            <CheckCircle size={24} className="text-green-400" />
          </div>
          <div>
            <h3 className="text-white sequel-75 text-lg mb-2">Transaction Sent!</h3>
            <p className="text-white/60 sequel-45 text-sm">
              Your transaction has been broadcast to the network.
            </p>
          </div>
        </div>

        <div className="bg-[#2A2A2A] rounded-lg p-4 mb-4">
          <p className="text-white/40 sequel-45 text-xs mb-2">Recipient:</p>
          <p className="text-white sequel-45 text-sm font-mono break-all mb-4">{recipientAddress}</p>
          
          <p className="text-white/40 sequel-45 text-xs mb-2">Amount:</p>
          <p className="text-white sequel-75 text-lg mb-4">{amount} ETH</p>

          <p className="text-white/40 sequel-45 text-xs mb-2">Transaction Hash:</p>
          <p className="text-white sequel-45 text-xs font-mono break-all">{txHash}</p>
        </div>

        <a
          href={getExplorerUrl() || '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 bg-[#DDE404] hover:bg-[#DDE404]/90 text-black sequel-75 py-3 rounded-lg transition-colors mb-3"
        >
          <ExternalLink size={18} />
          View on BaseScan
        </a>

        <button
          onClick={() => {
            setSuccess(false);
            setTxHash(null);
            setRecipientAddress('');
            setAmount('');
            if (onClose) onClose();
          }}
          className="w-full bg-[#404040] hover:bg-[#505050] text-white sequel-75 py-3 rounded-lg transition-colors"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="bg-[#1E1E1E] rounded-xl p-6 border border-white/10">
      <div className="flex items-start gap-3 mb-6">
        <div className="w-12 h-12 bg-[#DDE404]/20 rounded-full flex items-center justify-center flex-shrink-0">
          <Send size={24} className="text-[#DDE404]" />
        </div>
        <div>
          <h3 className="text-white sequel-75 text-lg mb-2">Send ETH</h3>
          <p className="text-white/60 sequel-45 text-sm">
            Transfer ETH from your embedded wallet to another address.
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-4 flex items-start gap-2">
          <AlertCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 sequel-75 text-sm mb-1">Transaction Failed</p>
            <p className="text-red-300/70 sequel-45 text-xs">{error}</p>
          </div>
        </div>
      )}

      <div className="bg-[#2A2A2A] rounded-lg p-4 mb-4">
        <p className="text-white/40 sequel-45 text-xs mb-2">Your Wallet Address:</p>
        <p className="text-white sequel-45 text-sm font-mono break-all">{evmAddress}</p>
      </div>

      <div className="space-y-4 mb-6">
        <div>
          <label htmlFor="recipient" className="block text-white sequel-75 text-sm mb-2">
            Recipient Address
          </label>
          <input
            id="recipient"
            type="text"
            value={recipientAddress}
            onChange={(e) => setRecipientAddress(e.target.value)}
            placeholder="0x..."
            disabled={isSending}
            className={`w-full bg-[#1A1A1A] border ${
              addressError ? 'border-red-500/50' : 'border-white/20'
            } rounded-lg px-4 py-3 text-white sequel-45 text-sm placeholder:text-white/30 focus:border-[#DDE404] focus:outline-none disabled:opacity-50`}
          />
          {addressError && (
            <p className="text-red-400 sequel-45 text-xs mt-1">{addressError}</p>
          )}
        </div>

        <div>
          <label htmlFor="amount" className="block text-white sequel-75 text-sm mb-2">
            Amount (ETH)
          </label>
          <input
            id="amount"
            type="number"
            step="any"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.001"
            disabled={isSending}
            className={`w-full bg-[#1A1A1A] border ${
              amountError ? 'border-red-500/50' : 'border-white/20'
            } rounded-lg px-4 py-3 text-white sequel-45 text-sm placeholder:text-white/30 focus:border-[#DDE404] focus:outline-none disabled:opacity-50`}
          />
          {amountError && (
            <p className="text-red-400 sequel-45 text-xs mt-1">{amountError}</p>
          )}
          <p className="text-white/40 sequel-45 text-xs mt-1">
            Network: {networkInfo.networkName}
          </p>
        </div>
      </div>

      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-6">
        <div className="flex items-start gap-2">
          <AlertCircle size={16} className="text-blue-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-blue-400 sequel-75 text-xs mb-1">Important</p>
            <ul className="text-blue-300/70 sequel-45 text-xs space-y-1">
              <li>• Double-check the recipient address before sending</li>
              <li>• Transactions on the blockchain cannot be reversed</li>
              <li>• Make sure you have enough ETH to cover network fees</li>
              <li>• Sending to the wrong address may result in permanent loss</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={handleSend}
          disabled={!canSend}
          className="flex-1 bg-[#DDE404] hover:bg-[#DDE404]/90 disabled:bg-[#DDE404]/50 disabled:cursor-not-allowed text-black sequel-75 py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
        >
          {isSending ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Sending...
            </>
          ) : (
            <>
              <Send size={18} />
              Send Transaction
            </>
          )}
        </button>
        <button
          onClick={onClose}
          disabled={isSending}
          className="flex-1 bg-[#404040] hover:bg-[#505050] disabled:opacity-50 text-white sequel-75 py-3 rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default SendTransaction;
