import { useState, useEffect, useCallback } from "react";
import {
  X,
  Check,
  AlertCircle,
  ExternalLink,
  CreditCard,
  Gift,
  Coins,
  ChevronRight,
  Wallet,
} from "lucide-react";
import { useAuthUser } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import { toCanonicalUserId } from "../lib/canonicalUserId";
import {
  TOP_UP_CHECKOUT_URLS,
  CoinbaseCommerceService,
} from "../lib/coinbase-commerce";
import { CoinbaseOnrampService } from "../lib/coinbase-onramp";
import { isSuccessStatus, isFailureStatus } from "../lib/payment-status";
import { notificationService } from "../lib/notification-service";
import {
  Checkout,
  CheckoutButton,
  CheckoutStatus,
} from "@coinbase/onchainkit/checkout";
import type { LifecycleStatus } from "@coinbase/onchainkit/checkout";
import { FundButton, getOnrampBuyUrl } from "@coinbase/onchainkit/fund";
import { useRealTimeBalance } from "../hooks/useRealTimeBalance";
import { useRealtimeSubscriptions } from "../hooks/useRealtimeSubscriptions";

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

type PaymentStep =
  | "method"
  | "amount"
  | "loading"
  | "checkout"
  | "crypto-checkout"
  | "commerce-checkout"
  | "onramp-processing"
  | "fund-button"
  | "success"
  | "error";
type PaymentMethod = "crypto" | "commerce" | "offramp" | "onramp" | "fund";

// Get preset amounts from Coinbase checkout URLs
const PRESET_AMOUNTS = Object.keys(TOP_UP_CHECKOUT_URLS)
  .map(Number)
  .filter((a) => a >= 3)
  .sort((a, b) => a - b);

// Coinbase Commerce preset amounts (same as crypto since they use the same checkout URLs)
const COMMERCE_PRESET_AMOUNTS = PRESET_AMOUNTS;

// Coinbase Commerce charge URL base - used for constructing checkout URLs from charge IDs/codes
const COINBASE_COMMERCE_CHARGE_URL_BASE =
  "https://commerce.coinbase.com/charges/";

/**
 * Get CDP project ID with fallback chain (cached at module level)
 *
 * Both VITE_ONCHAINKIT_PROJECT_ID and VITE_CDP_PROJECT_ID should be set to the same value
 * from CDP Portal (https://portal.cdp.coinbase.com).
 *
 * Precedence order:
 * 1. VITE_ONCHAINKIT_PROJECT_ID (OnchainKit-specific configuration)
 * 2. VITE_CDP_PROJECT_ID (General CDP configuration, used by CDP React Provider)
 *
 * Cached at module initialization to avoid repeated environment variable access.
 */
