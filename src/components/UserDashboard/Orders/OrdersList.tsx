import { useOutletContext, useNavigate } from "react-router";
import OrdersTable from "./OrdersTable";
import { useState, useEffect, useCallback, useRef } from "react";
import { database } from "../../../lib/database";
import { supabase } from "../../../lib/supabase";
import Loader from "../../Loader";
import { useAuthUser } from '../../../contexts/AuthContext';
import { usePaymentStatus } from "../../../hooks/useGetPaymentStatus";
import PaymentStatus from "../../PaymentStatus";
import { footerLogo } from "../../../assets/images";
import { CircleX, RefreshCw } from "lucide-react";
import { userIdsEqual } from "../../../utils/userId";
import ExportButton from "./ExportButton";

const ITEMS_PER_PAGE = 10;

/**
 * Checks if a record matches the current user.
 * Uses the shared userIdsEqual utility for consistent comparison logic.
 * UPDATED: Now checks canonical_user_id as the primary identifier
 */
function recordMatchesUser(
  record: { canonical_user_id?: string; user_id?: string; wallet_address?: string; privy_user_id?: string },
  userId: string
): boolean {
  return userIdsEqual(record.canonical_user_id, userId) ||
         userIdsEqual(record.user_id, userId) ||
         userIdsEqual(record.wallet_address, userId) ||
         userIdsEqual(record.privy_user_id, userId);
}

