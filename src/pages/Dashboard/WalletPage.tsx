import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { CircleX } from "lucide-react";
import { WalletManagement } from "../../components/WalletManagement";
import { usePaymentStatus } from "../../hooks/useGetPaymentStatus";
import PaymentStatus from "../../components/PaymentStatus";
import { footerLogo } from "../../assets/images";

/**
 * Wallet Dashboard Page
 *
 * Displays comprehensive wallet management UI including:
 * - Account balance (USDC)
 * - Connected wallets (Base Account, Privy, External)
 * - Token balances
 * - Top-up functionality
 * - First deposit bonus information
 * - Transaction history for top-ups
 */
const WalletPage: React.FC = () => {
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [walletKey, setWalletKey] = useState(0);
  const navigate = useNavigate();
  const {
    paymentData,
    loading: paymentLoading,
    paymentStatus,
  } = usePaymentStatus(() => setShowPaymentModal(true));

  const paymentParams = useMemo(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const statusOfPayment =
      urlParams.get("payment") || urlParams.get("paymentStatus");
    const txId = urlParams.get("txId");
    const txType = urlParams.get("type");
    return {
      statusOfPayment,
      txId,
      txType,
      hasPaymentParams: !!statusOfPayment || !!txId,
    };
  }, []);

  // Handle popup auto-close for Coinbase Commerce redirects
  useEffect(() => {
    const isPopup = window.opener && !window.opener.closed;
    if (
      isPopup &&
      paymentParams.statusOfPayment &&
      paymentParams.txType === "topup"
    ) {
      // Notify parent window
      try {
        window.opener.postMessage(
          {
            type:
              paymentParams.statusOfPayment === "success"
                ? "topup-success"
                : "topup-cancelled",
            source: "coinbase-redirect",
          },
          window.location.origin,
        );
      } catch (err) {
        console.warn("Failed to notify parent window:", err);
      }

      // Close popup after brief delay
      setTimeout(() => {
        window.close();
      }, 1500);
    }
  }, [paymentParams]);

  const handleClosePaymentModal = () => {
    setShowPaymentModal(false);
    window.history.replaceState({}, "", window.location.pathname);
  };

  const handleReturn = () => {
    if (paymentParams.hasPaymentParams) {
      window.history.replaceState({}, "", window.location.pathname);
    }
    setShowPaymentModal(false);
    // Refresh wallet component by changing its key
    setWalletKey((prev) => prev + 1);
  };

  return (
    <div className="min-h-[50vh]">
      <WalletManagement key={walletKey} showHeader={false} />

      {showPaymentModal && paymentParams.hasPaymentParams && (
        <div
          className={`fixed inset-0 bg-black/70 flex justify-center items-center z-50`}
        >
          <div
            className={`bg-[#1A1A1A] fixed sm:w-full w-11/12 top-1/2 left-1/2 z-10 pb-8 -translate-x-1/2 -translate-y-1/2 border-2 border-white rounded-xl max-w-xl`}
          >
            <img
              src={footerLogo}
              alt="prize-io"
              className="mx-auto relative -top-14"
            />
            <div
              onClick={handleClosePaymentModal}
              className="absolute -right-4 cursor-pointer -top-5 bg-white rounded-full p-1"
            >
              <CircleX color="black" className="" size={30} />
            </div>

            <h1 className="sequel-95 uppercase text-white sm:text-2xl mb-4 text-center -mt-6">
              Payment Status
            </h1>
            <p className="h-[3px] w-10/12 mx-auto bg-white"></p>

            {paymentLoading ? (
              <div className="py-12 text-center">
                <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-700 border-t-[#DDE404] mx-auto mb-4"></div>
                <p className="text-white sequel-45">
                  Checking payment status...
                </p>
              </div>
            ) : (
              <PaymentStatus
                status={paymentStatus}
                paymentData={paymentData}
                onReturn={handleReturn}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default WalletPage;
