import { useState, useEffect, useCallback } from 'react';
import { X, Check, AlertCircle, Wallet, ExternalLink, CreditCard, ArrowDownToLine, ArrowUpFromLine, Gift, Zap, Smartphone, Coins, Sparkles, Shield, ChevronRight } from 'lucide-react';
import { useAuthUser } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { toCanonicalUserId } from '../lib/canonicalUserId';
import { TOP_UP_CHECKOUT_URLS } from '../lib/coinbase-commerce';
import { CoinbaseOnrampService } from '../lib/coinbase-onramp';
import { isSuccessStatus, isFailureStatus } from '../lib/payment-status';
import { notificationService } from '../lib/notification-service';
import { Checkout, CheckoutButton, CheckoutStatus } from '@coinbase/onchainkit/checkout';
import type { LifecycleStatus } from '@coinbase/onchainkit/checkout';
import { FundButton, getOnrampBuyUrl } from '@coinbase/onchainkit/fund';
import { useRealTimeBalance } from '../hooks/useRealTimeBalance';
import { useWalletTokens } from '../hooks/useWalletTokens';
import { useWalletClient } from 'wagmi';

// Text overrides for visual editor live preview
export interface TopUpWalletModalTextOverrides {
  modalTitle?: string;
  modalSubtitle?: string;
  methodSelectionTitle?: string;
  instantTopUpLabel?: string;
  instantTopUpDesc?: string;
  cryptoTopUpLabel?: string;
  cryptoTopUpDesc?: string;
  successMessage?: string;
}

interface TopUpWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  // Optional text overrides for visual editor live preview
  textOverrides?: TopUpWalletModalTextOverrides;
}

type PaymentStep = 'method' | 'amount' | 'loading' | 'checkout' | 'crypto-checkout' | 'commerce-checkout' | 'instant-processing' | 'onramp-processing' | 'fund-button' | 'success' | 'error';
type PaymentMethod = 'crypto' | 'commerce' | 'offramp' | 'instant' | 'onramp' | 'fund';

// Get preset amounts from Coinbase checkout URLs
const PRESET_AMOUNTS = Object.keys(TOP_UP_CHECKOUT_URLS).map(Number).filter(a => a >= 3).sort((a, b) => a - b);

// Coinbase Commerce preset amounts (same as crypto since they use the same checkout URLs)
const COMMERCE_PRESET_AMOUNTS = PRESET_AMOUNTS;

/**
 * Get CDP project ID with fallback chain (cached at module level)
 * 
 * Precedence order:
 * 1. VITE_ONCHAINKIT_PROJECT_ID (OnchainKit-specific configuration)
 * 2. VITE_CDP_PROJECT_ID (General CDP configuration, used by CDP React Provider)
 * 
 * Both variables should have the same value from CDP Portal.
 * The fallback ensures consistency if only one is set.
 * 
 * Cached at module initialization to avoid repeated environment variable access
 * and to log warnings/errors only once.
 */
const getCDPProjectId = (() => {
  // Read and cache environment variables at module initialization
  const onchainKitId = import.meta.env.VITE_ONCHAINKIT_PROJECT_ID;
  const cdpId = import.meta.env.VITE_CDP_PROJECT_ID;
  const projectId = onchainKitId || cdpId || '';
  
  // Log warning if using fallback (only once at initialization)
  if (!onchainKitId && cdpId) {
    console.warn('[TopUpWalletModal] Using VITE_CDP_PROJECT_ID as fallback for VITE_ONCHAINKIT_PROJECT_ID');
  }
  
  // Log error if no project ID is configured (only once at initialization)
  if (!projectId) {
    console.error('[TopUpWalletModal] No CDP project ID configured. OnchainKit onramp will not work.');
  }
  
  // Return a function that returns the cached project ID
  return () => projectId;
})();

