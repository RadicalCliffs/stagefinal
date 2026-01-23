import { useState, useMemo, useEffect, lazy, Suspense } from 'react';
import { useAuthUser } from '../../contexts/AuthContext';
import {
  Wallet,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  AlertCircle,
  Shield,
  Coins,
  Unlink,
  History,
  ArrowUpRight,
  Clock,
  Download,
  Send,
  Settings,
  Plus,
  Link
} from 'lucide-react';
import { truncateString } from '../../utils/util';
import { useWalletTokens } from '../../hooks/useWalletTokens';
import { useRealTimeBalance } from '../../hooks/useRealTimeBalance';
import { supabase } from '../../lib/supabase';
import { database } from '../../lib/database';
import { toPrizePid, isWalletAddress, userIdsEqual } from '../../utils/userId';
import BaseAccountStatus from '../BaseAccountStatus';

// Lazy load TopUpWalletModal - only loaded when user clicks "Top Up"
const TopUpWalletModal = lazy(() => import('../TopUpWalletModal'));
// Lazy load wallet export and send components
const ExportWalletKey = lazy(() => import('./ExportWalletKey'));
const SendTransaction = lazy(() => import('./SendTransaction'));
// Lazy load wallet settings panel
const WalletSettingsPanel = lazy(() => import('./WalletSettingsPanel'));

// Interface for transaction display
interface WalletTransaction {
  id: string;
  user_id: string | null;
  amount: number | null;
  currency: string | null;
  payment_status: string | null;
  status: string | null;
  payment_provider: string | null;
  created_at: string | null;
  completed_at: string | null;
}

interface WalletManagementProps {
  onClose?: () => void;
  showHeader?: boolean;
}

