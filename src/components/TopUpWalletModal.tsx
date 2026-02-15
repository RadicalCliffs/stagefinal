import { useState, useEffect, useCallback } from 'react';
import { X, Check, AlertCircle, ExternalLink, CreditCard, Gift, Coins, ChevronRight, Wallet } from 'lucide-react';
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
import { useRealtimeSubscriptions } from '../hooks/useRealtimeSubscriptions';
import { pay, type PaymentOptions, type PaymentResult } from '@base-org/account/payment/browser';

// Text overrides for visual editor live preview
export interface TopUpWalletModalTextOverrides {
  modalTitle?: string;
  modalSubtitle?: string;
  methodSelectionTitle?: string;
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

type PaymentStep = 'method' | 'amount' | 'loading' | 'checkout' | 'crypto-checkout' | 'commerce-checkout' | 'onramp-processing' | 'fund-button' | 'base-account-processing' | 'success' | 'error';
type PaymentMethod = 'crypto' | 'commerce' | 'offramp' | 'onramp' | 'fund' | 'base-account';

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
  const { hasUsedBonus, refresh: refreshBalance, addPendingTopUp, removePendingTopUp } = useRealTimeBalance();
  const [step, setStep] = useState<PaymentStep>('method');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('commerce');
  const [amount, setAmount] = useState<number>(50);
  const [error, setError] = useState<string>('');
  const [checkoutUrl, setCheckoutUrl] = useState<string>('');
  const [transactionId, setTransactionId] = useState<string>('');
  const [cryptoChargeId, setCryptoChargeId] = useState<string>('');
  const [onrampUrl, setOnrampUrl] = useState<string>('');
  const [baseAccountLoading, setBaseAccountLoading] = useState<boolean>(false);
  const [optimisticTopUpId, setOptimisticTopUpId] = useState<string | null>(null);

  // Real-time subscriptions for balance and transaction updates
  // Auto-refreshes balance when changes are detected in the database
  useRealtimeSubscriptions({
    onBalanceLedgerChange: useCallback(() => {
      if (baseUser?.id && isOpen) {
        console.log('[TopUpWalletModal] Balance ledger changed, refreshing balance');
        refreshBalance();
      }
    }, [baseUser?.id, isOpen, refreshBalance]),
    onUserTransactionChange: useCallback((payload: any) => {
      if (baseUser?.id && isOpen) {
        const status = (payload.new?.status || '').toLowerCase();
        if (status === 'completed' || status === 'confirmed' || status === 'success') {
          console.log('[TopUpWalletModal] Transaction completed, refreshing balance');
          refreshBalance();
        }
      }
    }, [baseUser?.id, isOpen, refreshBalance]),
    debounceMs: 500,
  });

  // Get user's primary wallet address for Base Account payments
  const primaryWallet = linkedWallets.find(w => w.isEmbeddedWallet === true) ||
    linkedWallets.find(w => w.isBaseAccount === true) ||
    linkedWallets.find(w => w.chainType === 'ethereum') ||
    linkedWallets[0];

  const walletAddress = primaryWallet?.address;

