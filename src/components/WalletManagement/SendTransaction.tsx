import { useState, useMemo, useCallback, useEffect } from 'react';
import { Send, AlertCircle, CheckCircle, ExternalLink, Loader2, History, Clock, ChevronRight } from 'lucide-react';
import { useSendEvmTransaction, useEvmAddress } from '@coinbase/cdp-hooks';
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, isAddress, createPublicClient, http } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { supabase } from '../../lib/supabase';
import { useAuthUser } from '../../contexts/AuthContext';
import { database } from '../../lib/database';

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

interface RecentTransaction {
  to: string;
  amount: string;
  timestamp: string;
  hash: string;
}

/**
 * SendTransaction Component
 * 
 * Allows users to send ETH from their wallet (embedded or external) to other addresses.
 * - Uses CDP's useSendEvmTransaction hook for embedded wallets (Base Account)
 * - Uses Wagmi's useSendTransaction hook for external wallets (MetaMask, Coinbase Wallet, etc.)
 */
export const SendTransaction: React.FC<SendTransactionProps> = ({ onClose, onSuccess }) => {
  const { canonicalUserId } = useAuthUser();
  
  // CDP hooks (for embedded wallets)
  const { evmAddress } = useEvmAddress();
  const { sendEvmTransaction } = useSendEvmTransaction();
  
  // Wagmi hooks (for external wallets)
  const { address: wagmiAddress } = useAccount();
  const { sendTransaction: wagmiSendTransaction, data: wagmiTxHash, isPending: wagmiIsPending } = useSendTransaction();
  const { isLoading: wagmiIsConfirming, isSuccess: wagmiIsSuccess } = useWaitForTransactionReceipt({
    hash: wagmiTxHash,
  });

  // Determine wallet type and address
  const hasEmbeddedWallet = !!evmAddress;
  const walletAddress = evmAddress || wagmiAddress;

  const [recipientAddress, setRecipientAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [estimatedGas, setEstimatedGas] = useState<{
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    estimatedCost: string;
  } | null>(null);
  const [isEstimatingGas, setIsEstimatingGas] = useState(false);
  const [recentTransactions, setRecentTransactions] = useState<RecentTransaction[]>([]);
  const [showRecentTx, setShowRecentTx] = useState(false);

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

  const canSend = isValidAddress && isValidAmount && !isSending && walletAddress;

  // Estimate gas fees when amount and recipient are valid
  const estimateGas = useCallback(async () => {
    if (!isValidAddress || !isValidAmount) {
      setEstimatedGas(null);
      return;
    }

    setIsEstimatingGas(true);
    try {
      const feeData = await publicClient.estimateFeesPerGas();
      
      if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        // Estimate gas limit for a simple ETH transfer (21,000 gas units)
        const gasLimit = BigInt(21000);
        const totalGasCost = feeData.maxFeePerGas * gasLimit;
        const totalGasInEth = Number(totalGasCost) / 1e18;
        
        setEstimatedGas({
          maxFeePerGas: feeData.maxFeePerGas,
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
          estimatedCost: totalGasInEth.toFixed(6)
        });
      } else {
        // Use fallback values
        const gasLimit = BigInt(21000);
        const totalGasCost = FALLBACK_MAX_FEE_PER_GAS * gasLimit;
        const totalGasInEth = Number(totalGasCost) / 1e18;
        
        setEstimatedGas({
          maxFeePerGas: FALLBACK_MAX_FEE_PER_GAS,
          maxPriorityFeePerGas: FALLBACK_MAX_PRIORITY_FEE_PER_GAS,
          estimatedCost: totalGasInEth.toFixed(6)
        });
      }
    } catch (error) {
      console.error('Failed to estimate gas:', error);
      // Use fallback values on error
      const gasLimit = BigInt(21000);
      const totalGasCost = FALLBACK_MAX_FEE_PER_GAS * gasLimit;
      const totalGasInEth = Number(totalGasCost) / 1e18;
      
      setEstimatedGas({
        maxFeePerGas: FALLBACK_MAX_FEE_PER_GAS,
        maxPriorityFeePerGas: FALLBACK_MAX_PRIORITY_FEE_PER_GAS,
        estimatedCost: totalGasInEth.toFixed(6)
      });
    } finally {
      setIsEstimatingGas(false);
    }
  }, [isValidAddress, isValidAmount, publicClient]);

  // Trigger gas estimation when inputs change
  useEffect(() => {
    estimateGas();
  }, [estimateGas]);

  // Load recent outgoing transactions on mount
  useEffect(() => {
    const loadRecentTransactions = async () => {
      if (!walletAddress) return;
      
      try {
        // Query blockchain send transactions from the wallet
        // This could be expanded to query actual on-chain data via a block explorer API
        // For now, we'll use local storage to track recent sends
        const stored = localStorage.getItem(`recent-sends-${walletAddress}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          setRecentTransactions(parsed.slice(0, 5)); // Show last 5
        }
      } catch (err) {
        console.error('Failed to load recent transactions:', err);
      }
    };

    loadRecentTransactions();
  }, [walletAddress]);

  // Memoize explorer URL generator
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

      if (hasEmbeddedWallet) {
        // CDP embedded wallet flow
        // Use estimated gas fees if available, otherwise estimate on-the-fly
        let maxFeePerGas: bigint;
        let maxPriorityFeePerGas: bigint;
        
        if (estimatedGas) {
          // Use pre-estimated gas values
          maxFeePerGas = estimatedGas.maxFeePerGas;
          maxPriorityFeePerGas = estimatedGas.maxPriorityFeePerGas;
        } else {
          // Estimate gas fees for EIP-1559 transaction with error handling
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
        }

        // Send transaction with EIP-1559 parameters via CDP
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
        
        // Save to recent transactions
        saveRecentTransaction(recipientAddress, amount, result.transactionHash || '');
        
        // Call success callback after a delay to show success message
        setTimeout(() => {
          if (onSuccess) onSuccess();
        }, SUCCESS_DISPLAY_DURATION);
      } else {
        // External wallet (Wagmi) flow
        // Send transaction via Wagmi
        wagmiSendTransaction({
          to: recipientAddress as `0x${string}`,
          value: valueInWei,
          chainId: networkInfo.chain.id,
        });
        
        // Success will be handled by the wagmiIsSuccess effect
      }
    } catch (err) {
      console.error('Transaction failed:', err);
      const errorMessage = err instanceof Error ? err.message : 'Transaction failed';
      setError(errorMessage);
      setIsSending(false);
    }
  };

  // Handle Wagmi transaction success
  useEffect(() => {
    if (wagmiIsSuccess && wagmiTxHash && !hasEmbeddedWallet) {
      setTxHash(wagmiTxHash);
      setSave to recent transactions
      saveRecentTransaction(recipientAddress, amount, wagmiTxHash);
      
      // Call success callback after a delay to show success message
      setTimeout(() => {
        if (onSuccess) onSuccess();
      }, SUCCESS_DISPLAY_DURATION);
    }
  }, [wagmiIsSuccess, wagmiTxHash, hasEmbeddedWallet, onSuccess, recipientAddress, amount
      }, SUCCESS_DISPLAY_DURATION);
    }
  }, [wagmiIsSuccess, wagmiTxHash, hasEmbeddedWallet, onSuccess]);

  // Handle Wagmi transaction pending state
  useEffect(() => {
    if (wagmiIsPending || wagmiIsConfirmin

  // Save transaction to recent list
  const saveRecentTransaction = (to: string, amt: string, hash: string) => {
    if (!walletAddress) return;
    
    try {
      const stored = localStorage.getItem(`recent-sends-${walletAddress}`);
      const existing: RecentTransaction[] = stored ? JSON.parse(stored) : [];
      
      const newTx: RecentTransaction = {
        to,
        amount: amt,
        timestamp: new Date().toISOString(),
        hash
      };
      
      // Add to beginning, keep last 10
      const updated = [newTx, ...existing].slice(0, 10);
      localStorage.setItem(`recent-sends-${walletAddress}`, JSON.stringify(updated));
      setRecentTransactions(updated.slice(0, 5));
    } catch (err) {
      console.error('Failed to save recent transaction:', err);
    }
  };

  // Fill form with recent transaction
  const useRecentTransaction = (tx: RecentTransaction) => {
    setRecipientAddress(tx.to);
    setAmount(tx.amount);
    setShowRecentTx(false);
  };g) {
      setIsSending(true);
    }
  }, [wagmiIsPending, wagmiIsConfirming]);

  if (!walletAddress) {
    return (
      <div className="bg-[#1E1E1E] rounded-xl p-6 border border-red-500/30">
        <div className="flex items-start gap-3">
          <AlertCircle size={24} className="text-red-400 shrink-0 mt-1" />
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
    const truncateAddress = (addr: string) => 
      `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
    
    return (
      <div className="bg-[#1E1E1E] rounded-xl p-6 border border-white/10">
        <div className="flex items-start gap-3 mb-6">
          <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center shrink-0 animate-pulse">
            <CheckCircle size={24} className="text-green-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-white sequel-75 text-lg mb-2">Transaction Sent!</h3>
            <p className="text-white/60 sequel-45 text-sm">
              Your transaction has been broadcast to the {networkInfo.networkName} network.
            </p>
          </div>
        </div>

        {/* Transaction Details Card */}
        <div className="bg-[#2A2A2A] rounded-lg p-4 mb-4 space-y-3">
          <div>
            <p className="text-white/40 sequel-45 text-xs mb-1.5">From</p>
            <p className="text-white sequel-45 text-sm font-mono">{truncateAddress(walletAddress || '')}</p>
          </div>
          
          <div>
            <p className="text-white/40 sequel-45 text-xs mb-1.5">To</p>
            <p className="text-white sequel-45 text-sm font-mono">{truncateAddress(recipientAddress)}</p>
          </div>
          
          <div>
            <p className="text-white/40 sequel-45 text-xs mb-1.5">Amount</p>
            <p className="text-[#DDE404] sequel-75 text-xl">{amount} ETH</p>
          </div>

          <div>
            <p className="text-white/40 sequel-45 text-xs mb-1.5">Transaction Hash</p>
            <p className="text-white sequel-45 text-xs font-mono break-all">{txHash}</p>
          </div>
          
          <div>
            <p className="text-white/40 sequel-45 text-xs mb-1.5">Status</p>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <span className="text-green-400 sequel-75 text-sm">Pending Confirmation</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3">
          <a
            href={getExplorerUrl() || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 bg-[#DDE404] hover:bg-[#DDE404]/90 text-black sequel-75 py-3 rounded-lg transition-all hover:scale-105"
          >
            <ExternalLink size={18} />
            View on {networkInfo.isMainnet ? 'BaseScan' : 'BaseScan Testnet'}
          </a>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => {
                setSuccess(false);
                setTxHash(null);
                setRecipientAddress('');
                setAmount('');
              }}
              className="bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 sequel-75 py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Send size={16} />
              Send Another
            </button>
            <button
              onClick={() => {
                if (onClose) onClose();
              }}
              className="bg-[#404040] hover:bg-[#505050] text-white sequel-75 py-3 rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>

        {/* Info Note */}
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 mt-4">
          <div className="flex items-start gap-2">
            <Clock size={14} className="text-blue-400 shrink-0 mt-0.5" />
            <p className="text-blue-300/70 sequel-45 text-xs">
              Your transaction is being processed. It usually takes a few seconds to confirm on Base network.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#1E1E1E] rounded-xl p-6 border border-white/10">
      <div className="flex items-start gap-3 mb-6">
        <div className="w-12 h-12 bg-[#DDE404]/20 rounded-full flex items-center justify-center shrink-0">
          <Send size={24} className="text-[#DDE404]" />
        </div>
        <div>
          <h3 className="text-white sequel-75 text-lg mb-2">Send Crypto</h3>
          <p className="text-white/60 sequel-45 text-sm">
            Transfer crypto from your {hasEmbeddedWallet ? 'embedded' : 'external'} wallet to another address.
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-4 flex items-start gap-2">
          <AlertCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 sequel-75 text-sm mb-1">Transaction Failed</p>
            <p className="text-red-300/70 sequel-45 text-xs">{error}</p>
          </div>
        </div>
      )}

      <div className="bg-[#2A2A2A] rounded-lg p-4 mb-4">
        <p className="text-white/40 sequel-45 text-xs mb-2">Your Wallet Address:</p>
        <p className="text-white sequel-45 text-sm font-mono break-all">{walletAddress}</p>
      </div>

      <div className="space-y-4 mb-6">
        <div>
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="recipient" className="block text-white sequel-75 text-sm">
              Recipient Address
            </label>
            {recentTransactions.length > 0 && (
              <button
                onClick={() => setShowRecentTx(!showRecentTx)}
                className="text-[#DDE404] hover:text-[#DDE404]/80 sequel-75 text-xs flex items-center gap-1 transition-colors"
                type="button"
              >
                <History size={14} />
                Recent
              </button>
            )}
          </div>
          
          {/* Recent Transactions Dropdown */}
          {showRecentTx && recentTransactions.length > 0 && (
            <div className="bg-[#252525] border border-white/10 rounded-lg p-2 mb-2 max-h-48 overflow-y-auto">
              {recentTransactions.map((tx, idx) => (
                <button
                  key={idx}
                  onClick={() => useRecentTransaction(tx)}
                  className="w-full text-left px-3 py-2 rounded hover:bg-white/10 transition-colors flex items-center justify-between"
                  type="button"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-white sequel-45 text-xs font-mono truncate">{tx.to}</p>
                    <p className="text-white/40 sequel-45 text-[10px] mt-0.5">{tx.amount} ETH • {new Date(tx.timestamp).toLocaleDateString()}</p>
                  </div>
                  <ChevronRight size={14} className="text-white/40 shrink-0 ml-2" />
                </button>
              ))}
            </div>
          )}
          
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

      {/* Gas Fee Estimate Display with Total Cost */}
      {estimatedGas && isValidAmount && (
        <div className="bg-[#2A2A2A] rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-white/60 sequel-75 text-sm">Transaction Summary</p>
            {isEstimatingGas && <Loader2 size={14} className="text-white/40 animate-spin" />}
          </div>
          
          <div className="space-y-2 mb-3">
            <div className="flex items-center justify-between">
              <span className="text-white/60 sequel-45 text-sm">Send Amount</span>
              <span className="text-white sequel-75 text-sm">{amount} ETH</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/60 sequel-45 text-sm">Network Fee</span>
              <span className="text-white sequel-75 text-sm">{estimatedGas.estimatedCost} ETH</span>
            </div>
            <div className="h-px bg-white/10 my-2"></div>
            <div className="flex items-center justify-between">
              <span className="text-white sequel-75 text-sm">Total Cost</span>
              <span className="text-[#DDE404] sequel-75 text-lg">
                {(parseFloat(amount) + parseFloat(estimatedGas.estimatedCost)).toFixed(6)} ETH
              </span>
            </div>
          </div>
          
          <p className="text-white/40 sequel-45 text-xs">
            Gas fees are paid to network validators. Base has some of the lowest fees of any network.
          </p>
        </div>
      )}

      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-6">
        <div className="flex items-start gap-2">
          <AlertCircle size={16} className="text-blue-400 shrink-0 mt-0.5" />
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