const WalletManagement: React.FC<WalletManagementProps> = ({
  onClose,
  showHeader = true
}) => {
  // Use AuthContext for Base auth - linkWallet and unlinkWallet may not be available
  // as CDP/Base handles wallet linking differently
  const {
    linkedWallets,
    baseAccount,
    embeddedWallet,
    baseUser,
    refreshUserData,
    isLoading
  } = useAuthUser();

  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  // Toast notification for copy success
  const [showCopyToast, setShowCopyToast] = useState(false);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkSuccess, setLinkSuccess] = useState<string | null>(null);

  // External wallet linking state
  const [linkedExternalWallet, setLinkedExternalWallet] = useState<string | null>(null);
  const [isUnlinking, setIsUnlinking] = useState(false);

  // Transaction history state
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [showAllTransactions, setShowAllTransactions] = useState(false);
  const [topUps, setTopUps] = useState<any[]>([]);

  // Get real-time balance info including bonus eligibility
  // Use balance from useRealTimeBalance for real-time updates instead of walletBalance from AuthContext
  // walletBalance from AuthContext only updates on refresh, while useRealTimeBalance has Supabase subscriptions
  const { balance: realTimeBalance, hasUsedBonus, isLoading: realTimeLoading, refresh: refreshRealTimeBalance } = useRealTimeBalance();

  // Fetch the linked external wallet and transactions on mount
  useEffect(() => {
    const fetchLinkedWallet = async () => {
      if (!baseUser?.id) return;

      try {
        // Use RPC function which bypasses RLS and handles case-insensitive matching
        const { data, error } = await supabase.rpc('get_linked_external_wallet', {
          user_identifier: baseUser.id
        });

        if (error) {
          console.error('Error fetching linked wallet:', error);
          return;
        }

        // RPC returns { success: boolean, linked_wallet: string | null }
        const result = data as any;
        if (result?.success && result?.linked_wallet) {
          setLinkedExternalWallet(result.linked_wallet);
        }
      } catch (err) {
        console.error('Error fetching linked wallet:', err);
      }
    };

    const fetchTransactions = async () => {
      if (!baseUser?.id) return;

      setTransactionsLoading(true);
      try {
        // Fetch top-up transactions (transactions without competition_id)
        // Include pending statuses to show transactions immediately after initiation
        // Use ilike for case-insensitive wallet address matching and also check canonical_user_id
        const canonicalId = toPrizePid(baseUser.id);
        const normalizedWallet = isWalletAddress(baseUser.id) ? baseUser.id.toLowerCase() : baseUser.id;

        const { data, error } = await supabase
          .from('user_transactions')
          .select('*')
          .is('competition_id', null)
          .in('status', ['pending', 'pending_payment', 'waiting', 'processing', 'finished', 'completed', 'confirmed', 'success'])
          .or(`user_id.eq.${normalizedWallet},canonical_user_id.eq.${canonicalId},wallet_address.eq.${normalizedWallet}`)
          .order('created_at', { ascending: false })
          .limit(10);

        if (error) {
          console.error('Error fetching transactions:', error);
          return;
        }

        setTransactions(data || []);
      } catch (err) {
        console.error('Error fetching transactions:', err);
      } finally {
        setTransactionsLoading(false);
      }
    };

    const fetchTopUps = async () => {
      if (!baseUser?.id) return;
      
      try {
        const transactions = await database.getUserTransactions(baseUser.id);
        setTopUps(transactions.filter(t => t.transaction_type === 'topup'));
      } catch (err) {
        console.error('Error fetching top-ups:', err);
      }
    };

    fetchLinkedWallet();
    fetchTransactions();
    fetchTopUps();

    // Set up real-time subscription for transaction changes
    const channel = supabase
      .channel(`wallet-transactions-${baseUser?.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_transactions',
        },
        (payload) => {
          // Handle INSERT and UPDATE events
          const record = (payload.eventType === 'DELETE' ? payload.old : payload.new) as {
            user_id?: string;
            wallet_address?: string;
            canonical_user_id?: string;
            competition_id?: string | null;
          };

          // Only refresh if this is a transaction for the current user
          // and it's a top-up (no competition_id)
          // Use userIdsEqual for case-insensitive matching across different identifier formats
          const matchesUser = userIdsEqual(record.user_id, baseUser?.id) ||
                              userIdsEqual(record.wallet_address, baseUser?.id) ||
                              userIdsEqual(record.canonical_user_id, toPrizePid(baseUser?.id || ''));

          if (matchesUser && !record.competition_id) {
            console.log('[WalletManagement] Transaction change detected, refreshing');
            fetchTransactions();
            fetchTopUps();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [baseUser?.id]);

  // Get the primary wallet address for token fetching
  const primaryWalletAddress = useMemo(() => {
    if (baseAccount?.address) return baseAccount.address;
    if (embeddedWallet?.address) return embeddedWallet.address;
    if (linkedWallets.length > 0) return linkedWallets[0].address;
    return undefined;
  }, [baseAccount, embeddedWallet, linkedWallets]);

  // Fetch token balances for the primary wallet
  const { tokens, isLoading: tokensLoading, refresh: refreshTokens } = useWalletTokens(primaryWalletAddress);

  const handleCopyAddress = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(address);
      setShowCopyToast(true);
      setTimeout(() => {
        setCopiedAddress(null);
        setShowCopyToast(false);
      }, 2000);
    } catch (err) {
      // Fallback for Safari/older browsers where clipboard API may fail
      console.warn('Clipboard API failed, trying fallback:', err);
      try {
        const textArea = document.createElement('textarea');
        textArea.value = address;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setCopiedAddress(address);
        setShowCopyToast(true);
        setTimeout(() => {
          setCopiedAddress(null);
          setShowCopyToast(false);
        }, 2000);
      } catch (fallbackErr) {
        console.error('Copy failed:', fallbackErr);
      }
    }
  };

  const handleUnlinkWallet = async () => {
    if (!baseUser?.id || !linkedExternalWallet) return;

    setIsUnlinking(true);
    setLinkError(null);
    setLinkSuccess(null);

    try {
      // Use RPC function which bypasses RLS
      const { data, error } = await supabase.rpc('unlink_external_wallet', {
        user_identifier: baseUser.id
      });

      if (error) {
        console.error('Error unlinking wallet:', error);
        setLinkError('Failed to unlink wallet. Please try again.');
        return;
      }

      // RPC returns { success: boolean, message?: string, error?: string }
      const result = data as any;
      if (result?.success) {
        setLinkedExternalWallet(null);
        setLinkSuccess('External wallet unlinked successfully.');
      } else {
        setLinkError(result?.error || 'Failed to unlink wallet. Please try again.');
      }
    } catch (err) {
      console.error('Error unlinking wallet:', err);
      setLinkError('Failed to unlink wallet. Please try again.');
    } finally {
      setIsUnlinking(false);
    }
  };

  const openBlockExplorer = (address: string) => {
    // Base network explorer - use correct domain based on network
    const isMainnet = import.meta.env.VITE_BASE_MAINNET === 'true';
    const explorerDomain = isMainnet ? 'basescan.org' : 'sepolia.basescan.org';
    window.open(`https://${explorerDomain}/address/${address}`, '_blank');
  };

  const getWalletTypeLabel = (wallet: typeof linkedWallets[0]) => {
    // Check for external wallet first (connected via MetaMask, Coinbase Wallet app, etc.)
    if (wallet.isExternalWallet || wallet.walletClient === 'external') {
      return 'External Wallet';
    }
    // Then check for CDP embedded Base wallet
    if (wallet.isEmbeddedWallet || (wallet.isBaseAccount && wallet.walletClient === 'base_account')) {
      return 'Base Account';
    }
    // Legacy checks
    if (wallet.isBaseAccount) return 'Base Account';
    if (wallet.walletClient === 'metamask') return 'MetaMask';
    if (wallet.walletClient === 'coinbase_wallet') return 'Coinbase Wallet';
    if (wallet.walletClient === 'rainbow') return 'Rainbow';
    return wallet.type || 'External Wallet';
  };

  const getWalletIcon = (wallet: typeof linkedWallets[0]) => {
    // External wallets get a different icon
    if (wallet.isExternalWallet || wallet.walletClient === 'external') {
      return <Wallet size={20} className="text-purple-400" />;
    }
    if (wallet.isBaseAccount || wallet.isEmbeddedWallet) {
      return <Shield size={20} className="text-blue-400" />;
    }
    return <Wallet size={20} className="text-white/60" />;
  };

  // Check if user has only an external wallet (no embedded Base wallet)
  const hasOnlyExternalWallet = linkedWallets.length > 0 &&
    linkedWallets.every(w => w.isExternalWallet || w.walletClient === 'external') &&
    !embeddedWallet;

  return (
    <div className="space-y-6">
      {showHeader && (
        <div className="flex items-center justify-between">
          <h2 className="text-white sequel-95 text-xl uppercase">Wallet Management</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettingsPanel(true)}
              className="text-white/60 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-lg"
              title="Wallet Settings"
            >
              <Settings size={20} />
            </button>
            {onClose && (
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Account Balance Section */}
      <div className="bg-gradient-to-r from-[#DDE404]/10 to-[#DDE404]/5 border border-[#DDE404]/30 rounded-xl p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="min-w-0">
            <p className="text-white/60 sequel-45 text-sm uppercase">Top Up Balance</p>
            <p className="text-[#DDE404] sequel-95 text-2xl sm:text-4xl mt-1 truncate">
              ${realTimeLoading ? '...' : realTimeBalance.toFixed(2)}
            </p>
            <p className="text-white/40 sequel-45 text-xs mt-1">
              USD Balance
            </p>
          </div>
          <div className="flex flex-row sm:flex-col gap-3 shrink-0">
            <button
              onClick={() => setShowTopUpModal(true)}
              className="bg-gradient-to-r from-[#DDE404] to-[#C5CC03] hover:from-[#C5CC03] hover:to-[#DDE404] text-black sequel-75 px-6 py-3 rounded-xl flex items-center justify-center gap-2 transition-all duration-300 shadow-lg shadow-[#DDE404]/20 hover:shadow-[#DDE404]/30 hover:scale-[1.02] active:scale-[0.98] flex-1 sm:flex-auto whitespace-nowrap"
            >
              <Plus size={18} />
              <span className="text-sm font-semibold">Top Up</span>
            </button>
            <button
              onClick={() => {
                refreshRealTimeBalance();
                refreshUserData();
              }}
              disabled={realTimeLoading || isLoading}
              className="text-white/60 hover:text-white sequel-45 text-xs flex items-center gap-2 justify-center transition-all px-4 py-2 hover:bg-white/5 rounded-lg disabled:opacity-50"
            >
              <RefreshCw size={14} className={realTimeLoading || isLoading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        {/* First-time bonus indicator - only show if bonus feature is active and user hasn't used bonus yet */}
        {!hasUsedBonus && (
          <div className="bg-[#DDE404] border border-[#DDE404] rounded-lg px-4 py-3">
            <p className="text-black sequel-75 text-sm">50% First Deposit Bonus</p>
          </div>
        )}
      </div>

      {/* Wallet Actions Section - Export & Send */}
      {embeddedWallet && (
        <div className="bg-[#1E1E1E] rounded-xl p-6">
          <h3 className="text-white sequel-75 text-lg mb-4">Wallet Actions</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              onClick={() => setShowSendModal(true)}
              className="bg-gradient-to-r from-[#DDE404] to-[#C5CC03] hover:from-[#C5CC03] hover:to-[#DDE404] text-black sequel-75 py-4 px-6 rounded-xl flex items-center justify-center gap-3 transition-all duration-300 shadow-lg shadow-[#DDE404]/20 hover:shadow-[#DDE404]/30 hover:scale-[1.02] active:scale-[0.98]"
            >
              <Send size={22} />
              <span className="text-base">Send ETH</span>
            </button>
            <button
              onClick={() => setShowExportModal(true)}
              className="bg-[#2A2A2A] hover:bg-[#3A3A3A] text-white sequel-75 py-4 px-6 rounded-xl flex items-center justify-center gap-3 transition-all duration-300 border border-white/10 hover:border-white/20 hover:scale-[1.02] active:scale-[0.98]"
            >
              <Download size={22} className="text-[#DDE404]" />
              <span className="text-base">Export Private Key</span>
            </button>
          </div>
          <div className="mt-4 bg-blue-500 border border-blue-500 rounded-lg px-4 py-3">
            <p className="text-white sequel-45 text-xs">
              Use your embedded wallet to send ETH to other addresses or export your private key to use in other wallet apps like MetaMask.
            </p>
          </div>
        </div>
      )}

      {/* Base Account SDK Status Section - only show if user has a Base Account (not external wallet users) */}
      {(baseAccount || embeddedWallet) && (
        <BaseAccountStatus className="mt-6" />
      )}

      {/* Connected Wallets Section */}
      <div className="bg-[#1E1E1E] rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white sequel-75 text-lg">Connected Wallets</h3>
          <span className="text-white/40 sequel-45 text-sm">{linkedWallets.length + (linkedExternalWallet ? 1 : 0)} connected</span>
        </div>

        {linkError && (
          <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 flex items-start gap-2">
            <AlertCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
            <p className="text-red-400 sequel-45 text-sm">{linkError}</p>
          </div>
        )}

        {linkSuccess && (
          <div className="mb-4 bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3 flex items-start gap-2">
            <Check size={16} className="text-green-400 mt-0.5 flex-shrink-0" />
            <p className="text-green-400 sequel-45 text-sm">{linkSuccess}</p>
          </div>
        )}

        <div className="space-y-3">
          {linkedWallets.map((wallet, index) => (
            <div
              key={wallet.address || index}
              className={`rounded-lg p-4 transition-colors ${
                wallet.isEmbeddedWallet || (wallet.isBaseAccount && !wallet.isExternalWallet)
                  ? 'bg-[#DDE404]/5 border border-[#DDE404]/20'
                  : wallet.isExternalWallet || wallet.walletClient === 'external'
                    ? 'bg-purple-500/10 border border-purple-500/30'
                    : 'bg-[#2A2A2A] hover:bg-[#3A3A3A]'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    wallet.isEmbeddedWallet || (wallet.isBaseAccount && !wallet.isExternalWallet)
                      ? 'bg-[#DDE404]/20'
                      : wallet.isExternalWallet || wallet.walletClient === 'external'
                        ? 'bg-purple-500/20'
                        : 'bg-[#404040]'
                  }`}>
                    {getWalletIcon(wallet)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-white sequel-75 text-sm truncate">{getWalletTypeLabel(wallet)}</p>
                      {(wallet.isEmbeddedWallet || (wallet.isBaseAccount && !wallet.isExternalWallet)) && (
                        <span className="bg-[#DDE404] text-black sequel-75 text-[10px] px-2 py-0.5 rounded flex-shrink-0">
                          PRIMARY
                        </span>
                      )}
                      {(wallet.isExternalWallet || wallet.walletClient === 'external') && (
                        <span className="bg-purple-500 text-white sequel-75 text-[10px] px-2 py-0.5 rounded flex-shrink-0">
                          EXTERNAL
                        </span>
                      )}
                    </div>
                    <p className="text-white/50 sequel-45 text-xs mt-1.5 font-mono truncate">
                      {truncateString(wallet.address, 20)}
                    </p>
                    <p className="text-white/30 sequel-45 text-xs mt-0.5">
                      Base Network
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => handleCopyAddress(wallet.address)}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                    title="Copy address"
                  >
                    {copiedAddress === wallet.address ? (
                      <Check size={16} className="text-green-400" />
                    ) : (
                      <Copy size={16} className="text-white/40 hover:text-white" />
                    )}
                  </button>
                  <button
                    onClick={() => openBlockExplorer(wallet.address)}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                    title="View on BaseScan"
                  >
                    <ExternalLink size={16} className="text-white/40 hover:text-white" />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* Linked External Wallet */}
          {linkedExternalWallet && (
            <div className="rounded-lg p-4 bg-purple-500/10 border border-purple-500/30 transition-colors">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-purple-500/20 flex-shrink-0">
                    <Link size={20} className="text-purple-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-white sequel-75 text-sm">External Wallet</p>
                      <span className="bg-purple-500 text-white sequel-75 text-[10px] px-2 py-0.5 rounded">
                        EXTERNAL
                      </span>
                    </div>
                    <p className="text-white/50 sequel-45 text-xs mt-1 font-mono truncate">
                      {truncateString(linkedExternalWallet, 20)}
                    </p>
                    <p className="text-purple-300/60 sequel-45 text-xs mt-0.5">
                      For display only
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleCopyAddress(linkedExternalWallet)}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                    title="Copy address"
                  >
                    {copiedAddress === linkedExternalWallet ? (
                      <Check size={16} className="text-green-400" />
                    ) : (
                      <Copy size={16} className="text-white/40 hover:text-white" />
                    )}
                  </button>
                  <button
                    onClick={() => openBlockExplorer(linkedExternalWallet)}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                    title="View on BaseScan"
                  >
                    <ExternalLink size={16} className="text-white/40 hover:text-white" />
                  </button>
                  <button
                    onClick={handleUnlinkWallet}
                    disabled={isUnlinking}
                    className="p-2 hover:bg-red-500/20 rounded-lg transition-colors"
                    title="Unlink wallet"
                  >
                    {isUnlinking ? (
                      <RefreshCw size={16} className="text-red-400 animate-spin" />
                    ) : (
                      <Unlink size={16} className="text-red-400 hover:text-red-300" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {linkedWallets.length === 0 && !linkedExternalWallet && (
            <div className="text-center py-8 bg-[#2A2A2A] rounded-lg">
              <Wallet size={40} className="text-white/20 mx-auto mb-3" />
              <p className="text-white/40 sequel-45 text-sm">No wallets connected</p>
              <p className="text-white/30 sequel-45 text-xs mt-1">
                Connect a wallet to start entering competitions
              </p>
            </div>
          )}
        </div>

        {/* Info about wallet limit */}
        {linkedExternalWallet && (
          <div className="mt-4 bg-purple-500/10 border border-purple-500/20 rounded-lg px-4 py-3">
            <p className="text-purple-300/70 sequel-45 text-xs">
              You can link up to one external wallet. To link a different wallet, unlink the current one first.
            </p>
          </div>
        )}
      </div>

      {/* Wallet Token Balances */}
      {primaryWalletAddress && (
        <div className="bg-[#1E1E1E] rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Coins size={20} className="text-[#DDE404]" />
              <h3 className="text-white sequel-75 text-lg">Wallet Tokens</h3>
            </div>
            <button
              onClick={refreshTokens}
              disabled={tokensLoading}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              title="Refresh token balances"
            >
              <RefreshCw size={16} className={`text-white/40 hover:text-white ${tokensLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {tokensLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-8 h-8 border-2 border-[#DDE404]/30 border-t-[#DDE404] rounded-full animate-spin"></div>
            </div>
          ) : tokens.length > 0 ? (
            <div className="space-y-2">
              {tokens.map((token) => (
                <div
                  key={token.address}
                  className="flex items-center justify-between bg-[#2A2A2A] rounded-lg px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    {token.logoUrl ? (
                      <img
                        src={token.logoUrl}
                        alt={token.symbol}
                        className="w-8 h-8 rounded-full"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-[#404040] flex items-center justify-center">
                        <span className="text-xs text-white/60 sequel-75">{token.symbol.slice(0, 2)}</span>
                      </div>
                    )}
                    <div>
                      <p className="text-white sequel-75 text-sm">{token.symbol}</p>
                      <p className="text-white/40 sequel-45 text-xs">{token.name}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-white sequel-75 text-sm">{token.formattedBalance}</p>
                    {token.usdValue && (
                      <p className="text-white/40 sequel-45 text-xs">${token.usdValue.toFixed(2)}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 bg-[#2A2A2A] rounded-lg">
              <Coins size={32} className="text-white/20 mx-auto mb-2" />
              <p className="text-white/40 sequel-45 text-sm">No tokens found</p>
              <p className="text-white/30 sequel-45 text-xs mt-1">
                Top up your wallet to see tokens here
              </p>
            </div>
          )}
        </div>
      )}

      {/* Recent Top-Ups Section - from getUserTransactions */}
      {topUps.length > 0 && (
        <div className="bg-[#1E1E1E] rounded-xl p-6">
          <h3 className="text-white sequel-75 text-lg mb-4">Recent Top-Ups</h3>
          <div className="space-y-2">
            {topUps.slice(0, 5).map(t => (
              <div key={t.id} className="flex items-center justify-between bg-[#2A2A2A] rounded-lg px-4 py-3">
                <div>
                  <p className="text-white sequel-75 text-sm">${t.amount}</p>
                  <p className="text-white/40 sequel-45 text-xs">{t.status}</p>
                </div>
                <p className="text-white/60 sequel-45 text-xs">
                  {new Date(t.created_at).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transaction History Section */}
      <div className="bg-[#1A1A1A] border border-white/10 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <History size={20} className="text-[#DDE404]" />
            <h3 className="text-white sequel-75 text-sm uppercase">Top-Up History</h3>
          </div>
          {transactions.length > 3 && (
            <button
              onClick={() => setShowAllTransactions(!showAllTransactions)}
              className="text-[#DDE404] hover:text-[#DDE404]/80 sequel-75 text-xs uppercase transition-colors"
            >
              {showAllTransactions ? 'Show Less' : 'View All'}
            </button>
          )}
        </div>

        <div className="px-6 py-4">
          {transactionsLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-8 h-8 border-2 border-[#DDE404]/30 border-t-[#DDE404] rounded-full animate-spin"></div>
            </div>
          ) : transactions.length > 0 ? (
            <div className="space-y-3">
              {(showAllTransactions ? transactions : transactions.slice(0, 3)).map((tx) => {
                // Handle null created_at gracefully
                const dateStr = tx.created_at || new Date().toISOString();
                const date = new Date(dateStr);
                const formattedDate = date.toLocaleDateString('en-US', { 
                  month: 'short', 
                  day: 'numeric', 
                  year: 'numeric' 
                });
                const formattedTime = date.toLocaleTimeString('en-US', { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                });

                // Determine if transaction is pending
                const statusLower = (tx.status || '').toLowerCase();
                const isPending = ['pending', 'pending_payment', 'waiting', 'processing'].includes(statusLower);

                return (
                  <div
                    key={tx.id}
                    className={`flex items-center justify-between rounded-lg px-4 py-3 transition-colors ${
                      isPending ? 'bg-yellow-500/10 hover:bg-yellow-500/15 border border-yellow-500/30' : 'bg-[#2A2A2A] hover:bg-[#333]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        isPending ? 'bg-yellow-500/20' : 'bg-green-500/20'
                      }`}>
                        {isPending ? (
                          <Clock size={20} className="text-yellow-400 animate-pulse" />
                        ) : (
                          <ArrowUpRight size={20} className="text-green-400" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-white sequel-75 text-sm">Top-Up</p>
                          {isPending && (
                            <span className="bg-yellow-500/20 text-yellow-400 sequel-75 text-[10px] px-2 py-0.5 rounded">
                              PENDING
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-white/40 sequel-45 text-xs flex items-center gap-1">
                            <Clock size={12} />
                            {formattedDate} • {formattedTime}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`sequel-75 text-sm ${isPending ? 'text-yellow-400' : 'text-green-400'}`}>
                        +${Number(tx.amount || 0).toFixed(2)}
                      </p>
                      <p className="text-white/30 sequel-45 text-xs mt-0.5 capitalize">
                        {tx.payment_provider || 'Coinbase'}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8">
              <History size={32} className="text-white/20 mx-auto mb-2" />
              <p className="text-white/40 sequel-45 text-sm">No transactions yet</p>
              <p className="text-white/30 sequel-45 text-xs mt-1">
                Your top-up history will appear here
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Base Network Info */}
      <div className="bg-blue-500 border border-blue-500 rounded-lg px-4 py-3">
        <div className="flex items-start gap-3">
          <Shield size={20} className="text-white mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-white sequel-75 text-sm">Base Network Powered by Coinbase</p>
            <p className="text-white/90 sequel-45 text-xs mt-1">
              All transactions are processed on Base, an Ethereum L2 network with low fees and fast confirmations.
              Your Base Account is automatically created and secured by Coinbase.
            </p>
          </div>
        </div>
      </div>

      {showTopUpModal && (
        <Suspense fallback={null}>
          <TopUpWalletModal
            isOpen={showTopUpModal}
            onClose={() => setShowTopUpModal(false)}
            onSuccess={() => {
              setShowTopUpModal(false);
              refreshUserData();
            }}
          />
        </Suspense>
      )}

      {/* Export Wallet Key Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/70 flex justify-center items-center z-50 p-4">
          <div className="max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <Suspense fallback={
              <div className="bg-[#1E1E1E] rounded-xl p-6 flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-[#DDE404]/30 border-t-[#DDE404] rounded-full animate-spin"></div>
              </div>
            }>
              <ExportWalletKey onClose={() => setShowExportModal(false)} />
            </Suspense>
          </div>
        </div>
      )}

      {/* Send Transaction Modal */}
      {showSendModal && (
        <div className="fixed inset-0 bg-black/70 flex justify-center items-center z-50 p-4">
          <div className="max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <Suspense fallback={
              <div className="bg-[#1E1E1E] rounded-xl p-6 flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-[#DDE404]/30 border-t-[#DDE404] rounded-full animate-spin"></div>
              </div>
            }>
              <SendTransaction 
                onClose={() => setShowSendModal(false)}
                onSuccess={() => {
                  setShowSendModal(false);
                  refreshUserData();
                  refreshRealTimeBalance();
                }}
              />
            </Suspense>
          </div>
        </div>
      )}

      {/* Copy Toast Notification */}
      {showCopyToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
          <div className="bg-[#DDE404] text-black sequel-75 text-sm px-6 py-3 rounded-lg shadow-lg flex items-center gap-2">
            <Check size={18} />
            <span>Address copied to clipboard!</span>
          </div>
        </div>
      )}

      {/* Wallet Settings Panel */}
      {showSettingsPanel && (
        <Suspense fallback={null}>
          <WalletSettingsPanel onClose={() => setShowSettingsPanel(false)} />
        </Suspense>
      )}
    </div>
  );
};

export default WalletManagement;