  useEffect(() => {
    if (!isOpen) {
      setStep('method');
      setPaymentMethod('commerce');
      setAmount(50);
      setError('');
      setCheckoutUrl('');
      setTransactionId('');
      setCryptoChargeId('');
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
            .single() as { data: { status?: string } | null };

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
      if (paymentMethod === 'crypto') {
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
      } else if (paymentMethod === 'base-account') {
        // Base Account payment flow - one-tap USDC payment
        setStep('base-account-processing');
        setBaseAccountLoading(true);
        await handleBaseAccountTopUp();
      }
    } catch (err) {
      console.error('Payment initiation error:', err);
      setError(err instanceof Error ? err.message : 'Failed to initiate payment');
      setStep('error');
      setBaseAccountLoading(false);
    }
  };

  // Handle Base Account top-up - One-tap USDC payment via Base Account SDK
  const handleBaseAccountTopUp = async () => {
    if (!baseUser?.id) {
      setError('Please log in first');
      setStep('error');
      setBaseAccountLoading(false);
      return;
    }

    // Validate wallet address is available for sender identification
    if (!walletAddress) {
      console.error('[TopUpWalletModal] No wallet address available for top-up');
      setError('No wallet connected. Please connect a wallet first.');
      setStep('error');
      setBaseAccountLoading(false);
      return;
    }

    try {
      const treasuryAddress = import.meta.env.VITE_TREASURY_ADDRESS;
      if (!treasuryAddress) {
        console.error('[TopUpWalletModal] VITE_TREASURY_ADDRESS not configured');
        throw new Error('Payment system configuration error. Please contact support.');
      }

      // Validate treasury address format
      if (!treasuryAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        console.error('[TopUpWalletModal] Invalid treasury address format');
        throw new Error('Payment system configuration error. Please contact support.');
      }

      console.log('[TopUpWalletModal] Starting Base Account top-up flow', {
        amount,
        senderWallet: walletAddress.substring(0, 10) + '...',
        treasuryConfigured: !!treasuryAddress,
      });

      // Determine if using testnet
      const isTestnet = import.meta.env.VITE_BASE_MAINNET !== 'true';

      // Process payment via Base Account SDK first
      // This sends USDC from user's wallet to treasury on-chain
      const paymentOptions: PaymentOptions = {
        to: treasuryAddress as `0x${string}`,
        amount: amount.toFixed(2),
        testnet: isTestnet,
      };

      console.log('[TopUpWalletModal] Calling Base Account SDK pay()');

      const paymentResult = await pay(paymentOptions);

      console.log('[TopUpWalletModal] Base Account payment result:', {
        success: (paymentResult as any).success,
        hasTransactionHash: !!(paymentResult as any).transactionHash,
      });

      if (!(paymentResult as any).success) {
        throw new Error((paymentResult as any).error || 'Payment failed');
      }

      const transactionHash = (paymentResult as any).id || (paymentResult as any).transactionHash;
      if (!transactionHash) {
        throw new Error('Payment succeeded but no transaction hash returned');
      }

      // OPTIMISTIC UI: Add pending balance immediately after successful on-chain payment
      const topUpId = `topup_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      setOptimisticTopUpId(topUpId);
      addPendingTopUp(amount, topUpId);
      console.log('[TopUpWalletModal] Added optimistic balance update:', amount);

      // Show success immediately (optimistic) - verification will happen in background
      setTransactionId(transactionHash);
      setStep('success');
      await refreshUserData();

      // Dispatch balance update event
      window.dispatchEvent(new CustomEvent('balance-updated', {
        detail: { newBalance: amount } // Optimistic - actual balance will be updated later
      }));

      onSuccess?.();

      // After successful on-chain payment, call instant-topup to verify and credit balance
      // This runs in the background and doesn't block the user experience
      console.log('[TopUpWalletModal] Starting background verification and balance credit');

      // Get auth token for API call - prefer wallet-based auth
      const walletToken = `wallet:${walletAddress}`;
      const { data: sessionData } = await supabase.auth.getSession();
      const authToken = sessionData.session?.access_token || walletToken;

      const verifyAndCredit = async (): Promise<void> => {
        try {
          const topupResponse = await fetch('/api/instant-topup', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify({
              transactionHash,
              amount,
              walletAddress, // Sender wallet address for verification
            }),
          });

          const topupResult = await topupResponse.json();

          if (!topupResponse.ok || !topupResult.success) {
            // Log error but don't retry - backend now credits immediately
            console.error('[TopUpWalletModal] Backend top-up processing failed:', topupResult);
            // Don't show error to user - transaction was sent successfully on-chain
            // The optimistic UI update is sufficient
            return;
          }

          console.log('[TopUpWalletModal] Balance credited successfully:', {
            creditedAmount: topupResult.creditedAmount,
            bonusApplied: topupResult.bonusApplied,
            bonusAmount: topupResult.bonusAmount,
            newBalance: topupResult.newBalance,
            verificationStatus: topupResult.verificationStatus,
          });

          // Clear optimistic update now that balance is confirmed
          if (optimisticTopUpId) {
            removePendingTopUp(optimisticTopUpId);
            setOptimisticTopUpId(null);
          }

          // Update transaction ID if returned
          if (topupResult.transactionId) {
            setTransactionId(topupResult.transactionId);
          }

          // Refresh balance to get the actual amount (including any bonuses)
          await refreshUserData();

          // Dispatch actual balance update event
          if (topupResult.newBalance !== undefined && topupResult.newBalance !== null) {
            window.dispatchEvent(new CustomEvent('balance-updated', {
              detail: { newBalance: topupResult.newBalance }
            }));
          }

          // Send in-app notification
          if (baseUser?.id) {
            notificationService.notifyTopUp(baseUser.id, amount, topupResult.newBalance).catch(err => {
              console.warn('[TopUpWalletModal] Failed to send top-up notification:', err);
            });
          }
        } catch (err) {
          console.error('[TopUpWalletModal] Background verification error:', err);
          // Don't retry - the on-chain transaction was successful
          // Backend will credit the balance, and optimistic UI is already showing it
        }
      };

      // Start background verification and crediting
      verifyAndCredit().catch(err => {
        console.error('[TopUpWalletModal] Verification failed:', err);
      });
    } catch (err) {
      console.error('[TopUpWalletModal] Base Account top-up error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Payment failed';

      // Rollback optimistic update on error
      if (optimisticTopUpId) {
        removePendingTopUp(optimisticTopUpId);
        setOptimisticTopUpId(null);
        console.log('[TopUpWalletModal] Rolled back optimistic balance update');
      }

      // Provide user-friendly error messages
      if (errorMessage.includes('rejected') || errorMessage.includes('denied')) {
        setError('Payment was rejected');
      } else if (errorMessage.includes('insufficient')) {
        setError('Insufficient balance in your Base Account');
      } else if (errorMessage.includes('contact support')) {
        setError(errorMessage);
      } else {
        setError(errorMessage);
      }
      setStep('error');
    } finally {
      setBaseAccountLoading(false);
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
    // Automatically advance to amount selection step
    setStep('amount');
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
                <p className="text-[#DDE404] sequel-75 text-sm">50% First Deposit Bonus</p>
              </div>
            </div>
          )}

          {step === 'method' && (
            <div className="space-y-4">
              <div>
                <p className="text-white sequel-45 mb-3 text-sm">{textOverrides?.methodSelectionTitle || 'Choose method:'}</p>
                <div className="grid grid-cols-1 gap-2">
                  {/* Option 1: Top up with Coinbase Commerce - Primary method for balance top-ups */}
                  {/* Separated from entry purchases to ensure clear transaction tracking */}
                  <button
                    onClick={() => handleMethodSelect('commerce')}
                    className="w-full h-[72px] flex items-center justify-between px-4 bg-[#0052FF] rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 hover:brightness-110 active:scale-[0.99]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
                        <Coins size={22} className="text-white" />
                      </div>
                      <div className="text-left">
                        <p className="text-white sequel-75 text-sm uppercase">
                          {textOverrides?.cryptoTopUpLabel || 'Pay With Crypto'}
                        </p>
                        <p className="text-white/80 sequel-45 text-xs">
                          60+ cryptocurrencies supported
                        </p>
                      </div>
                    </div>
                    <ChevronRight size={20} className="text-white" />
                  </button>

                  {/* Option 2: Pay with Base Account - REMOVED from top-ups */}
                  {/* Now exclusively used for competition entry purchases to prevent transaction confusion */}
                  {/* Base Account payments are handled in PaymentModal for entries only */}

                  {/* Option 3: Pay with Card - Coming Soon - HIDDEN */}
                  {/* <button
                    disabled={true}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl w-full bg-[#3A3A3A] border-2 border-gray-600/30 opacity-50 cursor-not-allowed"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-gray-600/30 flex items-center justify-center flex-shrink-0">
                        <CreditCard size={20} className="text-gray-500" />
                      </div>
                      <div className="text-left">
                        <p className="sequel-75 text-sm text-gray-400">Card</p>
                        <p className="text-gray-500 sequel-45 text-xs">Soon</p>
                      </div>
                    </div>
                    <ChevronRight size={18} className="text-gray-600 flex-shrink-0" />
                  </button> */}
                </div>
              </div>
            </div>
          )}

          {step === 'amount' && (
            <div className="space-y-6">
              <div>
                <button
                  onClick={() => setStep('method')}
                  className="text-gray-400 text-sm sequel-45 mb-4 hover:text-white transition-colors flex items-center gap-1"
                >
                  ← Back
                </button>

                {paymentMethod === 'offramp' ? (
                  <div className="text-center py-4">
                    <p className="text-white sequel-45 mb-4">
                      Redirecting to Coinbase...
                    </p>
                  </div>
                ) : paymentMethod === 'fund' ? (
                  <>
                    <p className="text-white sequel-45 mb-4 text-sm">Select amount:</p>
                    <div className="grid grid-cols-4 gap-3 mb-4">
                      {PRESET_AMOUNTS.map((presetAmount) => (
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
                    <div className="bg-[#0052FF]/10 border border-[#0052FF]/30 rounded-lg p-3">
                      <p className="text-[#0052FF] text-xs sequel-45">
                        Quick Coinbase funding
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-white sequel-45 mb-4 text-sm">Select amount:</p>
                    <div className="grid grid-cols-4 gap-3 mb-4">
                      {(paymentMethod === 'commerce' ? COMMERCE_PRESET_AMOUNTS : PRESET_AMOUNTS).map((presetAmount) => (
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
                  (paymentMethod === 'crypto' && !TOP_UP_CHECKOUT_URLS[amount])
                }
                className="w-full h-[56px] flex items-center justify-center px-6 bg-[#0052FF] rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 hover:brightness-110 active:scale-[0.99]"
              >
                <span className="text-white sequel-75 text-sm uppercase">
                  {paymentMethod === 'offramp'
                    ? 'Cash Out'
                    : `Top Up $${amount}`}
                </span>
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
                  : 'Preparing checkout...'}
              </p>
            </div>
          )}

          {/* Base Account Processing */}
          {step === 'base-account-processing' && (
            <div className="py-12 text-center">
              <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-700 border-t-[#0052FF] mx-auto mb-4"></div>
              <p className="text-white sequel-45 mb-2">Processing Base Account Payment</p>
              <p className="text-[#0052FF] sequel-75 text-xl mb-4">${amount} USD</p>
              <p className="text-gray-400 text-xs sequel-45">
                Please complete the payment in the Base Account popup...
              </p>
              <p className="text-gray-500 text-xs sequel-45 mt-2">
                Your balance will be credited immediately after confirmation.
              </p>
            </div>
          )}

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
                      assets: ['USDC'],
                      presetFiatAmount: amount,
                      fiatCurrency: 'USD',
                    } as any)}
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
                  className="w-full h-[56px] flex items-center justify-center px-6 bg-[#0052FF] rounded-xl transition-all duration-200 hover:brightness-110 active:scale-[0.99]"
                >
                  <span className="text-white sequel-75 text-sm uppercase">Top Up Complete</span>
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
                  className="inline-flex items-center justify-center gap-2 h-[56px] px-10 bg-[#0052FF] text-white sequel-75 uppercase rounded-xl transition-all duration-200 hover:brightness-110 active:scale-[0.99]"
                >
                  <ExternalLink size={18} />
                  <span className="text-sm">Top Up via Coinbase</span>
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
                  className="w-full h-[56px] flex items-center justify-center px-6 bg-[#0052FF] rounded-xl transition-all duration-200 hover:brightness-110 active:scale-[0.99]"
                >
                  <span className="text-white sequel-75 text-sm uppercase">Head Back to Site</span>
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
                  className="inline-flex items-center justify-center gap-2 h-[56px] px-10 bg-[#0052FF] text-white sequel-75 uppercase rounded-xl transition-all duration-200 hover:brightness-110 active:scale-[0.99]"
                >
                  <ExternalLink size={18} />
                  <span className="text-sm">Complete Cash Out</span>
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
                className="h-[56px] px-10 flex items-center justify-center mx-auto bg-[#0052FF] rounded-xl transition-all duration-200 hover:brightness-110 active:scale-[0.99]"
              >
                <span className="text-white sequel-75 text-base uppercase">Done</span>
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
                className="h-[56px] px-10 flex items-center justify-center mx-auto bg-[#0052FF] rounded-xl transition-all duration-200 hover:brightness-110 active:scale-[0.99]"
              >
                <span className="text-white sequel-75 text-base uppercase">Try Again</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TopUpWalletModal;