export default function OrdersList() {
  const { activeTab } = useOutletContext<{ activeTab: { key: string } }>();
  const [purchases, setPurchases] = useState<any[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const { baseUser, canonicalUserId } = useAuthUser();
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const navigate = useNavigate();
  const { paymentData, loading: paymentLoading, paymentStatus } = usePaymentStatus(() => setShowPaymentModal(true));

  // Track background refresh state separately from initial loading
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Debounce timer ref to prevent excessive refreshes from rapid real-time updates
  const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Track if we've loaded orders at least once to avoid showing loader during background refreshes
  const initialLoadDoneRef = useRef(false);

  const urlParams = new URLSearchParams(window.location.search);
  const statusOfPayment = urlParams.get("payment") || urlParams.get("paymentStatus");
  const npId = urlParams.get("NP_id") || urlParams.get("payment_id") || urlParams.get("invoice_id") || urlParams.get("paymentId") || urlParams.get("id");
  const hasPaymentParams = !!statusOfPayment || !!npId;

  // Function to fetch orders data
  const fetchOrders = useCallback(async (isBackgroundRefresh = false) => {
    if (!canonicalUserId) {
      console.warn('[OrdersList] No canonical user ID available, skipping fetch');
      setLoading(false);
      return;
    }

    // Only show loading state on initial load, not on background refreshes
    if (!initialLoadDoneRef.current) {
      setLoading(true);
    }

    // Show refreshing indicator during background updates
    if (isBackgroundRefresh && initialLoadDoneRef.current) {
      setIsRefreshing(true);
    }

    try {
      // Fetch from user_transactions table for purchases (includes Base and other payments)
      // Use canonicalUserId (prize:pid:<wallet>) to match database records
      const purchasesData = await database.getUserTransactions(canonicalUserId);

      // For entries tab, use the same user_transactions data but filter out top-ups
      // This ensures both tabs pull from the same source for consistency
      const entriesData = (purchasesData || []).filter((tx: any) => !tx.is_topup);

      setPurchases(purchasesData || []);
      setEntries(entriesData || []);
      initialLoadDoneRef.current = true;
    } catch (error) {
      console.error("Error fetching orders:", error);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [canonicalUserId]);

  // Debounced refresh function to prevent excessive API calls from rapid real-time updates
  const debouncedFetchOrders = useCallback(() => {
    if (refreshDebounceRef.current) {
      clearTimeout(refreshDebounceRef.current);
    }
    refreshDebounceRef.current = setTimeout(() => {
      fetchOrders(true); // Mark as background refresh
    }, 500); // 500ms debounce
  }, [fetchOrders]);

  useEffect(() => {
    fetchOrders(false); // Initial load, not background refresh

    // Set up real-time subscriptions for dashboard updates
    if (canonicalUserId) {
      // Channel for user's transactions (INSERT/UPDATE)
      // This covers both top-ups and ticket purchases
      // Use canonicalUserId to match database records keyed by canonical_user_id
      const transactionsChannel = supabase
        .channel(`user-transactions-${canonicalUserId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'user_transactions',
          },
          (payload) => {
            const record = payload.new as {
              user_id?: string;
              wallet_address?: string;
              canonical_user_id?: string;
              privy_user_id?: string;
            };

            if (recordMatchesUser(record, canonicalUserId)) {
              console.log('[OrdersList] Transaction change detected:', payload.eventType);
              debouncedFetchOrders();
            }
          }
        )
        .subscribe();

      // NOTE: Entries tab now also uses user_transactions data (filtered for non-top-ups)
      // so we only need to listen to user_transactions changes, not joincompetition

      // Channel for balance changes (covers top-ups via sub_account_balances)
      const balanceChannel = supabase
        .channel(`user-balance-orders-${canonicalUserId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'sub_account_balances',
          },
          (payload) => {
            const record = payload.new as {
              user_id?: string;
              canonical_user_id?: string;
              privy_user_id?: string;
              currency?: string;
            };

            // Only process USD currency records
            if (record.currency && record.currency !== 'USD') {
              return;
            }

            if (recordMatchesUser(record, canonicalUserId)) {
              console.log('[OrdersList] Balance change detected - may be a top-up:', payload.eventType);
              debouncedFetchOrders();
            }
          }
        )
        .subscribe();

      // Listen for balance-updated events (dispatched after successful payments/top-ups)
      // This ensures orders refresh immediately after wallet balance changes
      const handleBalanceUpdated = () => {
        console.log('[OrdersList] Balance updated event detected, refreshing orders');
        debouncedFetchOrders();
      };
      
      window.addEventListener('balance-updated', handleBalanceUpdated);

      // Cleanup subscriptions and debounce timer on unmount
      return () => {
        if (refreshDebounceRef.current) {
          clearTimeout(refreshDebounceRef.current);
        }
        window.removeEventListener('balance-updated', handleBalanceUpdated);
        supabase.removeChannel(transactionsChannel);
        supabase.removeChannel(balanceChannel);
      };
    }
  }, [canonicalUserId, fetchOrders, debouncedFetchOrders]);

  // Reset to first page when tab changes
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab.key]);

  const handleClosePaymentModal = () => {
    setShowPaymentModal(false);
    window.history.replaceState({}, '', window.location.pathname);
    navigate('/dashboard/orders');
  };

  const handleReturn = () => {
    if (hasPaymentParams) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    setShowPaymentModal(false);
    navigate('/competitions');
  };

  const data = activeTab.key === "purchases" ? purchases : entries;

  // Calculate pagination
  const totalPages = Math.ceil(data.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedData = data.slice(startIndex, endIndex);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loading) {
    return (
      <div className="py-20">
        <Loader />
      </div>
    );
  }

  return (
    <>
      {/* Export button */}
      {canonicalUserId && data.length > 0 && (
        <div className="mb-4 flex justify-end">
          <ExportButton userId={canonicalUserId} />
        </div>
      )}

      {/* Refreshing indicator for background data updates */}
      {isRefreshing && (
        <div className="mb-4 flex items-center justify-center gap-2 py-2 px-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <RefreshCw size={16} className="text-blue-400 animate-spin" />
          <span className="text-blue-400 sequel-45 text-sm">Updating orders...</span>
        </div>
      )}

      <OrdersTable activeTab={activeTab} data={paginatedData} />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2 mt-8">
          <button
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1}
            className="px-4 py-2 bg-[#333] text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#444] transition-colors sequel-45"
          >
            Previous
          </button>

          <div className="flex gap-1">
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let pageNum: number;

              if (totalPages <= 7) {
                pageNum = i + 1;
              } else if (currentPage <= 4) {
                pageNum = i + 1;
              } else if (currentPage >= totalPages - 3) {
                pageNum = totalPages - 6 + i;
              } else {
                pageNum = currentPage - 3 + i;
              }

              return (
                <button
                  key={pageNum}
                  onClick={() => handlePageChange(pageNum)}
                  className={`w-10 h-10 rounded-lg sequel-45 transition-colors ${
                    currentPage === pageNum
                      ? 'bg-[#DDE404] text-black'
                      : 'bg-[#333] text-white hover:bg-[#444]'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="px-4 py-2 bg-[#333] text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#444] transition-colors sequel-45"
          >
            Next
          </button>
        </div>
      )}

      {/* Entry count */}
      {data.length > 0 && (
        <div className="text-center mt-4 text-white/60 sequel-45 text-sm">
          Showing {startIndex + 1}-{Math.min(endIndex, data.length)} of {data.length} {activeTab.key === "purchases" ? "purchases" : "transactions"}
        </div>
      )}

      {showPaymentModal && hasPaymentParams && (
        <div className={`fixed inset-0 bg-black/70 flex justify-center items-center z-50`}>
          <div className={`bg-[#1A1A1A] fixed sm:w-full w-11/12 top-1/2 left-1/2 z-10 pb-8 -translate-x-1/2 -translate-y-1/2 border-2 border-white rounded-xl max-w-xl`}>
            <img src={footerLogo} alt="prize-io" className="mx-auto relative -top-14" />
            <div onClick={handleClosePaymentModal} className="absolute -right-4 cursor-pointer -top-5 bg-white rounded-full p-1">
              <CircleX color="black" className="" size={30}/>
            </div>

            <h1 className="sequel-95 uppercase text-white sm:text-2xl mb-4 text-center -mt-6">
              Payment Status
            </h1>
            <p className="h-[3px] w-10/12 mx-auto bg-white"></p>

            {paymentLoading ? (
              <div className="py-12 text-center">
                <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-700 border-t-[#DDE404] mx-auto mb-4"></div>
                <p className="text-white sequel-45">Checking payment status...</p>
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
    </>
  );
}
