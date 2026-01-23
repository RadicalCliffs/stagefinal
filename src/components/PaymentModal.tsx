import React, { useEffect, useState, useCallback, useRef, useMemo, lazy, Suspense } from "react";
import { useNavigate } from "react-router";
import { supabase } from "../lib/supabase";
import { footerLogo, applePay, visaLogo, masterCardLogo } from "../assets/images";
import PaymentStatus from "./PaymentStatus";
import { usePaymentStatus } from "../hooks/useGetPaymentStatus";
import { CircleX, Check, Wallet, DollarSign, Clock, AlertTriangle, RefreshCw, CreditCard, Sparkles, Shield, ChevronRight, ArrowLeft, Coins, ExternalLink } from "lucide-react";
import { useAuthUser } from "../contexts/AuthContext";
import type { UserInfo } from "./UserInfoModal";
import { BasePaymentService } from "../lib/base-payment";
import { BaseAccountPaymentService } from "../lib/base-account-payment";
import { purchaseTicketsWithBalance, getUserBalance, executeBalancePaymentRPC } from "../lib/ticketPurchaseService";
import { toCanonicalUserId } from "../lib/canonicalUserId";
import { isSuccessStatus, isFailureStatus } from "../lib/payment-status";
import { getPaymentErrorInfo, type PaymentErrorInfo } from "../lib/error-handler";
import { OnchainKitCheckoutService } from "../lib/onchainkit-checkout";
import { CoinbaseCommerceService } from "../lib/coinbase-commerce";
// Note: CoinbaseOnrampService removed - card payments now go through Commerce flow
import { Checkout, CheckoutButton, CheckoutStatus } from '@coinbase/onchainkit/checkout';
import type { LifecycleStatus } from '@coinbase/onchainkit/checkout';
import { useBaseSubAccount } from "../hooks/useBaseSubAccount";
// Wagmi hook for getting the wallet client (provider) for transactions
import { useWalletClient } from 'wagmi';

// Lazy load TopUpWalletModal - only loaded when user clicks the banner
const TopUpWalletModal = lazy(() => import('./TopUpWalletModal'));

// Cryptocurrency options for the "Pay with Other Crypto" selection step
const CRYPTO_OPTIONS = [
  { id: 'btc', name: 'Bitcoin', symbol: 'BTC', color: '#F7931A', icon: '₿' },
  { id: 'eth', name: 'Ethereum', symbol: 'ETH', color: '#627EEA', icon: 'Ξ' },
  { id: 'doge', name: 'Dogecoin', symbol: 'DOGE', color: '#C2A633', icon: 'Ð' },
  { id: 'ltc', name: 'Litecoin', symbol: 'LTC', color: '#345D9D', icon: 'Ł' },
  { id: 'sol', name: 'Solana', symbol: 'SOL', color: '#9945FF', icon: '◎' },
  { id: 'other', name: 'Other (60+ coins)', symbol: 'MORE', color: '#8B5CF6', icon: '⋯' },
] as const;

type CryptoOption = typeof CRYPTO_OPTIONS[number]['id'];

/**
 * Format transaction hash for logging (truncate and handle null)
 */
function formatTransactionHash(hash: string | null | undefined): string {
  return hash ? hash.substring(0, 16) + '...' : 'N/A';
}

/**
 * Unified ticket confirmation parameters - standardized across all payment methods
 * This ensures consistency regardless of which payment flow was used
 */
interface ConfirmTicketsParams {
  reservationId: string | null | undefined;
  userId: string;
  competitionId: string;
  transactionHash: string;
  paymentProvider: string;
  walletAddress: string | null;
  selectedTickets: number[];
  ticketCount: number;
  sessionId?: string;
}

/**
 * Unified helper to confirm tickets after successful payment
 * All payment methods MUST use this to ensure consistent confirmation behavior
 */
async function confirmTicketsUnified(params: ConfirmTicketsParams): Promise<{
  success: boolean;
  ticketNumbers?: number[];
  error?: string;
  alreadyConfirmed?: boolean;
}> {
  const {
    reservationId,
    userId,
    competitionId,
    transactionHash,
    paymentProvider,
    walletAddress,
    selectedTickets,
    ticketCount,
    sessionId,
  } = params;

  console.log('[PaymentModal] confirmTicketsUnified called with:', {
    reservationId,
    userId: userId?.substring(0, 10) + '...',
    competitionId: competitionId?.substring(0, 10) + '...',
    paymentProvider,
    ticketCount,
    hasSelectedTickets: selectedTickets?.length > 0,
    transactionHash: formatTransactionHash(transactionHash),
  });

  try {
    const response = await fetch('/api/confirm-pending-tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Always pass reservationId first - this is the most reliable lookup
        reservationId: reservationId || null,
        // User identifier - could be wallet address or Privy DID
        // Send both userId AND userIdentifier for backward compatibility with different function versions
        userId,
        userIdentifier: userId,
        // Competition being entered
        competitionId,
        // Transaction hash for idempotency - prevents duplicate confirmations
        transactionHash,
        // Payment provider for tracking
        paymentProvider,
        // Wallet address for entry records
        walletAddress: walletAddress || null,
        // Selected tickets (for manual selection flow)
        selectedTickets: selectedTickets || [],
        // Ticket count (for lucky dip allocation)
        ticketCount: ticketCount || 1,
        // Session ID for fallback lookup
        sessionId: sessionId || null,
      }),
    });

    let result: any;
    try {
      result = await response.json();
    } catch (parseError) {
      console.error('[PaymentModal] Failed to parse confirmation response:', parseError);
      console.error('[PaymentModal] Response status:', response.status);
      console.error('[PaymentModal] Response statusText:', response.statusText);
      return {
        success: false,
        error: `Server returned invalid response (HTTP ${response.status}). Please contact support with transaction hash: ${formatTransactionHash(transactionHash)}`,
      };
    }
    
    console.log('[PaymentModal] confirmTicketsUnified result:', result);

    if (result.success) {
      return {
        success: true,
        ticketNumbers: result.ticketNumbers,
        alreadyConfirmed: result.alreadyConfirmed || false,
      };
    } else {
      console.error('[PaymentModal] Ticket confirmation failed:', result.error);
      return {
        success: false,
        error: result.error || 'Ticket confirmation failed',
      };
    }
  } catch (err) {
    console.error('[PaymentModal] confirmTicketsUnified error:', err);
    console.error('[PaymentModal] Error details:', err instanceof Error ? err.stack : err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Network error during confirmation',
    };
  }
}

// Text overrides for visual editor live preview
export interface PaymentModalTextOverrides {
  modalTitle?: string;
  modalSubtitle?: string;
  balanceLabel?: string;
  totalLabel?: string;
  confirmButtonText?: string;
  successMessage?: string;
}

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
  ticketCount: number;
  competitionId: string;
  ticketPrice: number;
  userInfo?: UserInfo;
  selectedTickets?: number[];
  reservationId?: string | null;
  onPaymentSuccess?: () => void;
  maxAvailableTickets?: number; // Hard limit from inventory
  // Optional text overrides for visual editor live preview
  textOverrides?: PaymentModalTextOverrides;
}

type PaymentStep = 'initial' | 'checkout' | 'base-processing' | 'base-account-processing' | 'balance-processing' | 'onchainkit-processing' | 'crypto-selection' | 'othercrypto-processing' | 'oneclick-processing' | 'commerce-checkout' | 'success' | 'error';
type PaymentMethod = 'coinbase' | 'base' | 'base-account' | 'balance' | 'onchainkit' | 'othercrypto' | 'oneclick' | 'card' | 'commerce';