const TopUpWalletModal: React.FC<TopUpWalletModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  textOverrides,
}) => {
  const { baseUser, linkedWallets, refreshUserData } = useAuthUser();
  const { hasUsedBonus } = useRealTimeBalance();
  const { data: walletClient } = useWalletClient();
  const [step, setStep] = useState<PaymentStep>('method');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('commerce');
  const [amount, setAmount] = useState<number>(50);
  const [error, setError] = useState<string>('');
  const [checkoutUrl, setCheckoutUrl] = useState<string>('');
  const [transactionId, setTransactionId] = useState<string>('');
  const [cryptoChargeId, setCryptoChargeId] = useState<string>('');
  const [instantProcessing, setInstantProcessing] = useState<boolean>(false);
  const [onrampUrl, setOnrampUrl] = useState<string>('');

  // Get user's primary wallet address for token balance check
  const primaryWallet = linkedWallets.find(w => w.isEmbeddedWallet === true) ||
    linkedWallets.find(w => w.isBaseAccount === true) ||
    linkedWallets.find(w => w.chainType === 'ethereum') ||
    linkedWallets[0];

  const walletAddress = primaryWallet?.address;

  // Fetch wallet token balances
  const { tokens, isLoading: tokensLoading } = useWalletTokens(walletAddress);

  // Get USDC balance from wallet
  const usdcToken = tokens.find(t => t.symbol === 'USDC');
  const walletUsdcBalance = usdcToken ? parseFloat(usdcToken.formattedBalance.replace(/,/g, '')) : 0;
  const hasWalletBalance = walletUsdcBalance >= 10;

  useEffect(() => {
    if (!isOpen) {
      setStep('method');
      setPaymentMethod('commerce');
      setAmount(50);
      setError('');
      setCheckoutUrl('');
      setTransactionId('');
      setCryptoChargeId('');
      setInstantProcessing(false);
      setOnrampUrl('');
    }
  }, [isOpen]);

  // Poll for payment status when in checkout step
  useEffect(() => {
    if ((step === 'checkout' || step === 'commerce-checkout') && transactionId) {
      const pollInterval = setInterval(async () => {
        try {
          const { data } = await supabase
            .from('user_transactions')
            .select('status')
            .eq('id', transactionId)
            .single();

          if (data?.status && isSuccessStatus(data.status)) {
            clearInterval(pollInterval);
            setStep('success');

            // Send in-app notification for the successful top-up
            if (baseUser?.id) {
              notificationService.notifyTopUp(baseUser.id, amount).catch(err => {
                console.warn('[TopUpWalletModal] Failed to send commerce top-up notification:', err);
              });
            }

            onSuccess?.();
          } else if (data?.status && isFailureStatus(data.status)) {
            clearInterval(pollInterval);
            setStep('error');
            setError('Payment failed or expired');
          }
        } catch (err) {
          // Continue polling
        }
      }, 5000);

      return () => clearInterval(pollInterval);
    }
  }, [step, transactionId, onSuccess, baseUser?.id, amount]);

  // Handle Coinbase Commerce iframe messages for success detection
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin.includes('commerce.coinbase.com')) {
        if (event.data?.event === 'charge:success' || event.data?.type === 'checkout:completed') {
          onSuccess?.();
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onSuccess]);

  const initiatePayment = async () => {
    if (!baseUser?.id) {
      setError('Please log in to continue');
      setStep('error');
      return;
    }

    setStep('loading');
    setError('');

    try {
      if (paymentMethod === 'instant') {
        // Instant wallet payment - direct USDC transfer from wallet
        if (!walletAddress) {
          setError('No wallet connected. Please connect a wallet first.');
          setStep('error');
          return;
        }

        if (walletUsdcBalance < amount) {
          setError(`Insufficient wallet USDC balance. You have $${walletUsdcBalance.toFixed(2)} but need $${amount}.`);
          setStep('error');
          return;
        }

        if (!walletClient) {
          setError('Wallet not connected. Please reconnect your wallet.');
          setStep('error');
          return;
        }

        setStep('instant-processing');
        setInstantProcessing(true);

        // Process instant wallet top-up
        await handleInstantTopUp();
      } else if (paymentMethod === 'crypto') {
        // Crypto payment now uses OnchainKit in-modal checkout
        if (!TOP_UP_CHECKOUT_URLS[amount]) {
          setError(`Amount $${amount} is not available. Please select from: $${PRESET_AMOUNTS.join(', $')}`);
          setStep('error');
          return;
        }
        // Go directly to the OnchainKit checkout step
        setStep('crypto-checkout');
      } else if (paymentMethod === 'commerce') {
        // Create dynamic charge with proper redirect URLs configured in backend
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData.session?.access_token) {
          headers['Authorization'] = `Bearer ${sessionData.session.access_token}`;
        }
        
        const response = await fetch('/api/create-charge', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            userId: toCanonicalUserId(baseUser.id),
            totalAmount: amount,
            type: 'topup',
          }),
        });
        
        const result = await response.json();
        if (!response.ok || !result.success) {
          console.error('Failed to create charge:', result);
          setError(result.error?.message || result.error || 'Failed to create checkout');
          setStep('error');
          return;
        }
        
        setTransactionId(result.data.transactionId);
        setCheckoutUrl(result.data.checkoutUrl);
        setStep('commerce-checkout');
      } else if (paymentMethod === 'offramp') {
        // Coinbase Offramp (cash out) payment flow
        if (!walletAddress) {
          setError('No wallet connected. Please connect a wallet first.');
          setStep('error');
          return;
        }

        const result = await CoinbaseOnrampService.generateOfframpUrl({
          sourceAddress: walletAddress,
          sourceAsset: 'USDC',
          sourceNetwork: 'base',
          fiatCurrency: 'USD',
          partnerUserId: baseUser?.id || '',
          redirectUrl: window.location.origin,
        });

        setCheckoutUrl(result.url);
        setStep('checkout');
      } else if (paymentMethod === 'fund') {
        // FundButton flow - uses OnchainKit's built-in fund button
        // This shows the Coinbase Onramp widget in a popup
        if (!walletAddress) {
          setError('No wallet connected. Please connect a wallet first.');
          setStep('error');
          return;
        }
        setStep('fund-button');
      }
    } catch (err) {
      console.error('Payment initiation error:', err);
      setError(err instanceof Error ? err.message : 'Failed to initiate payment');
      setStep('error');
      setInstantProcessing(false);
    }
  };

  // Handle instant wallet top-up - direct USDC transfer from wallet to treasury
  const handleInstantTopUp = async () => {
    if (!walletClient || !walletAddress || !baseUser?.id) {
      setError('Wallet not connected');
      setStep('error');
      setInstantProcessing(false);
      return;
    }

    try {
      const treasuryAddress = import.meta.env.VITE_TREASURY_ADDRESS;
      if (!treasuryAddress) {
        throw new Error('Treasury address not configured');
      }

      // USDC contract addresses
      const isMainnet = import.meta.env.VITE_BASE_MAINNET === 'true';
      const USDC_MAINNET = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
      const USDC_TESTNET = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
      const USDC_ADDRESS = import.meta.env.VITE_USDC_CONTRACT_ADDRESS || (isMainnet ? USDC_MAINNET : USDC_TESTNET);

      // Convert amount to USDC units (6 decimals)
      const amountInUnits = BigInt(Math.floor(amount * 1_000_000));

      // ERC20 transfer function signature: transfer(address,uint256)
      const transferFunctionSelector = '0xa9059cbb';
      const paddedAddress = treasuryAddress.slice(2).padStart(64, '0');
      const paddedAmount = amountInUnits.toString(16).padStart(64, '0');
      const data = `${transferFunctionSelector}${paddedAddress}${paddedAmount}`;

      console.log('[TopUpWalletModal] Initiating instant top-up:', {
        amount,
        from: walletAddress,
        to: treasuryAddress,
      });

      // Send the USDC transfer transaction
      const txHash = await walletClient.request({
        method: 'eth_sendTransaction',
        params: [{
          from: walletAddress,
          to: USDC_ADDRESS,
          data: data,
        }],
      });

      console.log('[TopUpWalletModal] Transaction submitted:', txHash);

      // Get auth token for the API call
      const authToken = localStorage.getItem('cdp:wallet_address') ||
                       localStorage.getItem('base:wallet_address');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (authToken) {
        headers['Authorization'] = `Bearer wallet:${authToken}`;
      } else {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData.session?.access_token) {
          headers['Authorization'] = `Bearer ${sessionData.session.access_token}`;
        }
      }

      // Call the instant-topup API to verify and credit balance
      const response = await fetch('/api/instant-topup', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          transactionHash: txHash,
          amount,
          walletAddress,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to process top-up');
      }

      console.log('[TopUpWalletModal] Instant top-up successful:', result);

      // Success!
      setStep('success');
      await refreshUserData();
      // Dispatch event to update balance display
      // Only dispatch if we have valid balance data
      if (result.newBalance !== undefined && result.newBalance !== null) {
        window.dispatchEvent(new CustomEvent('balance-updated', {
          detail: { newBalance: result.newBalance }
        }));
      }

      // Send in-app notification for the successful top-up
      if (baseUser?.id) {
        notificationService.notifyTopUp(baseUser.id, amount, result.newBalance).catch(err => {
          console.warn('[TopUpWalletModal] Failed to send top-up notification:', err);
        });
      }

      onSuccess?.();
    } catch (err) {
      console.error('[TopUpWalletModal] Instant top-up error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Payment failed';

      // Provide user-friendly error messages
      if (errorMessage.includes('rejected') || errorMessage.includes('denied')) {
        setError('Transaction was rejected by wallet');
      } else if (errorMessage.includes('insufficient')) {
        setError('Insufficient USDC balance in your wallet');
      } else {
        setError(errorMessage);
      }
      setStep('error');
    } finally {
      setInstantProcessing(false);
    }
  };

  // OnchainKit charge handler for crypto top-up
  const handleCryptoChargeCreate = useCallback(async (): Promise<string> => {
    if (!baseUser?.id) {
      throw new Error('Please login first');
    }

    if (!amount || !Number.isFinite(amount) || amount <= 0) {
      throw new Error(`Invalid amount: ${amount}`);
    }

    try {
      // Build headers with optional Authorization from Supabase session
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      // Create charge via the same endpoint used for entries, but for topup
      const response = await fetch('/api/create-charge', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          userId: toCanonicalUserId(baseUser.id),
          totalAmount: amount,
          type: 'topup',
          paymentMethod: 'onchainkit',
        }),
      });

      const result = await response.json();

      if (!response.ok || result.success === false) {
        throw new Error(result.error?.message || result.error || 'Failed to create charge');
      }

      setTransactionId(result.data?.transactionId || '');
      setCryptoChargeId(result.data?.chargeId || '');

      return result.data?.chargeId || '';
    } catch (error) {
      console.error('Crypto charge creation error:', error);
      throw error;
    }
  }, [baseUser?.id, amount]);

  // OnchainKit status handler for crypto top-up
  const handleCryptoStatus = useCallback(async (status: LifecycleStatus) => {
    console.log('Crypto top-up checkout status:', status);

    if (status.statusName === 'success') {
      // Payment completed successfully
      setStep('success');
      // Refresh user data to show updated balance
      await refreshUserData();

      // Send in-app notification for the successful top-up
      if (baseUser?.id) {
        notificationService.notifyTopUp(baseUser.id, amount).catch(err => {
          console.warn('[TopUpWalletModal] Failed to send crypto top-up notification:', err);
        });
      }

      onSuccess?.();
    } else if (status.statusName === 'error') {
      console.error('Crypto payment error:', status.statusData);
      setError('Payment failed. Please try again.');
      setStep('error');
    }
  }, [refreshUserData, onSuccess, baseUser?.id, amount]);

  const handleAmountSelect = (selectedAmount: number) => {
    setAmount(selectedAmount);
  };

  const handleMethodSelect = (method: PaymentMethod) => {
    setPaymentMethod(method);
    // Reset amount to a valid default for the selected method
    if (method === 'crypto' && !TOP_UP_CHECKOUT_URLS[amount]) {
      setAmount(50);
    }
  };

  const handleContinue = () => {
    if (paymentMethod === 'crypto') {
      // Validate selected amount is available
      if (!TOP_UP_CHECKOUT_URLS[amount]) {
        setError(`Please select one of the available amounts: $${PRESET_AMOUNTS.join(', $')}`);
        return;
      }
    }
    setError('');
    void initiatePayment();
  };

  const handleMethodContinue = () => {
    setStep('amount');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[200] p-4">
      <div className="bg-[#2B2B2B] rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <Wallet className="text-[#DDE404]" size={24} />
            <h2 className="text-xl sequel-75 text-white uppercase">{textOverrides?.modalTitle || 'Top Up Balance'}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        <div className="p-6">
          {/* First Top-Up Bonus Banner - only show if user hasn't used bonus */}
          {!hasUsedBonus && step !== 'success' && step !== 'error' && (
            <div className="mb-6 bg-[#DDE404]/15 border border-[#DDE404]/40 rounded-lg p-4 flex items-start gap-3">
              <Gift size={24} className="text-[#DDE404] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[#DDE404] sequel-75 text-sm mb-1">50% Top Up Bonus!</p>
                <p className="text-white/70 sequel-45 text-xs">
                  Your first deposit gets an additional 50% bonus balance, uncapped! Note: Bonus is unwithdrawable until 1.5x the balance has been played with.
                </p>
              </div>
            </div>
          )}

          {step === 'method' && (
            <div className="space-y-4">
              <div>
                <p className="text-white sequel-45 mb-3 text-sm">{textOverrides?.methodSelectionTitle || 'Select payment method:'}</p>
                <div className="grid grid-cols-1 gap-2">
                  {/* Option 1: Top up with another wallet (Instant wallet transfer) */}
                  {hasWalletBalance && (
                    <button
                      onClick={() => handleMethodSelect('instant')}
                      className={`flex items-center justify-between gap-3 p-3 rounded-xl transition-all w-full ${
                        paymentMethod === 'instant'
                          ? 'bg-green-500/20 border-2 border-green-500'
                          : 'bg-[#3A3A3A] border-2 border-green-500/30 hover:border-green-500/60'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${paymentMethod === 'instant' ? 'bg-green-500' : 'bg-green-500/20'}`}>
                          <Wallet size={20} className={paymentMethod === 'instant' ? 'text-white' : 'text-green-400'} />
                        </div>
                        <div className="text-left">
                          <p className={`sequel-75 text-sm ${paymentMethod === 'instant' ? 'text-green-400' : 'text-white'}`}>
                            {textOverrides?.instantTopUpLabel || 'From Wallet'}
                          </p>
                          <p className="text-green-400 sequel-45 text-xs">
                            ${walletUsdcBalance.toFixed(2)} available • Instant
                          </p>
                        </div>
                      </div>
                      <ChevronRight size={18} className="text-green-400 flex-shrink-0" />
                    </button>
                  )}

                  {/* Option 2: Top up with Coinbase (Commerce flow) */}
                  <div className="relative">
                    <div className="absolute -top-1.5 -right-1.5 bg-[#DDE404] text-black text-[9px] font-bold px-1.5 py-0.5 rounded-full z-10">
                      RECOMMENDED
                    </div>
                    <button
                      onClick={() => handleMethodSelect('commerce')}
                      className={`flex items-center justify-between gap-3 p-3 rounded-xl transition-all w-full ${
                        paymentMethod === 'commerce'
                          ? 'bg-[#DDE404]/20 border-2 border-[#DDE404]'
                          : 'bg-[#3A3A3A] border-2 border-[#DDE404]/30 hover:border-[#DDE404]/60'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${paymentMethod === 'commerce' ? 'bg-[#DDE404]' : 'bg-[#DDE404]/20'}`}>
                          <Coins size={20} className={paymentMethod === 'commerce' ? 'text-black' : 'text-[#DDE404]'} />
                        </div>
                        <div className="text-left">
                          <p className={`sequel-75 text-sm ${paymentMethod === 'commerce' ? 'text-[#DDE404]' : 'text-white'}`}>
                            {textOverrides?.cryptoTopUpLabel || 'Coinbase'}
                          </p>
                          <p className="text-[#DDE404]/70 sequel-45 text-xs">
                            BTC, ETH, SOL & 60+ cryptos
                          </p>
                        </div>
                      </div>
                      <ChevronRight size={18} className="text-[#DDE404] flex-shrink-0" />
                    </button>
                  </div>

                  {/* Option 3: Pay with Card - Coming Soon */}
                  <button
                    disabled={true}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl w-full bg-[#3A3A3A] border-2 border-gray-600/30 opacity-50 cursor-not-allowed"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-gray-600/30 flex items-center justify-center flex-shrink-0">
                        <CreditCard size={20} className="text-gray-500" />
                      </div>
                      <div className="text-left">
                        <p className="sequel-75 text-sm text-gray-400">Card Payment</p>
                        <p className="text-gray-500 sequel-45 text-xs">Coming soon</p>
                      </div>
                    </div>
                    <ChevronRight size={18} className="text-gray-600 flex-shrink-0" />
                  </button>
                </div>
              </div>

              <button
                onClick={handleMethodContinue}
                disabled={!paymentMethod}
                className="w-full py-3 px-6 bg-gradient-to-r from-[#DDE404] to-[#C5CC03] hover:from-[#C5CC03] hover:to-[#DDE404] text-black sequel-75 uppercase rounded-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-[#DDE404]/20 hover:shadow-[#DDE404]/30 hover:scale-[1.01] active:scale-[0.99] text-sm"
              >
                Continue
              </button>
            </div>
          )}

          {step === 'amount' && (
            <div className="space-y-6">
              <div>
                <button
                  onClick={() => setStep('method')}
                  className="text-gray-400 text-sm sequel-45 mb-4 hover:text-white transition-colors flex items-center gap-1"
                >
                  ← Back to payment methods
                </button>

                {paymentMethod === 'offramp' ? (
                  <div className="text-center py-4">
                    <p className="text-white sequel-45 mb-4">
                      You will be redirected to Coinbase to complete your cash out.
                    </p>
                    <p className="text-gray-400 text-xs sequel-45">
                      You can select the amount and destination in the Coinbase widget.
                    </p>
                  </div>
                ) : paymentMethod === 'instant' ? (
                  <>
                    <p className="text-white sequel-45 mb-4 text-sm">Select amount to top up from your wallet:</p>
                    <div className="grid grid-cols-4 gap-3 mb-4">
                      {PRESET_AMOUNTS.filter(a => a <= walletUsdcBalance).map((presetAmount) => (
                        <button
                          key={presetAmount}
                          onClick={() => handleAmountSelect(presetAmount)}
                          className={`py-3 px-4 rounded-lg sequel-75 transition-all ${
                            amount === presetAmount
                              ? 'bg-[#DDE404] text-black'
                              : 'bg-[#3A3A3A] text-white hover:bg-[#4A4A4A]'
                          }`}
                        >
                          ${presetAmount}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 text-[#DDE404] text-sm sequel-45">
                      <Wallet size={16} />
                      <span>Wallet Balance: ${walletUsdcBalance.toFixed(2)} USDC</span>
                    </div>
                    <p className="text-gray-400 text-xs sequel-45 mt-2">
                      Funds will be transferred instantly from your wallet to your balance.
                    </p>
                  </>
                ) : paymentMethod === 'fund' ? (
                  <>
                    <p className="text-white sequel-45 mb-4 text-sm">Select amount to fund:</p>
                    <div className="grid grid-cols-4 gap-3 mb-4">
                      {PRESET_AMOUNTS.map((presetAmount) => (
                        <button
                          key={presetAmount}
                          onClick={() => handleAmountSelect(presetAmount)}
                          className={`py-3 px-4 rounded-lg sequel-75 transition-all ${
                            amount === presetAmount
                              ? 'bg-blue-500 text-white'
                              : 'bg-[#3A3A3A] text-white hover:bg-[#4A4A4A]'
                          }`}
                        >
                          ${presetAmount}
                        </button>
                      ))}
                    </div>
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                      <p className="text-blue-400 text-xs sequel-45">
                        Quick funding via Coinbase. Perfect for existing Coinbase users.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-white sequel-45 mb-4 text-sm">Select amount to add:</p>
                    <div className="grid grid-cols-4 gap-3 mb-4">
                      {(paymentMethod === 'commerce' ? COMMERCE_PRESET_AMOUNTS : PRESET_AMOUNTS).map((presetAmount) => (
                        <button
                          key={presetAmount}
                          onClick={() => handleAmountSelect(presetAmount)}
                          className={`py-3 px-4 rounded-lg sequel-75 transition-all ${
                            amount === presetAmount
                              ? paymentMethod === 'crypto' ? 'bg-orange-500 text-white' : 'bg-violet-500 text-white'
                              : 'bg-[#3A3A3A] text-white hover:bg-[#4A4A4A]'
                          }`}
                        >
                          ${presetAmount}
                        </button>
                      ))}
                    </div>
                    <p className="text-gray-400 text-xs sequel-45 mt-2">
                      {paymentMethod === 'commerce'
                        ? 'Pay via Coinbase Commerce hosted checkout'
                        : 'Pay with Bitcoin, Ethereum & 60+ cryptocurrencies'}
                    </p>
                  </>
                )}
              </div>

              {error && (
                <div className="flex items-center gap-2 text-red-400 text-sm sequel-45">
                  <AlertCircle size={16} />
                  <span>{error}</span>
                </div>
              )}

              <button
                onClick={handleContinue}
                disabled={
                  (paymentMethod === 'instant' && amount > walletUsdcBalance) ||
                  ((paymentMethod === 'crypto' || paymentMethod === 'commerce') && !TOP_UP_CHECKOUT_URLS[amount])
                }
                className={`w-full py-4 px-6 sequel-75 uppercase rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 shadow-lg hover:scale-[1.01] active:scale-[0.99] text-base ${
                  paymentMethod === 'fund' ? 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-500 text-white shadow-blue-500/20 hover:shadow-blue-500/30' :
                  paymentMethod === 'crypto' ? 'bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-500 text-white shadow-orange-500/20 hover:shadow-orange-500/30' :
                  paymentMethod === 'commerce' ? 'bg-gradient-to-r from-violet-500 to-violet-600 hover:from-violet-600 hover:to-violet-500 text-white shadow-violet-500/20 hover:shadow-violet-500/30' :
                  'bg-gradient-to-r from-[#DDE404] to-[#C5CC03] hover:from-[#C5CC03] hover:to-[#DDE404] text-black shadow-[#DDE404]/20 hover:shadow-[#DDE404]/30'
                }`}
              >
                {paymentMethod === 'offramp'
                  ? 'Continue to Cash Out'
                  : paymentMethod === 'instant'
                  ? `Top Up Instantly - $${amount}`
                  : paymentMethod === 'fund'
                  ? `Fund $${amount} via Coinbase`
                  : paymentMethod === 'commerce'
                  ? `Checkout - $${amount}`
                  : `Pay with Crypto - $${amount}`}
              </button>
            </div>
          )}

          {step === 'loading' && (
            <div className="py-12 text-center">
              <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-700 border-t-[#DDE404] mx-auto mb-4"></div>
              <p className="text-white sequel-45">Creating payment...</p>
              <p className="text-gray-400 text-xs sequel-45 mt-2">
                {paymentMethod === 'offramp'
                  ? 'Redirecting to Coinbase...'
                  : paymentMethod === 'instant'
                  ? 'Preparing wallet transaction...'
                  : 'Preparing checkout...'}
              </p>
            </div>
          )}

          {/* Instant Top-Up Processing - Wallet transaction in progress */}
          {step === 'instant-processing' && (
            <div className="py-12 text-center">
              <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-700 border-t-[#DDE404] mx-auto mb-4"></div>
              <p className="text-white sequel-45 mb-2">Processing Instant Top-Up</p>
              <p className="text-[#DDE404] sequel-75 text-xl mb-4">${amount} USDC</p>
              <p className="text-gray-400 text-xs sequel-45">
                Please confirm the transaction in your wallet...
              </p>
              <p className="text-gray-500 text-xs sequel-45 mt-2">
                Your balance will be credited immediately after confirmation.
              </p>
            </div>
          )}

          {/* Coinbase Onramp Processing - DISABLED */}

          {/* FundButton Step - OnchainKit FundButton */}
          {step === 'fund-button' && walletAddress && (
            <div className="space-y-4">
              <p className="text-white sequel-45 text-sm text-center">
                Fund ${amount} via Coinbase
              </p>

              <div className="bg-gradient-to-br from-blue-900/40 to-blue-800/30 rounded-lg p-6 text-center border border-blue-500/30">
                <p className="text-blue-300 sequel-45 text-sm mb-4">
                  Click the button below to fund your wallet:
                </p>
                <div className="flex justify-center">
                  <FundButton
                    fundingUrl={getOnrampBuyUrl({
                      projectId: getCDPProjectId(),
                      addresses: { [walletAddress]: ['base'] },
                      assets: ['USDC'],
                      presetFiatAmount: amount,
                      fiatCurrency: 'USD',
                    })}
                    className="w-full max-w-xs"
                  />
                </div>
              </div>

              <div className="flex items-center justify-center gap-2 text-blue-400 text-xs sequel-45">
                <div className="animate-pulse w-2 h-2 bg-blue-500 rounded-full"></div>
                <span>Complete funding in Coinbase popup</span>
              </div>

              <p className="text-gray-500 text-xs sequel-45 text-center">
                Fast funding for Coinbase users. USDC is deposited to your Base wallet.
              </p>

              {/* Completion button */}
              <div className="border-t border-gray-700 pt-4 mt-4">
                <button
                  onClick={() => {
                    setStep('success');
                    refreshUserData();
                    onSuccess?.();
                  }}
                  className="w-full py-4 px-6 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-500 text-white sequel-75 uppercase rounded-xl transition-all duration-300 shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 hover:scale-[1.01] active:scale-[0.99]"
                >
                  I've Completed Funding
                </button>
                <p className="text-gray-400 text-xs sequel-45 text-center mt-2">
                  Click once your funding is complete
                </p>
              </div>

              <button
                onClick={() => setStep('method')}
                className="w-full py-3 px-4 bg-transparent border border-white/20 text-white/60 hover:text-white hover:border-white/40 sequel-45 text-sm rounded-xl transition-all duration-200"
              >
                Cancel
              </button>
            </div>
          )}

          {/* OnchainKit Crypto Checkout - In-app modal (no redirect) */}
          {step === 'crypto-checkout' && (
            <div className="space-y-4">
              <p className="text-white sequel-45 text-sm text-center">
                Add ${amount} USD to your balance
              </p>

              <div className="bg-[#1A1A1A] rounded-lg p-6">
                <p className="text-orange-300 sequel-45 text-sm text-center mb-4">
                  Pay with Bitcoin, Ethereum, or other cryptocurrencies
                </p>
                <div className="flex justify-center">
                  <Checkout
                    chargeHandler={handleCryptoChargeCreate}
                    onStatus={handleCryptoStatus}
                  >
                    <CheckoutButton
                      coinbaseBranded
                      className="w-full max-w-xs"
                    />
                    <CheckoutStatus />
                  </Checkout>
                </div>
              </div>

              <div className="flex items-center justify-center gap-2 text-orange-400 text-xs sequel-45">
                <div className="animate-pulse w-2 h-2 bg-orange-500 rounded-full"></div>
                <span>Complete payment in checkout popup</span>
              </div>

              <p className="text-gray-500 text-xs sequel-45 text-center">
                Supports Bitcoin, Ethereum, Litecoin, Dogecoin, and 60+ cryptocurrencies.
              </p>

              <button
                onClick={() => setStep('method')}
                className="w-full py-3 px-4 bg-transparent border border-white/20 text-white/60 hover:text-white hover:border-white/40 sequel-45 text-sm rounded-xl transition-all duration-200"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Coinbase Commerce Checkout - Redirect to hosted checkout page */}
          {step === 'commerce-checkout' && checkoutUrl && (
            <div className="space-y-4">
              <p className="text-white sequel-45 text-sm text-center">
                Add ${amount} USD to your balance
              </p>

              <div className="bg-[#1A1A1A] rounded-lg p-6 text-center">
                <p className="text-white/60 sequel-45 text-sm mb-4">
                  Complete your payment on Coinbase Commerce:
                </p>
                <a
                  href={checkoutUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 py-4 px-10 bg-gradient-to-r from-[#0052FF] to-[#0066FF] hover:from-[#0066FF] hover:to-[#0052FF] text-white sequel-75 uppercase rounded-xl transition-all duration-300 shadow-lg shadow-[#0052FF]/30 hover:shadow-[#0052FF]/40 hover:scale-[1.02] active:scale-[0.98]"
                >
                  <ExternalLink size={18} />
                  Pay with Coinbase
                </a>
              </div>

              <div className="flex items-center justify-center gap-2 text-[#DDE404] text-xs sequel-45">
                <div className="animate-pulse w-2 h-2 bg-[#DDE404] rounded-full"></div>
                <span>Waiting for payment confirmation...</span>
              </div>

              <div className="flex items-center justify-center gap-3 text-xs sequel-45 mt-3">
                <div className="flex items-center gap-1 text-gray-400">
                  <Wallet size={14} />
                  <span>Coinbase Account</span>
                </div>
                <span className="text-white/30">•</span>
                <div className="flex items-center gap-1 text-gray-400">
                  <CreditCard size={14} />
                  <span>60+ Cryptocurrencies</span>
                </div>
              </div>

              <p className="text-gray-500 text-xs sequel-45 text-center">
                Pay with your Coinbase account or any supported cryptocurrency. Your balance will be credited automatically once payment is confirmed.
              </p>

              {/* Head Back to Site button - shown after user opens checkout */}
              <div className="border-t border-gray-700 pt-4 mt-4">
                <button
                  onClick={onClose}
                  className="w-full py-4 px-6 bg-gradient-to-r from-[#DDE404] to-[#C5CC03] hover:from-[#C5CC03] hover:to-[#DDE404] text-black sequel-75 uppercase rounded-xl transition-all duration-300 shadow-lg shadow-[#DDE404]/20 hover:shadow-[#DDE404]/30 hover:scale-[1.01] active:scale-[0.99]"
                >
                  Head Back to Site
                </button>
                <p className="text-gray-400 text-xs sequel-45 text-center mt-2">
                  (transactions can take up to 30 seconds, don't worry, it's coming!)
                </p>
              </div>

              <button
                onClick={() => setStep('method')}
                className="w-full py-3 px-4 bg-transparent border border-white/20 text-white/60 hover:text-white hover:border-white/40 sequel-45 text-sm rounded-xl transition-all duration-200"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Commerce checkout loading/error fallback when URL is missing */}
          {step === 'commerce-checkout' && !checkoutUrl && (
            <div className="py-8 text-center">
              <div className="w-16 h-16 border-4 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <h3 className="text-white sequel-75 text-xl mb-2">Creating Checkout</h3>
              <p className="text-gray-400 sequel-45 mb-4">
                Setting up your payment...
              </p>
              <p className="text-gray-500 text-xs sequel-45">
                If this takes too long, please try again.
              </p>
              <button
                onClick={() => setStep('method')}
                className="mt-4 py-3 px-6 bg-transparent border border-white/20 text-white/60 hover:text-white hover:border-white/40 sequel-45 text-sm rounded-xl transition-all duration-200"
              >
                Cancel
              </button>
            </div>
          )}

          {/* External checkout for Offramp only (requires external redirect) */}
          {step === 'checkout' && checkoutUrl && (
            <div className="space-y-4">
              <p className="text-white sequel-45 text-sm text-center">
                Complete your cash out via Coinbase
              </p>

              <div className="bg-[#1A1A1A] rounded-lg p-6 text-center">
                <p className="text-white/60 sequel-45 text-sm mb-4">
                  Click the button below to complete your cash out:
                </p>
                <a
                  href={checkoutUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 py-4 px-10 bg-gradient-to-r from-[#DDE404] to-[#C5CC03] hover:from-[#C5CC03] hover:to-[#DDE404] text-black sequel-75 uppercase rounded-xl transition-all duration-300 shadow-lg shadow-[#DDE404]/20 hover:shadow-[#DDE404]/30 hover:scale-[1.02] active:scale-[0.98]"
                >
                  <ExternalLink size={18} />
                  Complete Cash Out
                </a>
              </div>

              <p className="text-gray-500 text-xs sequel-45 text-center">
                After completing the cash out, funds will be sent to your bank or Coinbase account.
              </p>

              <button
                onClick={onClose}
                className="w-full py-3 px-4 bg-transparent border border-white/20 text-white/60 hover:text-white hover:border-white/40 sequel-45 text-sm rounded-xl transition-all duration-200"
              >
                Close
              </button>
            </div>
          )}

          {step === 'success' && (
            <div className="py-12 text-center">
              <div className="w-16 h-16 bg-[#DDE404] rounded-full flex items-center justify-center mx-auto mb-4">
                <Check size={32} className="text-black" />
              </div>
              <h3 className="text-white sequel-75 text-xl mb-2">{textOverrides?.successMessage || 'Payment Successful!'}</h3>
              <p className="text-gray-400 sequel-45 mb-6">Your balance has been updated.</p>
              <button
                onClick={onClose}
                className="py-4 px-10 bg-gradient-to-r from-[#DDE404] to-[#C5CC03] hover:from-[#C5CC03] hover:to-[#DDE404] text-black sequel-75 uppercase rounded-xl transition-all duration-300 shadow-lg shadow-[#DDE404]/20 hover:shadow-[#DDE404]/30 hover:scale-[1.02] active:scale-[0.98] text-base"
              >
                Done
              </button>
            </div>
          )}

          {step === 'error' && (
            <div className="py-12 text-center">
              <div className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle size={32} className="text-white" />
              </div>
              <h3 className="text-white sequel-75 text-xl mb-2">
                {paymentMethod === 'offramp' ? 'Cash Out Failed' : 'Payment Failed'}
              </h3>
              <p className="text-gray-400 sequel-45 mb-6">{error || 'Something went wrong. Please try again.'}</p>
              <button
                onClick={() => setStep('method')}
                className="py-4 px-10 bg-gradient-to-r from-[#DDE404] to-[#C5CC03] hover:from-[#C5CC03] hover:to-[#DDE404] text-black sequel-75 uppercase rounded-xl transition-all duration-300 shadow-lg shadow-[#DDE404]/20 hover:shadow-[#DDE404]/30 hover:scale-[1.02] active:scale-[0.98] text-base"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TopUpWalletModal;