const getCDPProjectId = (() => {
  // Read and cache environment variables at module initialization
  const onchainKitId = import.meta.env.VITE_ONCHAINKIT_PROJECT_ID;
  const cdpId = import.meta.env.VITE_CDP_PROJECT_ID;
  const projectId = onchainKitId || cdpId || "";

  // Log error if no project ID is configured (only once at initialization)
  if (!projectId) {
    console.error(
      "[TopUpWalletModal] No CDP project ID configured. OnchainKit onramp will not work.",
    );
    console.error(
      "[TopUpWalletModal] Please set VITE_ONCHAINKIT_PROJECT_ID or VITE_CDP_PROJECT_ID in your environment.",
    );
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
  const {
    hasUsedBonus,
    refresh: refreshBalance,
    addPendingTopUp,
    removePendingTopUp,
  } = useRealTimeBalance();
  const [step, setStep] = useState<PaymentStep>("method");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("commerce");
  const [amount, setAmount] = useState<number>(50);
  const [error, setError] = useState<string>("");
  const [checkoutUrl, setCheckoutUrl] = useState<string>("");
  const [transactionId, setTransactionId] = useState<string>("");
  const [cryptoChargeId, setCryptoChargeId] = useState<string>("");
  const [onrampUrl, setOnrampUrl] = useState<string>("");
  const [optimisticTopUpId, setOptimisticTopUpId] = useState<string | null>(
    null,
  );
  const [successDisplayedAt, setSuccessDisplayedAt] = useState<number | null>(
    null,
  );

  // Constant for minimum success display duration (5 seconds) - enforced on mobile and desktop
  const MIN_SUCCESS_DISPLAY_MS = 5000;

  // Real-time subscriptions for balance and transaction updates
  // Auto-refreshes balance when changes are detected in the database
  useRealtimeSubscriptions({
    onBalanceLedgerChange: useCallback(() => {
      if (baseUser?.id && isOpen) {
        refreshBalance();
      }
    }, [baseUser?.id, isOpen, refreshBalance]),
    onUserTransactionChange: useCallback(
      (payload: any) => {
        if (baseUser?.id && isOpen) {
          const status = (payload.new?.status || "").toLowerCase();
          if (
            status === "completed" ||
            status === "confirmed" ||
            status === "success"
          ) {
            refreshBalance();
          }
        }
      },
      [baseUser?.id, isOpen, refreshBalance],
    ),
    debounceMs: 500,
  });

  // Get user's primary wallet address for Base Account payments
  const primaryWallet =
    linkedWallets.find((w) => w.isEmbeddedWallet === true) ||
    linkedWallets.find((w) => w.isBaseAccount === true) ||
    linkedWallets.find((w) => w.chainType === "ethereum") ||
    linkedWallets[0];

  const walletAddress = primaryWallet?.address;

  useEffect(() => {
    if (!isOpen) {
      setStep("method");
      setPaymentMethod("commerce");
      setAmount(50);
      setError("");
      setCheckoutUrl("");
      setTransactionId("");
      setCryptoChargeId("");
      setOnrampUrl("");
      setSuccessDisplayedAt(null); // Reset success display timer
    }
  }, [isOpen]);

  // Timeout handler for commerce-checkout when URL is missing
  useEffect(() => {
    if (step === "commerce-checkout" && !checkoutUrl) {
      const timeoutId = setTimeout(() => {
        setError("Checkout creation timed out. Please try again.");
        setStep("error");
      }, 30000); // 30 second timeout

      return () => {
        clearTimeout(timeoutId);
      };
    }
  }, [step, checkoutUrl]);

  // Poll for payment status when in checkout step
  useEffect(() => {
    if (
      (step === "checkout" || step === "commerce-checkout") &&
      transactionId
    ) {
      const pollInterval = setInterval(async () => {
        try {
          const { data } = (await supabase
            .from("user_transactions")
            .select("status")
            .eq("id", transactionId)
            .single()) as { data: { status?: string } | null };

          if (data?.status && isSuccessStatus(data.status)) {
            clearInterval(pollInterval);

            // Add a brief delay before showing success to give users confidence
            // This prevents the "too quick" notification issue
            await new Promise((resolve) => setTimeout(resolve, 1500)); // 1.5 second delay

            setStep("success");
            setSuccessDisplayedAt(Date.now()); // Track when success was displayed

            // Immediately refresh balance to show updated amount
            refreshBalance();

            // Don't call onSuccess here - let the user see the success message
            // onSuccess will be called when they click "Done" button
          } else if (data?.status && isFailureStatus(data.status)) {
            clearInterval(pollInterval);
            setStep("error");
            setError("Payment failed or expired");
          }
        } catch (err) {
          // Continue polling
        }
      }, 5000);

      return () => clearInterval(pollInterval);
    }
  }, [step, transactionId, baseUser?.id, amount, refreshBalance]);

  // Handle messages from Coinbase Commerce and popup redirects
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Handle Coinbase Commerce iframe messages
      if (event.origin.includes("commerce.coinbase.com")) {
        if (
          event.data?.event === "charge:success" ||
          event.data?.type === "checkout:completed"
        ) {
          // Don't call onSuccess here - let the modal show success message first
          // The user will click "Done" to dismiss and trigger onSuccess
        }
      }

      // Handle postMessage from Coinbase Commerce redirect popup
      if (
        event.origin === window.location.origin &&
        event.data?.source === "coinbase-redirect"
      ) {
        if (event.data.type === "topup-success") {
          // Popup closed after successful payment
          // Don't disrupt the UI - the modal's polling will handle the success transition
          // Just ensure balance is fresh for when user sees the success screen
          refreshBalance();
          refreshUserData();
        } else if (event.data.type === "topup-cancelled") {
          // Payment cancelled in popup - return to amount selection only if not already showing success
          if (step !== "success") {
            setStep("amount");
            setError("");
          }
        }
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [refreshBalance, refreshUserData, step]);

  const initiatePayment = async () => {
    if (!baseUser?.id) {
      const errorMsg = "Please log in to continue";
      setError(errorMsg);
      setStep("error");
      return;
    }

    setStep("loading");
    setError("");

    try {
      if (paymentMethod === "crypto") {
        // Crypto payment now uses OnchainKit in-modal checkout
        if (!TOP_UP_CHECKOUT_URLS[amount]) {
          const errorMsg = `Amount $${amount} is not available. Please select from: $${PRESET_AMOUNTS.join(", $")}`;
          setError(errorMsg);
          setStep("error");
          return;
        }
        // Go directly to the OnchainKit checkout step
        setStep("crypto-checkout");
      } else if (paymentMethod === "commerce") {
        // Coinbase Commerce top-up - uses API to create dynamic charge with redirect URLs
        // This ensures proper metadata (user_id) is passed for webhook processing
        const allowedAmounts = [3, 5, 10, 20, 50, 100, 250, 500, 1000];

        if (!allowedAmounts.includes(amount)) {
          const errorMsg = `Amount $${amount} is not available. Available amounts: $${allowedAmounts.join(", $")}`;
          setError(errorMsg);
          setStep("error");
          return;
        }

        // Call API to create charge with proper redirect_url and metadata
        const result = await CoinbaseCommerceService.createTopUpTransaction(
          toCanonicalUserId(baseUser.id),
          amount,
        );

        if (!result.checkoutUrl) {
          const errorMsg = "Failed to create checkout - no URL returned";
          setError(errorMsg);
          setStep("error");
          return;
        }

        setTransactionId(result.transactionId);
        setCheckoutUrl(result.checkoutUrl);
        setStep("commerce-checkout");
      } else if (paymentMethod === "offramp") {
        // Coinbase Offramp (cash out) payment flow
        if (!walletAddress) {
          const errorMsg =
            "No wallet connected. Please connect a wallet first.";
          setError(errorMsg);
          setStep("error");
          return;
        }

        const result = await CoinbaseOnrampService.generateOfframpUrl({
          sourceAddress: walletAddress,
          sourceAsset: "USDC",
          sourceNetwork: "base",
          fiatCurrency: "USD",
          partnerUserId: baseUser?.id || "",
          redirectUrl: window.location.origin,
        });

        setCheckoutUrl(result.url);
        setStep("checkout");
      } else if (paymentMethod === "fund") {
        // FundButton flow - uses OnchainKit's built-in fund button
        // This shows the Coinbase Onramp widget in a popup
        if (!walletAddress) {
          const errorMsg =
            "No wallet connected. Please connect a wallet first.";
          setError(errorMsg);
          setStep("error");
          return;
        }

        setStep("fund-button");
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to initiate payment";
      setError(errorMessage);
      setStep("error");
    }
  };

  // OnchainKit charge handler for crypto top-up
  const handleCryptoChargeCreate = useCallback(async (): Promise<string> => {
    if (!baseUser?.id) {
      const errorMsg = "Please login first";
      throw new Error(errorMsg);
    }

    if (!amount || !Number.isFinite(amount) || amount <= 0) {
      const errorMsg = `Invalid amount: ${amount}`;
      throw new Error(errorMsg);
    }

    try {
      // Build headers with optional Authorization from Supabase session
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const requestBody = {
        userId: toCanonicalUserId(baseUser.id),
        totalAmount: amount,
        type: "topup",
        paymentMethod: "onchainkit",
      };

      // Create charge via the same endpoint used for entries, but for topup
      const response = await fetch("/api/create-charge", {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });

      const result = await response.json();

      if (!response.ok || result.success === false) {
        const errorMsg =
          result.error?.message || result.error || "Failed to create charge";
        throw new Error(errorMsg);
      }

      setTransactionId(result.data?.transactionId || "");
      setCryptoChargeId(result.data?.chargeId || "");

      return result.data?.chargeId || "";
    } catch (error) {
      throw error;
    }
  }, [baseUser?.id, amount]);

  // OnchainKit status handler for crypto top-up
  const handleCryptoStatus = useCallback(
    async (status: LifecycleStatus) => {
      if (status.statusName === "success") {
        // Payment completed successfully
        setStep("success");
        setSuccessDisplayedAt(Date.now()); // Track when success was displayed

        // Immediately refresh balance and user data
        refreshBalance();
        await refreshUserData();

        // Don't call onSuccess here - let the user see the success message
        // onSuccess will be called when they click "Done" button
      } else if (status.statusName === "error") {
        setError("Payment failed. Please try again.");
        setStep("error");
      }
    },
    [refreshBalance, refreshUserData, onSuccess],
  );

  const handleAmountSelect = (selectedAmount: number) => {
    setAmount(selectedAmount);
  };

  const handleMethodSelect = (method: PaymentMethod) => {
    setPaymentMethod(method);
    // Reset amount to a valid default for the selected method
    if (method === "crypto" && !TOP_UP_CHECKOUT_URLS[amount]) {
      setAmount(50);
    }
    // Automatically advance to amount selection step
    setStep("amount");
  };

  const handleContinue = async () => {
    if (paymentMethod === "crypto") {
      // Validate selected amount is available
      if (!TOP_UP_CHECKOUT_URLS[amount]) {
        const errorMsg = `Please select one of the available amounts: $${PRESET_AMOUNTS.join(", $")}`;
        setError(errorMsg);
        return;
      }
    }

    setError("");

    try {
      await initiatePayment();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to initiate payment";
      setError(errorMessage);
      setStep("error");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-200 p-4">
      <div className="bg-[#2B2B2B] rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <Wallet className="text-[#DDE404]" size={24} />
            <h2 className="text-xl sequel-75 text-white uppercase">
              {textOverrides?.modalTitle || "Top Up Balance"}
            </h2>
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
          {!hasUsedBonus && step !== "success" && step !== "error" && (
            <div className="mb-6 bg-[#DDE404]/15 border border-[#DDE404]/40 rounded-lg p-4 flex items-start gap-3">
              <Gift size={24} className="text-[#DDE404] shrink-0 mt-0.5" />
              <div>
                <p className="text-[#DDE404] sequel-75 text-sm">
                  50% First Deposit Bonus
                </p>
              </div>
            </div>
          )}

          {step === "method" && (
            <div className="space-y-4">
              <div>
                <p className="text-white sequel-45 mb-3 text-sm">
                  {textOverrides?.methodSelectionTitle || "Choose method:"}
                </p>
                <div className="grid grid-cols-1 gap-2">
                  {/* Option 1: Top up with Coinbase Commerce - Primary method for balance top-ups */}
                  {/* Separated from entry purchases to ensure clear transaction tracking */}
                  <button
                    onClick={() => handleMethodSelect("commerce")}
                    className="w-full h-18 flex items-center justify-between px-4 bg-[#0052FF] rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 hover:brightness-110 active:scale-[0.99]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
                        <Coins size={22} className="text-white" />
                      </div>
                      <div className="text-left">
                        <p className="text-white sequel-75 text-sm uppercase">
                          {textOverrides?.cryptoTopUpLabel || "Pay With Crypto"}
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
                      <div className="w-10 h-10 rounded-lg bg-gray-600/30 flex items-center justify-center shrink-0">
                        <CreditCard size={20} className="text-gray-500" />
                      </div>
                      <div className="text-left">
                        <p className="sequel-75 text-sm text-gray-400">Card</p>
                        <p className="text-gray-500 sequel-45 text-xs">Soon</p>
                      </div>
                    </div>
                    <ChevronRight size={18} className="text-gray-600 shrink-0" />
                  </button> */}
                </div>
              </div>
            </div>
          )}

          {step === "amount" && (
            <div className="space-y-6">
              <div>
                <button
                  onClick={() => setStep("method")}
                  className="text-gray-400 text-sm sequel-45 mb-4 hover:text-white transition-colors flex items-center gap-1"
                >
                  ← Back
                </button>

                {paymentMethod === "offramp" ? (
                  <div className="text-center py-4">
                    <p className="text-white sequel-45 mb-4">
                      Redirecting to Coinbase...
                    </p>
                  </div>
                ) : paymentMethod === "fund" ? (
                  <>
                    <p className="text-white sequel-45 mb-4 text-sm">
                      Select amount:
                    </p>
                    <div className="grid grid-cols-4 gap-3 mb-4">
                      {PRESET_AMOUNTS.map((presetAmount) => (
                        <button
                          key={presetAmount}
                          onClick={() => handleAmountSelect(presetAmount)}
                          className={`py-3 px-4 rounded-lg sequel-75 transition-all ${
                            amount === presetAmount
                              ? "bg-[#DDE404] text-black"
                              : "bg-[#3A3A3A] text-white hover:bg-[#4A4A4A]"
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
                    <p className="text-white sequel-45 mb-4 text-sm">
                      Select amount:
                    </p>
                    <div className="grid grid-cols-4 gap-3 mb-4">
                      {(paymentMethod === "commerce"
                        ? COMMERCE_PRESET_AMOUNTS
                        : PRESET_AMOUNTS
                      ).map((presetAmount) => (
                        <button
                          key={presetAmount}
                          onClick={() => handleAmountSelect(presetAmount)}
                          className={`py-3 px-4 rounded-lg sequel-75 transition-all ${
                            amount === presetAmount
                              ? "bg-[#DDE404] text-black"
                              : "bg-[#3A3A3A] text-white hover:bg-[#4A4A4A]"
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
                  paymentMethod === "crypto" && !TOP_UP_CHECKOUT_URLS[amount]
                }
                className="w-full h-14 flex items-center justify-center px-6 bg-[#0052FF] rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 hover:brightness-110 active:scale-[0.99]"
              >
                <span className="text-white sequel-75 text-sm uppercase">
                  {paymentMethod === "offramp"
                    ? "Cash Out"
                    : `Top Up $${amount}`}
                </span>
              </button>
            </div>
          )}

          {step === "loading" && (
            <div className="py-12 text-center">
              <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-700 border-t-[#DDE404] mx-auto mb-4"></div>
              <p className="text-white sequel-45">Creating payment...</p>
              <p className="text-gray-400 text-xs sequel-45 mt-2">
                {paymentMethod === "offramp"
                  ? "Redirecting to Coinbase..."
                  : "Preparing checkout..."}
              </p>
            </div>
          )}

          {/* Base Account Processing */}
          {/* FundButton Step - OnchainKit FundButton */}
          {step === "fund-button" && walletAddress && (
            <div className="space-y-4">
              <p className="text-white sequel-45 text-sm text-center">
                Fund ${amount} via Coinbase
              </p>

              <div className="bg-linear-to-br from-blue-900/40 to-blue-800/30 rounded-lg p-6 text-center border border-blue-500/30">
                <p className="text-blue-300 sequel-45 text-sm mb-4">
                  Click the button below to fund your wallet:
                </p>
                <div className="flex justify-center">
                  <FundButton
                    fundingUrl={getOnrampBuyUrl({
                      assets: ["USDC"],
                      presetFiatAmount: amount,
                      fiatCurrency: "USD",
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
                Fast funding for Coinbase users. Funds are deposited to your
                Base wallet.
              </p>

              {/* Completion button */}
              <div className="border-t border-gray-700 pt-4 mt-4">
                <button
                  onClick={() => {
                    setStep("success");
                    setSuccessDisplayedAt(Date.now()); // Track when success was displayed

                    // Immediately refresh balance and user data
                    refreshBalance();
                    refreshUserData();

                    // Don't call onSuccess here - let the user see the success message
                    // onSuccess will be called when they click "Done" button after 5 seconds
                  }}
                  className="w-full h-14 flex items-center justify-center px-6 bg-[#0052FF] rounded-xl transition-all duration-200 hover:brightness-110 active:scale-[0.99]"
                >
                  <span className="text-white sequel-75 text-sm uppercase">
                    Top Up Complete
                  </span>
                </button>
                <p className="text-gray-400 text-xs sequel-45 text-center mt-2">
                  Click once your funding is complete
                </p>
              </div>

              <button
                onClick={() => setStep("method")}
                className="w-full py-3 px-4 bg-transparent border border-white/20 text-white/60 hover:text-white hover:border-white/40 sequel-45 text-sm rounded-xl transition-all duration-200"
              >
                Cancel
              </button>
            </div>
          )}

          {/* OnchainKit Crypto Checkout - In-app modal (no redirect) */}
          {step === "crypto-checkout" && (
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
                Supports Bitcoin, Ethereum, Litecoin, Dogecoin, and 60+
                cryptocurrencies.
              </p>

              <button
                onClick={() => setStep("method")}
                className="w-full py-3 px-4 bg-transparent border border-white/20 text-white/60 hover:text-white hover:border-white/40 sequel-45 text-sm rounded-xl transition-all duration-200"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Coinbase Commerce Checkout - Redirect to hosted checkout page */}
          {step === "commerce-checkout" && checkoutUrl && (
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
                  className="inline-flex items-center justify-center gap-2 h-14 px-10 bg-[#0052FF] text-white sequel-75 uppercase rounded-xl transition-all duration-200 hover:brightness-110 active:scale-[0.99]"
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
                Pay with your Coinbase account or any supported cryptocurrency.
                Your balance will be credited automatically once payment is
                confirmed.
              </p>

              {/* Head Back to Site button - shown after user opens checkout */}
              <div className="border-t border-gray-700 pt-4 mt-4">
                <button
                  onClick={onClose}
                  className="w-full h-14 flex items-center justify-center px-6 bg-[#0052FF] rounded-xl transition-all duration-200 hover:brightness-110 active:scale-[0.99]"
                >
                  <span className="text-white sequel-75 text-sm uppercase">
                    Head Back to Site
                  </span>
                </button>
                <p className="text-gray-400 text-xs sequel-45 text-center mt-2">
                  (transactions can take up to 30 seconds, don't worry, it's
                  coming!)
                </p>
              </div>

              <button
                onClick={() => setStep("method")}
                className="w-full py-3 px-4 bg-transparent border border-white/20 text-white/60 hover:text-white hover:border-white/40 sequel-45 text-sm rounded-xl transition-all duration-200"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Commerce checkout loading/error fallback when URL is missing */}
          {step === "commerce-checkout" && !checkoutUrl && (
            <div className="py-8 text-center">
              <div className="w-16 h-16 border-4 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <h3 className="text-white sequel-75 text-xl mb-2">
                Creating Checkout
              </h3>
              <p className="text-gray-400 sequel-45 mb-4">
                Setting up your payment...
              </p>
              <p className="text-gray-500 text-xs sequel-45">
                If this takes too long, please try again.
              </p>
              <button
                onClick={() => setStep("method")}
                className="mt-4 py-3 px-6 bg-transparent border border-white/20 text-white/60 hover:text-white hover:border-white/40 sequel-45 text-sm rounded-xl transition-all duration-200"
              >
                Cancel
              </button>
            </div>
          )}

          {/* External checkout for Offramp only (requires external redirect) */}
          {step === "checkout" && checkoutUrl && (
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
                  className="inline-flex items-center justify-center gap-2 h-14 px-10 bg-[#0052FF] text-white sequel-75 uppercase rounded-xl transition-all duration-200 hover:brightness-110 active:scale-[0.99]"
                >
                  <ExternalLink size={18} />
                  <span className="text-sm">Complete Cash Out</span>
                </a>
              </div>

              <p className="text-gray-500 text-xs sequel-45 text-center">
                After completing the cash out, funds will be sent to your bank
                or Coinbase account.
              </p>

              <button
                onClick={onClose}
                className="w-full py-3 px-4 bg-transparent border border-white/20 text-white/60 hover:text-white hover:border-white/40 sequel-45 text-sm rounded-xl transition-all duration-200"
              >
                Close
              </button>
            </div>
          )}

          {step === "success" && (
            <div className="py-12 text-center">
              <div className="w-16 h-16 bg-[#DDE404] rounded-full flex items-center justify-center mx-auto mb-4">
                <Check size={32} className="text-black" />
              </div>
              <h3 className="text-white sequel-75 text-xl mb-2">
                {textOverrides?.successMessage ||
                  `Top up successful - $${amount.toFixed(2)}`}
              </h3>

              {/* Show first top-up bonus message if applicable */}
              {!hasUsedBonus && amount > 0 && (
                <div className="bg-gradient-to-r from-[#DDE404]/20 to-[#DDE404]/10 border border-[#DDE404]/30 rounded-lg p-4 mb-4 mx-auto max-w-md">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <Gift size={20} className="text-[#DDE404]" />
                    <h4 className="text-[#DDE404] sequel-75 text-lg">
                      First Top-Up Bonus!
                    </h4>
                  </div>
                  <p className="text-white sequel-45 text-sm mb-1">
                    You topped up{" "}
                    <span className="text-[#DDE404] font-bold">
                      ${amount.toFixed(2)}
                    </span>
                  </p>
                  <p className="text-white sequel-45 text-sm mb-1">
                    You received an extra{" "}
                    <span className="text-[#DDE404] font-bold">
                      ${(amount * 0.5).toFixed(2)}
                    </span>{" "}
                    bonus!
                  </p>
                  <p className="text-white/80 sequel-45 text-xs mt-2">
                    Total credited:{" "}
                    <span className="text-[#DDE404] font-bold">
                      ${(amount * 1.5).toFixed(2)}
                    </span>
                  </p>
                </div>
              )}

              <p className="text-gray-400 sequel-45 mb-2">
                Your balance has been updated.
              </p>
              <p className="text-gray-500 sequel-45 text-xs mb-6">
                (Please allow up to 60 seconds for this to appear in your
                balance)
              </p>
              <button
                onClick={() => {
                  // Ensure success message displays for at least 5 seconds (mobile and desktop)
                  const elapsedMs = successDisplayedAt
                    ? Date.now() - successDisplayedAt
                    : MIN_SUCCESS_DISPLAY_MS;

                  if (elapsedMs < MIN_SUCCESS_DISPLAY_MS) {
                    // Wait for remaining time, then refresh page to show new balance
                    setTimeout(() => {
                      onSuccess?.();
                      onClose();
                      // Refresh the page to ensure balance updates are visible
                      window.location.reload();
                    }, MIN_SUCCESS_DISPLAY_MS - elapsedMs);
                  } else {
                    // Already waited long enough, refresh immediately
                    onSuccess?.();
                    onClose();
                    // Refresh the page to ensure balance updates are visible
                    window.location.reload();
                  }
                }}
                className="h-14 px-10 flex items-center justify-center mx-auto bg-[#0052FF] rounded-xl transition-all duration-200 hover:brightness-110 active:scale-[0.99]"
              >
                <span className="text-white sequel-75 text-base uppercase">
                  Done
                </span>
              </button>
            </div>
          )}

          {step === "error" && (
            <div className="py-12 text-center">
              <div className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle size={32} className="text-white" />
              </div>
              <h3 className="text-white sequel-75 text-xl mb-2">
                {paymentMethod === "offramp"
                  ? "Cash Out Failed"
                  : "Payment Failed"}
              </h3>
              <p className="text-gray-400 sequel-45 mb-6">
                {error || "Something went wrong. Please try again."}
              </p>
              <button
                onClick={() => setStep("method")}
                className="h-14 px-10 flex items-center justify-center mx-auto bg-[#0052FF] rounded-xl transition-all duration-200 hover:brightness-110 active:scale-[0.99]"
              >
                <span className="text-white sequel-75 text-base uppercase">
                  Try Again
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TopUpWalletModal;