const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  onClose,
  ticketCount: rawTicketCount,
  competitionId,
  ticketPrice: rawTicketPrice,
  onOpen,
  userInfo: _userInfo,
  selectedTickets = [],
  reservationId,
  onPaymentSuccess,
  maxAvailableTickets,
  textOverrides,
}) => {
  // Ensure ticketPrice is a valid positive number (handles string coercion from database)
  const ticketPrice = Number(rawTicketPrice) || 1;

  // Hard cap ticket count to available inventory to prevent overpayment
  const maxTickets = maxAvailableTickets !== undefined ? maxAvailableTickets : Infinity;
  const ticketCount = Math.min(rawTicketCount, maxTickets);

  // Calculate amount based on capped ticket count
  const amount = Number(ticketCount * ticketPrice);
  const navigate = useNavigate();
  // Hooks must be called unconditionally at the top level
  const { authenticated, baseUser, profile, linkedWallets, refreshUserData } = useAuthUser();
  // Base Sub Account for passkey-free payments (when available)
  const {
    isSupported: hasSubAccount,
    subAccount,
    hasSpendPermission,
    spendPermission,
    enableOneClickPayments,
    canOneClickSpend,
    spendLimitInfo,
  } = useBaseSubAccount();
  // Get the wallet client from wagmi for direct wallet transactions
  // This provides the EIP-1193 provider needed for Base USDC payments
  const { data: walletClient } = useWalletClient();
  
  // Memoize treasury address to avoid repeated env var access and toLowerCase() calls
  const treasuryAddress = useMemo(
    () => import.meta.env.VITE_TREASURY_ADDRESS?.toLowerCase(),
    []
  );
  
  // Helper to get the primary wallet address (respects user's primary wallet selection)
  const getPrimaryWalletAddress = useCallback(() => {
    // CRITICAL FIX: Use baseUser.id as the primary source since it represents the wallet
    // the user actually logged in with (effectiveWalletAddress from AuthContext).
    // This fixes the issue where embedded wallet differs from login wallet.
    if (baseUser?.id) {
      console.log('[PaymentModal] Using baseUser.id as wallet address:', baseUser.id);
      return baseUser.id;
    }
    
    // Fallback 1: Use profile wallet address (from database)
    if (profile?.wallet_address) {
      console.log('[PaymentModal] Using profile.wallet_address:', profile.wallet_address);
      return profile.wallet_address;
    }
    
    // Fallback 2: Check linkedWallets with primary index
    if (linkedWallets && linkedWallets.length > 0) {
      // Get the primary wallet index from localStorage (set by user in LoggedInUserBtn)
      // Wrap in try-catch to handle localStorage access errors (e.g., private browsing mode)
      let primaryIndex = 0;
      try {
        const savedIndex = localStorage.getItem('primaryWalletIndex');
        if (savedIndex !== null) {
          primaryIndex = parseInt(savedIndex, 10);
        }
      } catch (err) {
        console.warn('[PaymentModal] Failed to read primaryWalletIndex:', err);
        // Continue with default index 0
      }
      
      // Validate the index: must be a valid non-negative integer within array bounds
      // parseInt can return negative numbers (e.g., "-1" -> -1), NaN, or positive numbers
      if (!isNaN(primaryIndex) && primaryIndex >= 0 && primaryIndex < linkedWallets.length) {
        const address = linkedWallets[primaryIndex]?.address;
        console.log('[PaymentModal] Using linkedWallets[primaryIndex]:', address);
        return address || null;
      }
      
      // Use first wallet if index is invalid
      const address = linkedWallets[0]?.address;
      console.log('[PaymentModal] Using linkedWallets[0]:', address);
      return address || null;
    }
    
    console.warn('[PaymentModal] No wallet address found');
    return null;
  }, [baseUser?.id, profile?.wallet_address, linkedWallets]);
  
  const [loading, setLoading] = useState(false);
  const [baseLoading, setBaseLoading] = useState(false);
  const [baseAccountLoading, setBaseAccountLoading] = useState(false);
  const [baseAccountTransactionId, setBaseAccountTransactionId] = useState<string>('');
  const [oneClickLoading, setOneClickLoading] = useState(false);
  const [showInitialPayment, setShowInitialPayment] = useState(false);
  const [paymentStep, setPaymentStep] = useState<PaymentStep>('initial');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('coinbase');
  const [paymentUrl, setPaymentUrl] = useState<string>('');
  const [invoiceId, setInvoiceId] = useState<string>('');
  const [baseTransactionId, setBaseTransactionId] = useState<string>('');
  const [balanceTransactionId, setBalanceTransactionId] = useState<string>('');
  const [onchainKitTransactionId, setOnchainKitTransactionId] = useState<string>('');
  const [onchainKitChargeId, setOnchainKitChargeId] = useState<string>('');
  const [onchainKitLoading, setOnchainKitLoading] = useState(false);
  const [otherCryptoTransactionId, setOtherCryptoTransactionId] = useState<string>('');
  const [otherCryptoChargeId, setOtherCryptoChargeId] = useState<string>('');
  const [otherCryptoLoading, setOtherCryptoLoading] = useState(false);
  // Card payment state (now uses Commerce checkout flow)
  const [cardLoading, setCardLoading] = useState(false);
  // Coinbase Commerce checkout state (used for both card and crypto commerce payments)
  const [commerceLoading, setCommerceLoading] = useState(false);
  const [commerceCheckoutUrl, setCommerceCheckoutUrl] = useState<string>('');
  const [commerceTransactionId, setCommerceTransactionId] = useState<string>('');
  // Crypto selection state (for "Pay with Other Crypto" flow)
  const [selectedCrypto, setSelectedCrypto] = useState<CryptoOption | null>(null);
  const [userBalance, setUserBalance] = useState<number>(0);
  const [loadingBalance, setLoadingBalance] = useState(false);
  // Inline error message state (replaces browser alert() dialogs)
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // ISSUE 8B FIX: Enhanced error information with guidance
  const [errorInfo, setErrorInfo] = useState<PaymentErrorInfo | null>(null);
  // Track if a payment was ever attempted in this modal session
  // This prevents showing "No Entries Selected" after a successful payment
  const [paymentAttempted, setPaymentAttempted] = useState(false);
  // Store purchased ticket numbers separately so they persist after payment success
  // This prevents clearing when onPaymentSuccess resets selectedTickets
  const [purchasedTickets, setPurchasedTickets] = useState<number[]>([]);
  const { paymentData, loading:paymentLoading, paymentStatus } = usePaymentStatus(onOpen);

  // ISSUE 9B FIX: Optimistic update state - shows immediate feedback after payment
  const [showOptimisticSuccess, setShowOptimisticSuccess] = useState(false);
  // State for TopUpWalletModal
  const [showTopUpModal, setShowTopUpModal] = useState(false);

  // WALLET DIAGNOSTIC: Log wallet information for debugging
  useEffect(() => {
    if (isOpen && baseUser?.id) {
      const userWallet = linkedWallets?.[0]?.address || profile?.wallet_address;
      
      console.log('[PaymentModal] Wallet diagnostic:', {
        userId: baseUser.id,
        userWallet,
        userWalletFull: userWallet, // Show full address for comparison
        treasuryAddress,
        treasuryAddressFull: import.meta.env.VITE_TREASURY_ADDRESS, // Show full treasury address
        isBusinessWallet: userWallet?.toLowerCase() === treasuryAddress,
        linkedWalletsCount: linkedWallets?.length || 0,
        linkedWalletsDetails: linkedWallets?.map(w => ({
          address: w.address,
          type: w.type,
          walletClient: w.walletClient
        })),
        profileWallet: profile?.wallet_address,
        walletClientAvailable: !!walletClient, // Only log boolean, not the object
        localStorage_cdp_wallet: localStorage.getItem('cdp:wallet_address'),
        timestamp: new Date().toISOString()
      });

      // CRITICAL: Alert if business wallet is detected as user wallet
      if (userWallet && treasuryAddress && userWallet.toLowerCase() === treasuryAddress) {
        console.error('[PaymentModal] CRITICAL ERROR: Business wallet is set as user wallet!');
        console.error('[PaymentModal] This will cause payments to fail. User needs to sign out and reconnect with their personal wallet.');
        console.error('[PaymentModal] Treasury:', treasuryAddress);
        console.error('[PaymentModal] User wallet:', userWallet);
      }
    }
  }, [isOpen, baseUser?.id, linkedWallets, profile?.wallet_address, treasuryAddress, walletClient]);

  // ISSUE 3C FIX: Reservation expiration tracking
  // Show countdown timer for reservation expiration during checkout
  const [reservationTimeRemaining, setReservationTimeRemaining] = useState<number | null>(null);
  const [reservationExpired, setReservationExpired] = useState(false);
  const reservationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch reservation expiration time when reservationId is provided
  useEffect(() => {
    if (!reservationId || !isOpen) {
      setReservationTimeRemaining(null);
      setReservationExpired(false);
      if (reservationTimerRef.current) {
        clearInterval(reservationTimerRef.current);
        reservationTimerRef.current = null;
      }
      return;
    }

    // Fetch reservation details to get expiration time
    const fetchReservationExpiry = async () => {
      try {
        const { data: reservation } = await supabase
          .from('pending_tickets')
          .select('expires_at, status')
          .eq('id', reservationId)
          .maybeSingle();

        if (reservation?.expires_at) {
          const expiresAt = new Date(reservation.expires_at).getTime();
          const now = Date.now();
          const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));

          if (remaining <= 0 || reservation.status === 'expired') {
            setReservationExpired(true);
            setReservationTimeRemaining(0);
          } else {
            setReservationTimeRemaining(remaining);
            setReservationExpired(false);
          }
        }
      } catch (err) {
        console.error('[PaymentModal] Error fetching reservation expiry:', err);
      }
    };

    fetchReservationExpiry();

    // Start countdown timer
    reservationTimerRef.current = setInterval(() => {
      setReservationTimeRemaining((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          setReservationExpired(true);
          if (reservationTimerRef.current) {
            clearInterval(reservationTimerRef.current);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (reservationTimerRef.current) {
        clearInterval(reservationTimerRef.current);
        reservationTimerRef.current = null;
      }
    };
  }, [reservationId, isOpen]);

  // Format remaining time for display
  const formatTimeRemaining = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Check if one-click payment is available for current amount
  const canUseOneClick = hasSpendPermission && canOneClickSpend(amount);

  const urlParams = new URLSearchParams(window.location.search);
  const statusOfPayment = urlParams.get("payment") || urlParams.get("paymentStatus");
  const txId = urlParams.get("txId");
  const npId = urlParams.get("NP_id") || urlParams.get("payment_id") || urlParams.get("invoice_id") || urlParams.get("paymentId") || urlParams.get("id");

  const hasPaymentParams = !!statusOfPayment || !!npId || !!txId;

  // Track if we should reset state on modal open
  // Only reset when modal opens fresh, not when re-rendered during payment processing
  const [hasInitialized, setHasInitialized] = useState(false);

  // Load user balance - defined before useEffect that depends on it to avoid TDZ error
  const loadUserBalance = useCallback(async () => {
    if (!baseUser?.id) return;

    setLoadingBalance(true);
    try {
      const result = await getUserBalance(baseUser.id);
      if (result.success) {
        setUserBalance(result.data.usdc_balance);
      }
    } catch (error) {
      console.error('Failed to load user balance:', error);
    } finally {
      setLoadingBalance(false);
    }
  }, [baseUser?.id]);

  useEffect(() => {
    if (isOpen && !hasInitialized) {
      // Only reset state when modal first opens
      // IMPORTANT: If opened via URL params (payment redirect), don't show initial payment selection
      // This prevents the "No Entries Selected" error when returning from payment providers
      setShowInitialPayment(!hasPaymentParams);
      setPaymentStep('initial');
      setPaymentUrl('');
      setInvoiceId('');
      setBaseTransactionId('');
      setBalanceTransactionId('');
      setOnchainKitTransactionId('');
      setOnchainKitChargeId('');
      setOtherCryptoTransactionId('');
      setOtherCryptoChargeId('');
      setHasInitialized(true);
      // Load user balance when modal opens
      loadUserBalance();
    } else if (!isOpen && paymentStep !== 'base-processing' && paymentStep !== 'base-account-processing' && paymentStep !== 'balance-processing' && paymentStep !== 'onchainkit-processing' && paymentStep !== 'othercrypto-processing') {
      // Only reset initialization flag when modal closes AND no payment is in progress
      // This prevents state reset if modal re-renders during payment processing
      setHasInitialized(false);
    }
  }, [isOpen, hasPaymentParams, hasInitialized, paymentStep, loadUserBalance]);

  // Poll for payment status when in checkout step
  useEffect(() => {
    if (paymentStep === 'checkout' && invoiceId) {
      const pollInterval = setInterval(async () => {
        try {
          const { data } = await supabase
            .from('user_transactions')
            .select('status')
            .eq('tx_id', invoiceId)
            .single();

          if (data?.status && isSuccessStatus(data.status)) {
            clearInterval(pollInterval);
            setPaymentStep('success');
          } else if (data?.status && isFailureStatus(data.status)) {
            clearInterval(pollInterval);
            setPaymentStep('error');
          }
        } catch (err) {
          // Continue polling
        }
      }, 5000);

      return () => clearInterval(pollInterval);
    }
  }, [paymentStep, invoiceId]);

  const [balanceLoading, setBalanceLoading] = useState(false);

  // Handle Balance payment
  const handleBalancePayment = async () => {
    setErrorMessage(null);
    if (!baseUser?.id) {
      setErrorMessage("Please log in to continue with your purchase.");
      return;
    }

    // CRITICAL FIX: Block payment if reservation has expired
    if (reservationExpired) {
      setErrorMessage("Your ticket reservation has expired. Please close this dialog and select your tickets again.");
      return;
    }

    // CRITICAL FIX: Ensure userBalance is a valid number before comparison
    const safeBalance = typeof userBalance === 'number' && Number.isFinite(userBalance) ? userBalance : 0;
    if (safeBalance < amount) {
      setErrorMessage(`Insufficient balance. You need $${amount.toFixed(2)} but only have $${safeBalance.toFixed(2)} available.`);
      return;
    }

    setBalanceLoading(true);
    setPaymentMethod('balance');
    setPaymentStep('balance-processing');
    setShowInitialPayment(false);
    setPaymentAttempted(true);
    // Store tickets before payment in case they get cleared
    setPurchasedTickets([...selectedTickets]);

    try {
      // PRIMARY: Try the GODLIKE RPC first - most reliable, bypasses Edge Functions
      console.log('[PaymentModal] Attempting balance payment via execute_balance_payment RPC');
      const rpcResult = await executeBalancePaymentRPC({
        userId: toCanonicalUserId(baseUser.id),
        competitionId,
        amount,
        ticketCount,
        selectedTickets,
        reservationId
      });

      if (rpcResult.success) {
        // RPC succeeded!
        console.log('[PaymentModal] Balance payment succeeded via RPC:', rpcResult);
        setShowOptimisticSuccess(true);
        setBalanceTransactionId(rpcResult.ticketsCreated?.toString() || rpcResult.transactionId || 'success');
        setPaymentStep('success');

        if (rpcResult.balanceAfterPurchase !== undefined && rpcResult.balanceAfterPurchase !== null) {
          setUserBalance(rpcResult.balanceAfterPurchase);
          console.log('[PaymentModal] Balance updated from RPC response:', rpcResult.balanceAfterPurchase);
        }

        await refreshUserData();
        loadUserBalance().catch(err => console.error('[PaymentModal] Background balance refresh failed:', err));

        if (rpcResult.balanceAfterPurchase !== undefined && rpcResult.balanceAfterPurchase !== null) {
          window.dispatchEvent(new CustomEvent('balance-updated', {
            detail: { newBalance: rpcResult.balanceAfterPurchase }
          }));
        }

        if (onPaymentSuccess) {
          onPaymentSuccess();
        }
        setShowOptimisticSuccess(false);
        setBalanceLoading(false);
        return;
      }

      // RPC failed - log and try fallback to Edge Function
      console.warn('[PaymentModal] RPC failed, trying Edge Function fallback:', rpcResult.error);

      // FALLBACK: Try the Edge Function as backup
      const result = await purchaseTicketsWithBalance({
        userId: toCanonicalUserId(baseUser.id),
        competitionId,
        numberOfTickets: ticketCount,
        ticketPrice,
        selectedTickets,
        reservationId
      });

      if (result.success) {
        // ISSUE 9B FIX: Show optimistic success immediately
        setShowOptimisticSuccess(true);
        setBalanceTransactionId(result.ticketsCreated || 'success');
        setPaymentStep('success');

        // CRITICAL FIX: Use the balance returned from the server immediately
        // This ensures the UI shows the correct balance right away without waiting for a DB query
        // The server has already debited the balance and returns the new value
        if (result.balanceAfterPurchase !== undefined && result.balanceAfterPurchase !== null) {
          setUserBalance(result.balanceAfterPurchase);
          console.log('[PaymentModal] Balance updated from server response:', result.balanceAfterPurchase);
        }

        // Refresh user data to show updated entries
        await refreshUserData();
        // Also reload balance from DB as a backup verification (non-blocking)
        loadUserBalance().catch(err => console.error('[PaymentModal] Background balance refresh failed:', err));
        // Dispatch event to notify other components to refresh balance
        // CRITICAL: Pass the new balance from server response to avoid stale RPC data
        // The database write may not be immediately visible to read queries due to replication lag
        // Only dispatch if we have valid balance data
        if (result.balanceAfterPurchase !== undefined && result.balanceAfterPurchase !== null) {
          window.dispatchEvent(new CustomEvent('balance-updated', {
            detail: { newBalance: result.balanceAfterPurchase }
          }));
        }
        // Call success callback to refresh entries display
        if (onPaymentSuccess) {
          onPaymentSuccess();
        }
        // Clear optimistic state after refresh completes
        setShowOptimisticSuccess(false);
      } else {
        // ISSUE 8B FIX: Use enhanced error handler with guidance
        setPaymentError(null, result.error || "Payment failed. Please try again.");
      }
    } catch (error) {
      console.error('Balance payment error:', error);
      // ISSUE 8B FIX: Use enhanced error handler with guidance
      setPaymentError(error, "Payment failed. Please try again or contact support.");
    } finally {
      setBalanceLoading(false);
    }
  };

  // Handle Base Account Payment
  const handleBaseAccountPayment = async () => {
    setErrorMessage(null);
    if (!baseUser?.id) {
      setErrorMessage("Please log in to continue with your purchase.");
      return;
    }

    if (reservationExpired) {
      setErrorMessage("Your ticket reservation has expired. Please close this dialog and select your tickets again.");
      return;
    }

    const totalAmount = ticketCount * ticketPrice;

    if (!totalAmount || !Number.isFinite(totalAmount) || totalAmount <= 0) {
      console.error('Base Account payment validation failed:', { ticketCount, ticketPrice, totalAmount });
      setErrorMessage("Invalid payment amount. Please select tickets first.");
      return;
    }

    const walletAddress = getPrimaryWalletAddress();

    setBaseAccountLoading(true);
    setPaymentMethod('base-account');
    setPaymentStep('base-account-processing');
    setShowInitialPayment(false);
    setPurchasedTickets([...selectedTickets]);
    setPaymentAttempted(true);

    try {
      console.log('[PaymentModal] Starting Base Account payment flow');

      const result = await BaseAccountPaymentService.purchaseTickets({
        userId: baseUser?.id,
        competitionId,
        ticketCount,
        ticketPrice,
        selectedTickets,
        walletAddress: walletAddress || undefined,
        reservationId,
      });

      console.log('[PaymentModal] Base Account payment result:', result);

      if (result.success) {
        setShowOptimisticSuccess(true);
        setBaseAccountTransactionId(result.transactionId);
        setPaymentStep('success');
        await refreshUserData();
        if (onPaymentSuccess) {
          onPaymentSuccess();
        }
        setShowOptimisticSuccess(false);
      } else {
        setPaymentError(result.transactionHash || null, result.error || "Base Account payment failed. Please try again.");
      }
    } catch (error) {
      console.error('Base Account payment error:', error);
      setPaymentError(null, error instanceof Error ? error.message : "Base Account payment failed. Please try again.");
    } finally {
      setBaseAccountLoading(false);
    }
  };

  // Handle One-Click Payment using Spend Permissions
  // This enables true one-click payments without requiring a signature for each transaction
  // ISSUE 3B FIX: For CDP-authenticated users without external wallet, use spend permission flow
  const handleOneClickPayment = async () => {
    setErrorMessage(null);
    if (!baseUser?.id) {
      setErrorMessage("Please log in to continue with your purchase.");
      return;
    }

    // CRITICAL FIX: Block payment if reservation has expired
    if (reservationExpired) {
      setErrorMessage("Your ticket reservation has expired. Please close this dialog and select your tickets again.");
      return;
    }

    // Validate profile exists before accessing its properties
    if (!profile) {
      setErrorMessage("Profile not loaded. Please refresh the page and try again.");
      return;
    }

    const walletAddress = getPrimaryWalletAddress();
    if (!walletAddress) {
      setErrorMessage("Please connect a wallet to use one-click payments.");
      return;
    }

    const totalAmount = ticketCount * ticketPrice;

    if (!totalAmount || !Number.isFinite(totalAmount) || totalAmount <= 0) {
      console.error('One-click payment validation failed:', { ticketCount, ticketPrice, totalAmount });
      setErrorMessage("Invalid payment amount. Please select tickets first.");
      return;
    }

    // If no spend permission exists, prompt to enable one-click payments
    if (!hasSpendPermission) {
      setOneClickLoading(true);
      try {
        const success = await enableOneClickPayments({
          allowanceUSD: 500, // $500 monthly limit
          periodInDays: 30,
          validityDays: 365,
        });
        if (!success) {
          setErrorMessage("One-click payments setup was cancelled. Please try the regular payment option.");
          return;
        }
        // Continue with payment after permission is granted
      } catch (err) {
        console.error('Error enabling one-click payments:', err);
        setErrorMessage("Failed to enable one-click payments. Please try the regular payment option.");
        return;
      } finally {
        setOneClickLoading(false);
      }
    }

    // Check if current amount is within spend limits
    if (!canOneClickSpend(totalAmount)) {
      setErrorMessage(`This purchase exceeds your one-click payment limit. Remaining: $${spendLimitInfo?.remaining ? Number(spendLimitInfo.remaining) / 1_000_000 : 0}. Please use the regular payment option.`);
      return;
    }

    setOneClickLoading(true);
    setPaymentMethod('base');
    setPaymentStep('base-processing');
    setShowInitialPayment(false);
    setPurchasedTickets([...selectedTickets]);

    try {
      // Get wallet provider from Base sub-account or wagmi
      // Priority: 1) wagmi walletClient (if available), 2) Base sub-account provider
      let walletProvider = walletClient;

      // If wagmi wallet client is not available (e.g., for CDP-authenticated users),
      // try to get the provider from the Base sub-account
      if (!walletProvider && subAccount) {
        try {
          // The sub-account's parent Base account can provide an Ethereum provider
          // This allows CDP wallet users to sign transactions
          const baseAccountWallet = linkedWallets?.find(
            (w: any) => w.walletClient === 'base_account' || w.isBaseAccount
          );
          if (baseAccountWallet && typeof baseAccountWallet.getEthereumProvider === 'function') {
            walletProvider = await baseAccountWallet.getEthereumProvider();
            console.log('[PaymentModal] Using Base account provider for one-click payment');
          }
        } catch (providerErr) {
          console.warn('[PaymentModal] Failed to get Base account provider:', providerErr);
        }
      }

      // ISSUE 3B FIX: For CDP users without wallet provider, use reservation-based confirmation
      // The spend permission allows server-side fund pulling via treasury
      if (!walletProvider) {
        console.log('[PaymentModal] No wallet provider available, using spend permission flow for CDP user');

        // Use unified confirmation to allocate tickets
        // For CDP users, the server handles the spend permission verification
        const confirmResult = await confirmTicketsUnified({
          reservationId: reservationId,
          userId: baseUser?.id,
          competitionId,
          transactionHash: `spend_permission_${Date.now()}_${baseUser.id.substring(0, 8)}`,
          paymentProvider: 'spend_permission',
          walletAddress: walletAddress,
          selectedTickets,
          ticketCount,
        });

        console.log('[PaymentModal] Spend permission ticket confirmation result:', confirmResult);

        if (confirmResult.success) {
          // ISSUE 9B FIX: Show optimistic success immediately
          setShowOptimisticSuccess(true);
          setBaseTransactionId(reservationId || 'success');
          setPaymentStep('success');
          await refreshUserData();
          if (onPaymentSuccess) {
            onPaymentSuccess();
          }
          setShowOptimisticSuccess(false);
        } else {
          // ISSUE 8B FIX: Use enhanced error handler
          setPaymentError(null, confirmResult.error || "Payment failed. Please try again.");
        }
        return;
      }

      // Use the spend permission for the payment with available wallet provider
      const result = await BasePaymentService.purchaseTickets({
        userId: baseUser?.id,
        competitionId,
        ticketCount,
        ticketPrice,
        selectedTickets,
        walletAddress,
        reservationId,
        walletProvider: walletProvider, // Pass available wallet provider
        userEmail: profile?.email || undefined,
      });

      if (result.success) {
        // ISSUE 9B FIX: Show optimistic success immediately
        setShowOptimisticSuccess(true);
        setBaseTransactionId(result.transactionId);
        setPaymentStep('success');
        await refreshUserData();
        if (onPaymentSuccess) {
          onPaymentSuccess();
        }
        setShowOptimisticSuccess(false);
      } else {
        // ISSUE 8B FIX: Use enhanced error handler
        setPaymentError(null, result.error || "Payment failed. Please try again.");
      }
    } catch (error) {
      console.error("One-click payment error:", error);
      // ISSUE 8B FIX: Use enhanced error handler with guidance
      setPaymentError(error, "Payment failed. Please try again or contact support.");
    } finally {
      setOneClickLoading(false);
    }
  };

  // Handle Base USDC payment
  const handleBasePayment = async () => {
    setErrorMessage(null);
    if (!baseUser?.id) {
      setErrorMessage("Please log in to continue with your purchase.");
      return;
    }

    // CRITICAL FIX: Block payment if reservation has expired
    if (reservationExpired) {
      setErrorMessage("Your ticket reservation has expired. Please close this dialog and select your tickets again.");
      return;
    }

    // Validate profile exists before accessing its properties
    if (!profile) {
      setErrorMessage("Profile not loaded. Please refresh the page and try again.");
      return;
    }

    const walletAddress = getPrimaryWalletAddress();
    if (!walletAddress) {
      setErrorMessage("Please connect a wallet to pay with Base USDC.");
      return;
    }

    // CRITICAL FIX: Validate that the user's wallet is NOT the business wallet
    // The treasury address should NEVER be used as the sender wallet
    if (treasuryAddress && walletAddress.toLowerCase() === treasuryAddress) {
      console.error('[PaymentModal] CRITICAL: Business wallet detected as user wallet', {
        userWallet: walletAddress,
        treasury: treasuryAddress
      });
      setErrorMessage("Configuration error: Business wallet detected. Please sign out and sign in with your personal wallet.");
      return;
    }

    const totalAmount = ticketCount * ticketPrice;

    if (!totalAmount || !Number.isFinite(totalAmount) || totalAmount <= 0) {
      console.error('Base payment validation failed:', { ticketCount, ticketPrice, totalAmount });
      setErrorMessage("Invalid payment amount. Please select tickets first.");
      return;
    }

    // Validate wallet client is available for signing transactions
    if (!walletClient) {
      console.error('[PaymentModal] No wallet client available for Base payment');
      setErrorMessage("Wallet not connected. Please reconnect your wallet or use the 'Pay with any wallet' option.");
      return;
    }

    setBaseLoading(true);
    setPaymentMethod('base');
    setPaymentStep('base-processing');
    setShowInitialPayment(false);
    // Store tickets before payment in case they get cleared
    setPurchasedTickets([...selectedTickets]);

    try {
      // Use wagmi's wallet client as the provider for signing transactions
      // The walletClient provides an EIP-1193 compatible 'request' method
      console.log('[PaymentModal] Using wagmi wallet client for Base payment:', walletAddress);

      // Purchase tickets using Base USDC with wallet client as provider
      const result = await BasePaymentService.purchaseTickets({
        userId: baseUser?.id,
        competitionId,
        ticketCount,
        ticketPrice,
        selectedTickets,
        walletAddress,
        reservationId,
        walletProvider: walletClient, // Pass wagmi wallet client as the provider
        userEmail: profile?.email || undefined,
      });

      if (result.success) {
        // ISSUE 9B FIX: Show optimistic success immediately
        setShowOptimisticSuccess(true);
        setBaseTransactionId(result.transactionId);
        setPaymentStep('success');
        // Refresh user data to show updated entries
        await refreshUserData();
        // Call success callback to refresh entries display
        if (onPaymentSuccess) {
          onPaymentSuccess();
        }
        setShowOptimisticSuccess(false);
      } else {
        // Check if this is a payment-succeeded-but-confirmation-failed case
        if (result.paymentSucceeded) {
          // Special case: Payment went through but ticket allocation failed
          // Show a specific error message with transaction ID for support
          setPaymentError(
            null,
            `Your payment of $${result.amount.toFixed(2)} was received successfully, but we encountered an issue allocating your tickets. ` +
            `Transaction ID: ${result.transactionId}. ` +
            `Please contact support with this transaction ID, and we'll manually allocate your tickets. ` +
            `Your funds are safe and have been received.`
          );
          setBaseTransactionId(result.transactionId);
          // Still refresh data in case tickets were partially allocated
          await refreshUserData();
        } else {
          // Normal payment failure
          setPaymentError(null, result.error || "Payment failed. Please try again.");
        }
      }
    } catch (error) {
      console.error("Base payment error:", error);
      // ISSUE 8B FIX: Use enhanced error handler with guidance
      setPaymentError(error, "Payment failed. Please try again or contact support.");
    } finally {
      setBaseLoading(false);
    }
  };

  // OnchainKit Checkout chargeHandler - creates a charge and returns the chargeId
  const handleOnchainKitChargeCreate = useCallback(async (): Promise<string> => {
    if (!baseUser?.id) {
      throw new Error('Please login first');
    }

    const totalAmount = ticketCount * ticketPrice;
    if (!totalAmount || !Number.isFinite(totalAmount) || totalAmount <= 0) {
      console.error('OnchainKit invalid amount:', { ticketCount, ticketPrice, totalAmount });
      throw new Error(`Invalid amount: ticketCount=${ticketCount}, ticketPrice=${ticketPrice}`);
    }

    try {
      const result = await OnchainKitCheckoutService.createEntryCharge(
        baseUser.id,
        competitionId,
        ticketPrice,
        ticketCount,
        selectedTickets,
        reservationId,
      );

      // Link reservation if exists
      if (reservationId && result.transactionId) {
        await OnchainKitCheckoutService.linkReservation(reservationId, result.transactionId);
      }

      // Store transaction ID for status tracking
      setOnchainKitTransactionId(result.transactionId);
      setOnchainKitChargeId(result.chargeId);

      return result.chargeId;
    } catch (error) {
      console.error('OnchainKit charge creation error:', error);
      throw error;
    }
  }, [baseUser?.id, competitionId, ticketPrice, ticketCount, selectedTickets, reservationId]);

  // OnchainKit Checkout status handler
  // CRITICAL FIX: Do NOT create entries directly from frontend callback
  // The commerce-webhook will handle entry creation after verifying payment on the blockchain
  // This prevents creating entries without actual payment confirmation
  const handleOnchainKitStatus = useCallback(async (status: LifecycleStatus) => {
    console.log('OnchainKit checkout status:', status);

    try {
      if (status.statusName === 'success') {
        // Payment submitted successfully - but NOT confirmed yet
        // The webhook will create the entry after payment is verified on-chain
        console.log('[PaymentModal] OnchainKit payment submitted, waiting for webhook confirmation');

        // Update transaction status to indicate payment is processing
        if (onchainKitTransactionId) {
          try {
            await OnchainKitCheckoutService.updateTransactionOnComplete(
              onchainKitTransactionId,
              status.statusData?.chargeId || '',
              'pending' // Mark as pending, NOT success - webhook will confirm
            );
          } catch (updateErr) {
            console.error('[PaymentModal] Failed to update transaction status:', updateErr);
            // Continue anyway - the webhook will still process the payment
          }
        }

        // REMOVED: Do NOT call confirmTicketsUnified here
        // The commerce-webhook will create entries after verifying payment
        // This prevents creating entries without actual verified payment
        // Previous code was creating entries based on frontend callback which could be spoofed

        // Show success state but with a note about confirmation
        // ISSUE 9B FIX: Show optimistic success immediately
        setShowOptimisticSuccess(true);
        setPaymentStep('success');

        // Refresh user data - entries will appear once webhook processes
        try {
          await refreshUserData();
        } catch (refreshErr) {
          console.error('[PaymentModal] Failed to refresh user data:', refreshErr);
          // Non-fatal - user can refresh manually
        }

        // Call success callback
        if (onPaymentSuccess) {
          try {
            onPaymentSuccess();
          } catch (callbackErr) {
            console.error('[PaymentModal] onPaymentSuccess callback error:', callbackErr);
          }
        }
        setShowOptimisticSuccess(false);
      } else if (status.statusName === 'error') {
        console.error('OnchainKit payment error:', status.statusData);
        // Check for API key / RPC errors
        const errorMessage = String(status.statusData?.error || status.statusData?.message || '');
        if (errorMessage.includes('401') || errorMessage.includes('unauthorized') || errorMessage.includes('invalid key')) {
          console.error('OnchainKit RPC authentication failed - CDP API key may be invalid');
        }
        // Use setPaymentError to provide proper error context and guidance
        setPaymentError(
          { message: errorMessage },
          errorMessage || 'Payment could not be completed. Please try again.'
        );
      }
    } catch (err) {
      console.error('[PaymentModal] Unhandled error in OnchainKit status handler:', err);
      // Don't change step to error here since the payment may have succeeded
      // but just the post-payment processing failed
    }
  }, [onchainKitTransactionId, refreshUserData, onPaymentSuccess]);

  // Handle OnchainKit payment button click - shows the checkout UI
  const handleOnchainKitPayment = () => {
    setErrorMessage(null);
    if (!baseUser?.id) {
      setErrorMessage("Please log in to continue with your purchase.");
      return;
    }

    // CRITICAL FIX: Block payment if reservation has expired
    if (reservationExpired) {
      setErrorMessage("Your ticket reservation has expired. Please close this dialog and select your tickets again.");
      return;
    }

    // CRITICAL FIX: Validate that the user's wallet is connected, not the business wallet
    // The treasury address should NEVER be used as the sender wallet
    const userWalletAddress = (linkedWallets?.[0]?.address || profile?.wallet_address)?.toLowerCase();
    
    // Check if wallet is connected
    if (!userWalletAddress) {
      setErrorMessage("Please connect your wallet to continue. Reconnect if needed.");
      return;
    }

    // Check if the connected wallet is the treasury (business) wallet - this should never happen
    if (treasuryAddress && userWalletAddress === treasuryAddress) {
      console.error('[PaymentModal] CRITICAL: Business wallet detected as user wallet', {
        userWallet: userWalletAddress,
        treasury: treasuryAddress
      });
      setErrorMessage("Configuration error: Business wallet detected. Please sign out and sign in with your personal wallet.");
      return;
    }

    const totalAmount = ticketCount * ticketPrice;
    if (!totalAmount || !Number.isFinite(totalAmount) || totalAmount <= 0) {
      console.error('OnchainKit payment validation failed:', { ticketCount, ticketPrice, totalAmount });
      setErrorMessage("Invalid payment amount. Please select tickets first.");
      return;
    }

    setOnchainKitLoading(true);
    setPaymentMethod('onchainkit');
    setPaymentStep('onchainkit-processing');
    setShowInitialPayment(false);
    // Store tickets before payment in case they get cleared
    setPurchasedTickets([...selectedTickets]);
  };

  // OnchainKit Checkout chargeHandler for Other Crypto - creates a charge and returns the chargeId
  const handleOtherCryptoChargeCreate = useCallback(async (): Promise<string> => {
    if (!baseUser?.id) {
      throw new Error('Please login first');
    }

    const totalAmount = ticketCount * ticketPrice;
    if (!totalAmount || !Number.isFinite(totalAmount) || totalAmount <= 0) {
      console.error('Other Crypto invalid amount:', { ticketCount, ticketPrice, totalAmount });
      throw new Error(`Invalid amount: ticketCount=${ticketCount}, ticketPrice=${ticketPrice}`);
    }

    try {
      // Use the same OnchainKitCheckoutService but flag as other crypto
      const result = await OnchainKitCheckoutService.createEntryCharge(
        baseUser.id,
        competitionId,
        ticketPrice,
        ticketCount,
        selectedTickets,
        reservationId,
      );

      // Link reservation if exists
      if (reservationId && result.transactionId) {
        await OnchainKitCheckoutService.linkReservation(reservationId, result.transactionId);
      }

      // Store transaction ID for status tracking
      setOtherCryptoTransactionId(result.transactionId);
      setOtherCryptoChargeId(result.chargeId);

      return result.chargeId;
    } catch (error) {
      console.error('Other Crypto charge creation error:', error);
      throw error;
    }
  }, [baseUser?.id, competitionId, ticketPrice, ticketCount, selectedTickets, reservationId]);

  // OnchainKit Checkout status handler for Other Crypto
  // CRITICAL FIX: Do NOT create entries directly from frontend callback
  // The commerce-webhook will handle entry creation after verifying payment on the blockchain
  // This prevents creating entries without actual payment confirmation
  const handleOtherCryptoStatus = useCallback(async (status: LifecycleStatus) => {
    console.log('Other Crypto checkout status:', status);

    try {
      if (status.statusName === 'success') {
        // Payment submitted successfully - but NOT confirmed yet
        // The webhook will create the entry after payment is verified on-chain
        console.log('[PaymentModal] Other Crypto payment submitted, waiting for webhook confirmation');

        // Update transaction status to indicate payment is processing
        if (otherCryptoTransactionId) {
          try {
            await OnchainKitCheckoutService.updateTransactionOnComplete(
              otherCryptoTransactionId,
              status.statusData?.chargeId || '',
              'pending' // Mark as pending, NOT success - webhook will confirm
            );
          } catch (updateErr) {
            console.error('[PaymentModal] Failed to update transaction status:', updateErr);
            // Continue anyway - the webhook will still process the payment
          }
        }

        // REMOVED: Do NOT call confirmTicketsUnified here
        // The commerce-webhook will create entries after verifying payment
        // This prevents creating entries without actual verified payment
        // Previous code was creating entries based on frontend callback which could be spoofed

        // Show success state but with a note about confirmation
        setPaymentStep('success');

        // Refresh user data - entries will appear once webhook processes
        try {
          await refreshUserData();
        } catch (refreshErr) {
          console.error('[PaymentModal] Failed to refresh user data:', refreshErr);
          // Non-fatal - user can refresh manually
        }

        // Call success callback
        if (onPaymentSuccess) {
          try {
            onPaymentSuccess();
          } catch (callbackErr) {
            console.error('[PaymentModal] onPaymentSuccess callback error:', callbackErr);
          }
        }
      } else if (status.statusName === 'error') {
        console.error('Other Crypto payment error:', status.statusData);
        const errorMessage = String(status.statusData?.error || status.statusData?.message || '');
        // Use setPaymentError to provide proper error context and guidance
        setPaymentError(
          { message: errorMessage },
          errorMessage || 'Payment could not be completed. Please try again.'
        );
      }
    } catch (err) {
      console.error('[PaymentModal] Unhandled error in Other Crypto status handler:', err);
      // Don't change step to error here since the payment may have succeeded
      // but just the post-payment processing failed
    }
  }, [otherCryptoTransactionId, refreshUserData, onPaymentSuccess]);

  // Handle Other Crypto payment button click - shows the crypto selection step first
  const handleOtherCryptoPayment = () => {
    setErrorMessage(null);
    if (!baseUser?.id) {
      setErrorMessage("Please log in to continue with your purchase.");
      return;
    }

    // CRITICAL FIX: Block payment if reservation has expired
    if (reservationExpired) {
      setErrorMessage("Your ticket reservation has expired. Please close this dialog and select your tickets again.");
      return;
    }

    const totalAmount = ticketCount * ticketPrice;
    if (!totalAmount || !Number.isFinite(totalAmount) || totalAmount <= 0) {
      console.error('Other Crypto payment validation failed:', { ticketCount, ticketPrice, totalAmount });
      setErrorMessage("Invalid payment amount. Please select tickets first.");
      return;
    }

    // Show crypto selection step first (NEW: differentiated flow)
    setPaymentMethod('othercrypto');
    setPaymentStep('crypto-selection');
    setShowInitialPayment(false);
    setSelectedCrypto(null);
  };

  // Handle crypto selection - proceed to OnchainKit checkout after selecting a crypto
  const handleCryptoSelect = (cryptoId: CryptoOption) => {
    setSelectedCrypto(cryptoId);
    setOtherCryptoLoading(true);
    setPaymentStep('othercrypto-processing');
    // Store tickets before payment in case they get cleared
    setPurchasedTickets([...selectedTickets]);
  };

  // Handle Card Payment - redirects to Coinbase Commerce checkout
  // Uses the same flow as Commerce Payment since Coinbase Commerce supports card payments
  // This ensures money goes TO THE BUSINESS (not to user's wallet like Onramp does)
  const handleCardPayment = async () => {
    setErrorMessage(null);
    if (!baseUser?.id) {
      setErrorMessage("Please log in to continue with your purchase.");
      return;
    }

    // CRITICAL FIX: Block payment if reservation has expired
    if (reservationExpired) {
      setErrorMessage("Your ticket reservation has expired. Please close this dialog and select your tickets again.");
      return;
    }

    const totalAmount = ticketCount * ticketPrice;
    if (!totalAmount || !Number.isFinite(totalAmount) || totalAmount <= 0) {
      console.error('Card payment validation failed:', { ticketCount, ticketPrice, totalAmount });
      setErrorMessage("Invalid payment amount. Please select tickets first.");
      return;
    }

    setCardLoading(true);
    setPaymentMethod('card');
    setPaymentStep('commerce-checkout');
    setShowInitialPayment(false);
    setPurchasedTickets([...selectedTickets]);

    try {
      // Create entry purchase via Coinbase Commerce
      // Uses pre-configured static checkout URLs (not dynamic charge creation)
      // Example: 77 tickets at 10¢ each uses the "10 cent ticket" URL
      // Coinbase Commerce checkout page will handle the quantity (77 items)
      // This ensures the payment goes to the business and tickets are credited correctly
      const result = await CoinbaseCommerceService.createEntryPurchase(
        baseUser.id,
        competitionId,
        ticketPrice,
        ticketCount,
        selectedTickets,
        reservationId
      );

      // Validate that we got a checkout URL
      if (!result.checkoutUrl) {
        console.error('No checkout URL returned from createEntryPurchase');
        setPaymentError(null, "Failed to create checkout. Please try again.");
        return;
      }

      // Store the transaction details - reuse commerce state for UI consistency
      setCommerceCheckoutUrl(result.checkoutUrl);
      setCommerceTransactionId(result.transactionId);

      // Ticket confirmation happens via commerce-webhook after payment is confirmed

    } catch (error) {
      console.error('Card payment error:', error);
      setPaymentError(error, "Failed to create checkout. Please try another payment method.");
    } finally {
      setCardLoading(false);
    }
  };

  // Handle Coinbase Commerce Checkout - Crypto payments via hosted checkout page
  // This provides an alternative to in-app crypto payments with a full checkout experience
  const handleCommercePayment = async () => {
    setErrorMessage(null);
    if (!baseUser?.id) {
      setErrorMessage("Please log in to continue with your purchase.");
      return;
    }

    // CRITICAL FIX: Block payment if reservation has expired
    if (reservationExpired) {
      setErrorMessage("Your ticket reservation has expired. Please close this dialog and select your tickets again.");
      return;
    }

    const totalAmount = ticketCount * ticketPrice;
    if (!totalAmount || !Number.isFinite(totalAmount) || totalAmount <= 0) {
      console.error('Commerce payment validation failed:', { ticketCount, ticketPrice, totalAmount });
      setErrorMessage("Invalid payment amount. Please select tickets first.");
      return;
    }

    setCommerceLoading(true);
    setPaymentMethod('commerce');
    setPaymentStep('commerce-checkout');
    setShowInitialPayment(false);
    setPurchasedTickets([...selectedTickets]);

    try {
      // Create entry purchase via Coinbase Commerce
      const result = await CoinbaseCommerceService.createEntryPurchase(
        baseUser.id,
        competitionId,
        ticketPrice,
        ticketCount,
        selectedTickets,
        reservationId
      );

      // Validate that we got a checkout URL
      if (!result.checkoutUrl) {
        console.error('No checkout URL returned from createEntryPurchase');
        setPaymentError(null, "Failed to create checkout. Please try again.");
        return;
      }

      // Store the transaction details
      setCommerceCheckoutUrl(result.checkoutUrl);
      setCommerceTransactionId(result.transactionId);

      // Ticket confirmation happens via commerce-webhook after payment is confirmed

    } catch (error) {
      console.error('Commerce payment error:', error);
      setPaymentError(error, "Failed to create checkout. Please try another payment method.");
    } finally {
      setCommerceLoading(false);
    }
  };

  const modalWidth = paymentStep === 'checkout' || paymentStep === 'base-processing' || paymentStep === 'base-account-processing' || paymentStep === 'onchainkit-processing' || paymentStep === 'crypto-selection' || paymentStep === 'othercrypto-processing' || paymentStep === 'commerce-checkout' ? 'max-w-2xl' : (hasPaymentParams ? 'max-w-xl' : 'max-w-2xl');

  const handleReturn = () => {
    if (hasPaymentParams) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    setShowInitialPayment(true);
    setPaymentStep('initial');
    setPaymentUrl('');
    setInvoiceId('');
    setBaseTransactionId('');
    setBalanceTransactionId('');
    setOnchainKitTransactionId('');
    setOnchainKitChargeId('');
    setOnchainKitLoading(false);
    setOtherCryptoTransactionId('');
    setOtherCryptoChargeId('');
    setOtherCryptoLoading(false);
    // Reset crypto selection state
    setSelectedCrypto(null);
    // Reset card payment state
    setCardLoading(false);
    // Reset commerce checkout state (used for both card and crypto commerce payments)
    setCommerceLoading(false);
    setCommerceCheckoutUrl('');
    setCommerceTransactionId('');
    setPaymentMethod('coinbase');
    setPurchasedTickets([]);
    setPaymentAttempted(false);
    setErrorMessage(null);
    // ISSUE 8B FIX: Clear enhanced error info on return
    setErrorInfo(null);
    // ISSUE 9B FIX: Clear optimistic success state
    setShowOptimisticSuccess(false);
  };

  // ISSUE 8B FIX: Helper to set payment error with enhanced guidance
  const setPaymentError = useCallback((error: unknown, fallbackMessage: string) => {
    const info = getPaymentErrorInfo(error, fallbackMessage);
    setErrorMessage(info.message);
    setErrorInfo(info);
    setPaymentStep('error');
  }, []);

  const handleCloseModal = () => {
    onClose();
    handleReturn();
  };

  const handleViewEntries = () => {
    onClose();
    handleReturn();
    navigate('/dashboard/entries');
  };

  if(paymentLoading) return null;

  return (
    <div className={`fixed inset-0 bg-black/70 flex justify-center items-center z-50 p-4 ${isOpen ? 'block' : 'hidden'}`}>
      <div className={`bg-[#1A1A1A] relative w-full border-2 border-white rounded-xl max-h-[90vh] overflow-y-auto ${modalWidth}`}>
        <div className="sticky top-0 bg-[#1A1A1A] pt-4 pb-2 z-10">
          <img src={footerLogo} alt="prize-io" className="mx-auto w-24 sm:w-32 md:w-auto" />
        </div>
        <button
          onClick={handleCloseModal}
          className="absolute right-2 top-2 sm:right-4 sm:top-4 cursor-pointer bg-white rounded-full p-1 z-20 hover:bg-gray-100 transition-colors"
          aria-label="Close payment modal"
          type="button"
        >
          <CircleX color="black" size={20} className="sm:w-6 sm:h-6"/>
        </button>
        
        <div className="px-4 sm:px-6 md:px-8 pb-4 sm:pb-6">
          <h1 className="sequel-95 uppercase text-white text-lg sm:text-xl md:text-2xl mb-3 sm:mb-4 text-center">
            {paymentStep === 'checkout' ? 'Complete Crypto Payment' :
             paymentStep === 'base-processing' ? 'Processing Base Payment' :
             paymentStep === 'base-account-processing' ? 'Processing Base Payment' :
             paymentStep === 'balance-processing' ? 'Processing Balance Payment' :
             paymentStep === 'onchainkit-processing' ? 'Complete Wallet Payment' :
             paymentStep === 'crypto-selection' ? 'Select Cryptocurrency' :
             paymentStep === 'othercrypto-processing' ? 'Complete Crypto Payment' :
             paymentStep === 'commerce-checkout' ? 'Complete Payment' :
             paymentStep === 'success' ? (textOverrides?.successMessage || 'Payment Successful') :
             hasPaymentParams ? 'Payment Status' : (textOverrides?.modalTitle || 'Complete Payment')}
          </h1>
          <div className="h-[2px] w-full bg-white mb-3 sm:mb-4"></div>

          {/* Initial payment selection */}
          {showInitialPayment && paymentStep === 'initial' && ticketCount > 0 && (
            <div className="space-y-4">
              {/* Premium Order Summary Card with integrated timer */}
              <div className="relative overflow-hidden rounded-xl bg-gray-900 border border-white/10 p-4">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#DDE404] via-[#0052FF] to-[#EF008F]"></div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-[#DDE404]/20 flex items-center justify-center">
                      <Sparkles className="text-[#DDE404]" size={18} />
                    </div>
                    <div>
                      <p className="text-white/60 sequel-45 text-xs">Your Entries</p>
                      <p className="text-white sequel-75 text-lg">{ticketCount} <span className="text-sm text-white/60">{ticketCount > 1 ? 'tickets' : 'ticket'}</span></p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-white/60 sequel-45 text-xs">{textOverrides?.totalLabel || 'Total'}</p>
                    <p className="text-[#DDE404] sequel-95 text-xl">${amount.toFixed(2)}</p>
                  </div>
                </div>
                {/* Reservation timer integrated into summary card */}
                {reservationId && reservationTimeRemaining !== null && (
                  <div className={`flex items-center gap-2 rounded-lg px-3 py-2 ${
                    reservationExpired
                      ? 'bg-red-500/10 border border-red-500/30'
                      : reservationTimeRemaining < 120
                        ? 'bg-amber-500/10 border border-amber-500/30'
                        : 'bg-white/5 border border-white/10'
                  }`}>
                    <Clock size={16} className={
                      reservationExpired
                        ? 'text-red-400'
                        : reservationTimeRemaining < 120
                          ? 'text-amber-400'
                          : 'text-white/60'
                    } />
                    {reservationExpired ? (
                      <p className="text-red-400 sequel-45 text-xs">
                        Reservation expired - please select tickets again
                      </p>
                    ) : (
                      <p className={`sequel-45 text-xs ${
                        reservationTimeRemaining < 120 ? 'text-amber-400' : 'text-white/60'
                      }`}>
                        Reserved for {formatTimeRemaining(reservationTimeRemaining)}
                        {reservationTimeRemaining < 120 && ' - complete soon!'}
                      </p>
                    )}
                  </div>
                )}
                {/* Maximum inventory notice */}
                {maxAvailableTickets !== undefined && ticketCount >= maxAvailableTickets && maxAvailableTickets > 0 && (
                  <div className={`flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2 ${reservationId && reservationTimeRemaining !== null ? 'mt-2' : ''}`}>
                    <AlertTriangle size={14} className="text-yellow-400" />
                    <p className="text-yellow-400 sequel-45 text-xs">
                      Maximum available tickets selected ({maxAvailableTickets})
                    </p>
                  </div>
                )}
              </div>

              {/* Inline Error Message - replaces browser alert() dialogs */}
              {errorMessage && (
                <div className="bg-red-500/10 border border-red-500/40 rounded-lg px-4 py-3 flex items-start gap-3">
                  <CircleX size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-red-400 sequel-75 text-sm">{errorMessage}</p>
                    <button
                      onClick={() => setErrorMessage(null)}
                      className="text-red-400/70 hover:text-red-400 text-xs sequel-45 mt-1 underline"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}

              {/* === PAYMENT OPTIONS - 4 Uniform Buttons === */}
              <div className="space-y-3">
                {/* A. Pay With Balance - Only shown if user has sufficient balance */}
                {(() => {
                  const canUseBalance = authenticated && userBalance >= amount;
                  return canUseBalance && (
                    <button
                      onClick={handleBalancePayment}
                      disabled={balanceLoading || loadingBalance}
                      className="w-full h-[72px] flex items-center justify-between px-4 bg-[#0052FF] rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 hover:brightness-110 active:scale-[0.99]"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
                          <DollarSign className="text-white" size={22} />
                        </div>
                        <div className="text-left">
                          <p className="text-white sequel-75 text-sm uppercase">Pay With Balance</p>
                          <p className="text-[#DDE404] sequel-45 text-xs">
                            {loadingBalance ? 'Loading...' : `Available: $${userBalance.toFixed(2)}`}
                          </p>
                        </div>
                      </div>
                      <ChevronRight size={20} className="text-white" />
                    </button>
                  );
                })()}

                {/* B. Pay With Wallet - Powered by Coinbase Commerce */}
                {authenticated && (
                  <button
                    onClick={handleOnchainKitPayment}
                    disabled={onchainKitLoading}
                    className="w-full h-[72px] flex items-center justify-between px-4 bg-[#0052FF] rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 hover:brightness-110 active:scale-[0.99]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
                        <Wallet className="text-white" size={22} />
                      </div>
                      <div className="text-left">
                        <p className="text-white sequel-75 text-sm uppercase">Pay With Wallet</p>
                        <p className="text-white/80 sequel-45 text-xs">Powered by Coinbase Commerce</p>
                      </div>
                    </div>
                    <ChevronRight size={20} className="text-white" />
                  </button>
                )}

                {/* C. Pay With Your Base Account */}
                {authenticated && (
                  <button
                    onClick={handleBaseAccountPayment}
                    disabled={baseAccountLoading}
                    className="w-full h-[72px] flex items-center justify-between px-4 bg-[#0052FF] rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 hover:brightness-110 active:scale-[0.99]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
                        <svg className="w-6 h-6 text-white" viewBox="0 0 111 111" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M54.921 110.034C85.359 110.034 110.034 85.402 110.034 55.017C110.034 24.6319 85.359 0 54.921 0C26.0432 0 2.35281 22.1714 0 50.3923H72.8467V59.6416H3.9565e-07C2.35281 87.8625 26.0432 110.034 54.921 110.034Z" fill="currentColor"/>
                        </svg>
                      </div>
                      <div className="text-left">
                        <p className="text-white sequel-75 text-sm uppercase">Pay With Your Base Account</p>
                        <p className="text-white/80 sequel-45 text-xs">Fast USDC payments on Base</p>
                      </div>
                    </div>
                    <ChevronRight size={20} className="text-white" />
                  </button>
                )}

                {/* D. Pay With Card - Coming Soon */}
                <button
                  disabled
                  className="w-full h-[72px] flex items-center justify-between px-4 bg-gray-600 rounded-xl cursor-not-allowed"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                      <CreditCard className="text-gray-400" size={22} />
                    </div>
                    <div className="text-left">
                      <p className="text-gray-300 sequel-75 text-sm uppercase">Pay With Card</p>
                      <p className="text-gray-400 sequel-45 text-xs">Powered by instaxchange</p>
                    </div>
                  </div>
                  <span className="text-[#DDE404] sequel-45 text-xs uppercase">Coming Soon</span>
                </button>
              </div>

              {/* Cancel button */}
              <button
                onClick={onClose}
                type="button"
                className="w-full bg-transparent border border-white/20 uppercase text-sm text-white/60 sequel-45 hover:bg-white/5 hover:text-white hover:border-white/40 px-6 py-3 cursor-pointer rounded-xl transition-all duration-200 mt-3"
              >
                Cancel
              </button>

            </div>
          )}

          {/* Error state: Modal opened with no tickets selected */}
          {/* Only show when genuinely no tickets selected AND not during/after a payment attempt */}
          {/* Also check paymentAttempted and purchasedTickets to prevent showing after successful payment resets ticketCount */}
          {showInitialPayment && paymentStep === 'initial' && ticketCount === 0 && !baseLoading && !baseAccountLoading && !balanceLoading && !loading && !paymentAttempted && purchasedTickets.length === 0 && (
            <div className="py-8 text-center">
              <div className="w-16 h-16 bg-[#EF008F] rounded-full flex items-center justify-center mx-auto mb-4">
                <CircleX size={32} className="text-white" />
              </div>
              <h3 className="text-white sequel-75 text-xl mb-2">No Entries Selected</h3>
              <p className="text-gray-400 sequel-45 mb-6">
                Please select at least one ticket before proceeding to checkout.
              </p>
              <button
                onClick={handleCloseModal}
                className="py-4 px-10 bg-gradient-to-r from-[#DDE404] to-[#C5CC03] hover:from-[#C5CC03] hover:to-[#DDE404] text-black sequel-75 uppercase rounded-xl transition-all duration-300 shadow-lg shadow-[#DDE404]/20 hover:shadow-[#DDE404]/30 hover:scale-[1.02] active:scale-[0.98]"
              >
                Select Tickets
              </button>
            </div>
          )}

          {/* Balance Processing */}
          {paymentStep === 'balance-processing' && (
            <div className="py-8 text-center">
              <div className="w-16 h-16 border-4 border-[#DDE404] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <h3 className="text-white sequel-75 text-xl mb-2">Processing Payment</h3>
              <p className="text-gray-400 sequel-45 mb-4">
                {ticketCount} {ticketCount > 1 ? 'entries' : 'entry'} • ${amount.toFixed(2)} from your balance
              </p>
              <p className="text-gray-500 text-xs sequel-45">
                Please wait while we process your balance payment...
              </p>
            </div>
          )}

          {/* Base Processing */}
          {paymentStep === 'base-processing' && (
            <div className="py-8 text-center">
              <div className="w-16 h-16 border-4 border-[#DDE404] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <h3 className="text-white sequel-75 text-xl mb-2">Processing Payment</h3>
              <p className="text-gray-400 sequel-45 mb-4">
                {ticketCount} {ticketCount > 1 ? 'entries' : 'entry'} • ${amount.toFixed(2)} USDC
              </p>
              <p className="text-gray-500 text-xs sequel-45">
                Please wait while we confirm your transaction on Base...
              </p>
            </div>
          )}

          {/* Base Account Processing */}
          {paymentStep === 'base-account-processing' && (
            <div className="py-8 text-center">
              <div className="w-16 h-16 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <h3 className="text-white sequel-75 text-xl mb-2">Processing Base Payment</h3>
              <p className="text-gray-400 sequel-45 mb-4">
                {ticketCount} {ticketCount > 1 ? 'entries' : 'entry'} • ${amount.toFixed(2)} USDC
              </p>
              <div className="flex items-center justify-center gap-2 text-blue-400 text-xs sequel-45 mb-3">
                <div className="animate-pulse w-2 h-2 bg-blue-500 rounded-full"></div>
                <span>Complete payment in Base popup</span>
              </div>
              <p className="text-gray-500 text-xs sequel-45">
                Seamless one-tap USDC payment on Base network
              </p>
            </div>
          )}

          {/* OnchainKit Checkout Processing */}
          {paymentStep === 'onchainkit-processing' && (
            <div className="space-y-4">
              <p className="text-white/60 sequel-45 text-sm text-center">
                {ticketCount} {ticketCount > 1 ? 'entries' : 'entry'} • ${amount.toFixed(2)} USD
              </p>

              <div className="bg-[#1A1A1A] rounded-lg p-6">
                <p className="text-purple-300 sequel-45 text-sm text-center mb-4">
                  Complete your payment using your connected wallet
                </p>
                <div className="flex justify-center">
                  <Checkout
                    chargeHandler={handleOnchainKitChargeCreate}
                    onStatus={handleOnchainKitStatus}
                  >
                    <CheckoutButton
                      coinbaseBranded
                      className="w-full max-w-xs"
                    />
                    <CheckoutStatus />
                  </Checkout>
                </div>
              </div>

              <div className="flex items-center justify-center gap-2 text-purple-400 text-xs sequel-45">
                <div className="animate-pulse w-2 h-2 bg-purple-500 rounded-full"></div>
                <span>Complete payment in wallet popup</span>
              </div>

              <p className="text-gray-500 text-xs sequel-45 text-center">
                Supports MetaMask, Coinbase Wallet, and other EVM wallets on Base network.
              </p>

              <button
                onClick={handleReturn}
                className="w-full bg-transparent border border-white/20 uppercase text-sm text-white/60 sequel-45 hover:bg-white/5 hover:text-white hover:border-white/40 px-6 py-3 cursor-pointer rounded-xl transition-all duration-200"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Crypto Selection Step - Choose which cryptocurrency to pay with */}
          {paymentStep === 'crypto-selection' && (
            <div className="space-y-5">
              {/* Back button and summary */}
              <div className="flex items-center justify-between">
                <button
                  onClick={handleReturn}
                  className="flex items-center gap-2 text-white/60 hover:text-white transition-colors"
                >
                  <ArrowLeft size={18} />
                  <span className="sequel-45 text-sm">Back</span>
                </button>
                <div className="text-right">
                  <p className="text-white/60 sequel-45 text-xs">{textOverrides?.totalLabel || 'Total'}</p>
                  <p className="text-[#DDE404] sequel-75">${amount.toFixed(2)}</p>
                </div>
              </div>

              {/* Instruction */}
              <div className="text-center">
                <p className="text-white sequel-75 text-lg mb-1">Choose Your Cryptocurrency</p>
                <p className="text-white/50 sequel-45 text-sm">Select the cryptocurrency you'd like to pay with</p>
              </div>

              {/* Crypto Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {CRYPTO_OPTIONS.map((crypto) => (
                  <button
                    key={crypto.id}
                    onClick={() => handleCryptoSelect(crypto.id)}
                    className="group relative overflow-hidden rounded-xl p-4 border border-white/10 hover:border-white/30 bg-gradient-to-br from-gray-800/50 to-gray-900/50 hover:from-gray-700/50 hover:to-gray-800/50 transition-all duration-300"
                  >
                    {/* Glow effect on hover */}
                    <div
                      className="absolute inset-0 opacity-0 group-hover:opacity-20 transition-opacity duration-300 blur-xl"
                      style={{ backgroundColor: crypto.color }}
                    ></div>

                    <div className="relative flex flex-col items-center gap-2">
                      {/* Crypto Icon */}
                      <div
                        className="w-12 h-12 rounded-full flex items-center justify-center text-2xl"
                        style={{
                          backgroundColor: `${crypto.color}20`,
                          color: crypto.color
                        }}
                      >
                        {crypto.icon}
                      </div>

                      {/* Crypto Name */}
                      <div className="text-center">
                        <p className="text-white sequel-75 text-sm">{crypto.name}</p>
                        <p className="text-white/40 sequel-45 text-xs">{crypto.symbol}</p>
                      </div>
                    </div>

                    {/* Selection Arrow */}
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <ChevronRight size={16} className="text-white/50" />
                    </div>
                  </button>
                ))}
              </div>

              {/* Info text */}
              <div className="bg-orange-500/5 border border-orange-500/20 rounded-lg px-4 py-3">
                <p className="text-orange-300/70 text-xs sequel-45 text-center">
                  All cryptocurrencies are converted to USD at current market rates. Payment is processed securely via Coinbase Commerce.
                </p>
              </div>

              {/* Cancel button */}
              <button
                onClick={handleReturn}
                className="w-full bg-transparent border border-white/20 uppercase text-sm text-white/60 sequel-45 hover:bg-white/5 hover:text-white hover:border-white/40 px-6 py-3 cursor-pointer rounded-xl transition-all duration-200"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Other Crypto Checkout Processing - In-app modal for BTC, ETH, and other cryptos */}
          {paymentStep === 'othercrypto-processing' && (
            <div className="space-y-4">
              {/* Show selected cryptocurrency if available */}
              {selectedCrypto && (
                <div className="flex items-center justify-center gap-3 py-2">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-lg"
                    style={{
                      backgroundColor: `${CRYPTO_OPTIONS.find(c => c.id === selectedCrypto)?.color}20`,
                      color: CRYPTO_OPTIONS.find(c => c.id === selectedCrypto)?.color
                    }}
                  >
                    {CRYPTO_OPTIONS.find(c => c.id === selectedCrypto)?.icon}
                  </div>
                  <div>
                    <p className="text-white sequel-75 text-sm">
                      Paying with {CRYPTO_OPTIONS.find(c => c.id === selectedCrypto)?.name}
                    </p>
                    <p className="text-white/60 sequel-45 text-xs">
                      {ticketCount} {ticketCount > 1 ? 'entries' : 'entry'} • ${amount.toFixed(2)} USD
                    </p>
                  </div>
                </div>
              )}
              {!selectedCrypto && (
                <p className="text-white/60 sequel-45 text-sm text-center">
                  {ticketCount} {ticketCount > 1 ? 'entries' : 'entry'} • ${amount.toFixed(2)} USD
                </p>
              )}

              <div className="bg-[#1A1A1A] rounded-lg p-6">
                <p className="text-orange-300 sequel-45 text-sm text-center mb-4">
                  Pay with Bitcoin, Ethereum, or other cryptocurrencies
                </p>
                <div className="flex justify-center">
                  <Checkout
                    chargeHandler={handleOtherCryptoChargeCreate}
                    onStatus={handleOtherCryptoStatus}
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
                onClick={handleReturn}
                className="w-full bg-transparent border border-white/20 uppercase text-sm text-white/60 sequel-45 hover:bg-white/5 hover:text-white hover:border-white/40 px-6 py-3 cursor-pointer rounded-xl transition-all duration-200"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Note: Card payments now use the commerce-checkout flow below, which supports card/Apple Pay via Coinbase Commerce */}

          {/* Coinbase Commerce Checkout - External hosted checkout page */}
          {/* Used for both card payments and crypto commerce payments */}
          {paymentStep === 'commerce-checkout' && commerceCheckoutUrl && (
            <div className="space-y-4">
              <p className="text-white/60 sequel-45 text-sm text-center">
                {ticketCount} {ticketCount > 1 ? 'entries' : 'entry'} • ${amount.toFixed(2)} USD
              </p>

              <div className="bg-[#1A1A1A] rounded-lg p-6 text-center">
                <p className="text-purple-300 sequel-45 text-sm mb-4">
                  Complete your payment on Coinbase Commerce:
                </p>
                <a
                  href={commerceCheckoutUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 py-4 px-10 bg-gradient-to-r from-purple-600 to-violet-600 hover:from-violet-600 hover:to-purple-600 text-white sequel-75 uppercase rounded-xl transition-all duration-300 shadow-lg shadow-purple-600/30 hover:shadow-purple-600/40 hover:scale-[1.02] active:scale-[0.98]"
                >
                  <ExternalLink size={18} />
                  Pay via Coinbase
                </a>
              </div>

              <div className="flex items-center justify-center gap-2 text-purple-400 text-xs sequel-45">
                <div className="animate-pulse w-2 h-2 bg-purple-500 rounded-full"></div>
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
                Pay with your Coinbase account or any supported cryptocurrency. Your entries will be confirmed automatically once payment is verified.
              </p>

              <button
                onClick={handleReturn}
                className="w-full bg-transparent border border-white/20 uppercase text-sm text-white/60 sequel-45 hover:bg-white/5 hover:text-white hover:border-white/40 px-6 py-3 cursor-pointer rounded-xl transition-all duration-200"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Commerce Checkout Loading - Before checkout URL is ready */}
          {paymentStep === 'commerce-checkout' && !commerceCheckoutUrl && (
            <div className="py-8 text-center">
              <div className="w-16 h-16 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <h3 className="text-white sequel-75 text-xl mb-2">Creating Checkout</h3>
              <p className="text-gray-400 sequel-45 mb-4">
                {ticketCount} {ticketCount > 1 ? 'entries' : 'entry'} • ${amount.toFixed(2)} USD
              </p>
              <p className="text-gray-500 text-xs sequel-45">
                Setting up your Coinbase Commerce checkout...
              </p>
              <button
                onClick={handleReturn}
                className="mt-4 bg-transparent border border-white/20 uppercase text-sm text-white/60 sequel-45 hover:bg-white/5 hover:text-white hover:border-white/40 px-6 py-3 cursor-pointer rounded-xl transition-all duration-200"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Payment success */}
          {/* ISSUE 9B FIX: Show optimistic loading state while data refreshes */}
          {paymentStep === 'success' && (
            <div className="py-8 text-center">
              <div className="w-16 h-16 bg-[#DDE404] rounded-full flex items-center justify-center mx-auto mb-4">
                <Check size={32} className="text-black" />
              </div>
              <h3 className="text-white sequel-75 text-xl mb-2">Payment Successful!</h3>
              <p className="text-gray-400 sequel-45 mb-4">
                Your {purchasedTickets.length || ticketCount} {(purchasedTickets.length || ticketCount) > 1 ? 'entries have' : 'entry has'} been confirmed.
              </p>

              {/* ISSUE 9B FIX: Show optimistic loading feedback while entries refresh */}
              {showOptimisticSuccess && (
                <div className="mb-4 flex items-center justify-center gap-2 py-2 px-4 bg-green-500/10 border border-green-500/30 rounded-lg mx-auto max-w-xs">
                  <RefreshCw size={16} className="text-green-400 animate-spin" />
                  <span className="text-green-400 sequel-45 text-sm">Loading your tickets...</span>
                </div>
              )}

              {/* Proof of Purchase Reference */}
              {(baseTransactionId || balanceTransactionId || onchainKitTransactionId) && (
                <div className="bg-[#1A1A1A] rounded-lg p-4 mb-4 max-w-md mx-auto">
                  <p className="text-white/60 sequel-45 text-xs mb-1">Proof of Purchase Reference:</p>
                  <p className="text-[#DDE404] sequel-75 text-sm font-mono break-all">
                    {baseTransactionId || balanceTransactionId || onchainKitTransactionId}
                  </p>
                </div>
              )}

              {/* Display purchased ticket numbers - use purchasedTickets which persist after onPaymentSuccess */}
              {purchasedTickets.length > 0 && (
                <div className="bg-[#2A2A2A] rounded-lg p-4 mb-6 max-w-md mx-auto">
                  <p className="text-white/60 sequel-45 text-sm mb-2">Your Ticket Numbers:</p>
                  <div className="flex flex-wrap gap-2 justify-center max-h-32 overflow-y-auto">
                    {[...purchasedTickets].sort((a, b) => a - b).map((ticket) => (
                      <span
                        key={ticket}
                        className="bg-[#DDE404] text-[#1A1A1A] sequel-75 text-sm px-3 py-1 rounded-md"
                      >
                        {ticket}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={handleViewEntries}
                className="py-4 px-10 bg-gradient-to-r from-[#DDE404] to-[#C5CC03] hover:from-[#C5CC03] hover:to-[#DDE404] text-black sequel-75 uppercase rounded-xl transition-all duration-300 shadow-lg shadow-[#DDE404]/20 hover:shadow-[#DDE404]/30 hover:scale-[1.02] active:scale-[0.98]"
              >
                View My Entries
              </button>
            </div>
          )}

          {/* Payment error */}
          {/* ISSUE 8B FIX: Enhanced error display with specific guidance */}
          {paymentStep === 'error' && (
            <div className="py-8 text-center">
              <div className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <CircleX size={32} className="text-white" />
              </div>
              <h3 className="text-white sequel-75 text-xl mb-2">Payment Failed</h3>
              <p className="text-gray-400 sequel-45 mb-2">
                {errorMessage || "Something went wrong with your payment."}
              </p>
              {/* ISSUE 8B FIX: Show specific guidance based on error type */}
              {errorInfo?.guidance && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 mb-4 mx-auto max-w-md">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
                    <p className="text-amber-400/90 sequel-45 text-sm text-left">
                      {errorInfo.guidance}
                    </p>
                  </div>
                </div>
              )}
              {!errorInfo?.guidance && (
                <p className="text-gray-500 sequel-45 text-sm mb-4">
                  Your tickets have not been charged. Please try again or choose a different payment method.
                </p>
              )}
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                {errorInfo?.retryable !== false && (
                  <button
                    onClick={handleReturn}
                    className="py-4 px-10 bg-gradient-to-r from-[#DDE404] to-[#C5CC03] hover:from-[#C5CC03] hover:to-[#DDE404] text-black sequel-75 uppercase rounded-xl transition-all duration-300 shadow-lg shadow-[#DDE404]/20 hover:shadow-[#DDE404]/30 hover:scale-[1.02] active:scale-[0.98]"
                  >
                    Try Again
                  </button>
                )}
                {errorInfo?.category === 'availability' && (
                  <button
                    onClick={() => {
                      handleCloseModal();
                      window.location.reload();
                    }}
                    className="py-4 px-10 bg-transparent border border-white/30 text-white sequel-75 uppercase rounded-xl hover:bg-white/10 hover:border-white/50 transition-all duration-200"
                  >
                    Refresh & Select New Tickets
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Legacy payment status from URL params */}
          {(hasPaymentParams && !showInitialPayment && paymentStep === 'initial') && (
            <PaymentStatus
              status={paymentStatus}
              paymentData={paymentData}
              onReturn={handleReturn}
            />
          )}
        </div>
      </div>

      {/* TopUpWalletModal - Opens when user clicks the bonus banner */}
      {showTopUpModal && (
        <Suspense fallback={null}>
          <TopUpWalletModal
            isOpen={showTopUpModal}
            onClose={() => setShowTopUpModal(false)}
            onSuccess={() => {
              setShowTopUpModal(false);
              refreshUserData();
              // Refresh balance after top-up
              if (baseUser?.id) {
                setLoadingBalance(true);
                getUserBalance(toCanonicalUserId(baseUser.id))
                  .then(balance => setUserBalance(balance.data.usdc_balance))
                  .catch(err => console.warn('Failed to refresh balance:', err))
                  .finally(() => setLoadingBalance(false));
              }
            }}
          />
        </Suspense>
      )}
    </div>
  );
};

export default PaymentModal;
