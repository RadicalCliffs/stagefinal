import { ChevronDown, ChevronRight, WalletCards, Plus, LayoutDashboard, Bell, ExternalLink, Check, Copy, Coins, RefreshCw } from 'lucide-react'
import { useAuthUser } from '../contexts/AuthContext'
import { userDataService } from '../services/userDataService'
import { useMemo, useState, useEffect, useRef, lazy, Suspense } from 'react'
import { truncateString } from '../utils/util'
import { useNavigate } from 'react-router'
import { notificationService } from '../lib/notification-service'
import { avatar as localDefaultAvatar } from '../assets/images'
import { useWalletTokens } from '../hooks/useWalletTokens'
import { useRealTimeBalance } from '../hooks/useRealTimeBalance'

// Lazy load TopUpWalletModal - only loaded when user clicks "Top Up"
const TopUpWalletModal = lazy(() => import('./TopUpWalletModal'))

const LoggedInUserBtn = () => {
  const { profile, entryCount, linkedWallets, isLoading, refreshUserData, logout, baseUser } = useAuthUser();
  // Use real-time balance from useRealTimeBalance for live updates instead of walletBalance from AuthContext
  // walletBalance from AuthContext only updates on refresh, while useRealTimeBalance has Supabase subscriptions
  const { balance: realTimeBalance, isLoading: realTimeLoading, refresh: refreshRealTimeBalance } = useRealTimeBalance();
  const navigate = useNavigate();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [primaryWalletIndex, setPrimaryWalletIndex] = useState(0);
  const [avatarError, setAvatarError] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Get connected wallets from AuthContext (Base wallets)
  const connectedWallets = linkedWallets || [];
  const primaryWallet = connectedWallets[primaryWalletIndex] || connectedWallets[0];
  // Get email from database profile
  const primaryEmail = profile?.email || baseUser?.email || '';

  // Get display name - show username if set, otherwise email (never show "no username")
  // Priority: 1) DB profile username, 2) Email address (truncated), 3) Wallet address (truncated)
  const displayName = useMemo(() => {
    if (profile?.username && profile.username.trim() !== '') {
      return profile.username;
    }
    if (primaryEmail && primaryEmail !== '') {
      // Truncate email if too long
      return primaryEmail.length > 20 ? primaryEmail.slice(0, 17) + '...' : primaryEmail;
    }
    if (primaryWallet?.address) {
      return truncateString(primaryWallet.address, 8);
    }
    return 'My Account';
  }, [profile?.username, primaryEmail, primaryWallet?.address]);

  // Helper function to get a friendly wallet label
  const getWalletLabel = (walletAccount: any): string => {
    const walletClientType = walletAccount.walletClient || walletAccount.type;

    // Base Account (Coinbase Smart Wallet)
    if (walletClientType === 'base_account') {
      return 'Base Account';
    }

    // Other known wallet types
    if (walletClientType === 'coinbase_wallet') {
      return 'Coinbase Wallet';
    }
    if (walletClientType === 'metamask') {
      return 'MetaMask';
    }
    if (walletClientType === 'rainbow') {
      return 'Rainbow';
    }
    if (walletClientType === 'wallet_connect') {
      return 'WalletConnect';
    }

    // Fallback
    return walletClientType || 'Wallet';
  };

  // Fetch token balances for the primary wallet
  const { tokens, isLoading: tokensLoading, refresh: refreshTokens, error: tokensError } = useWalletTokens(primaryWallet?.address);

  const avatarUrl = useMemo(() => {
    if (avatarError) return localDefaultAvatar;
    if (profile?.avatar_url) {
      // Cache the avatar URL when we have it from the profile
      userDataService.cacheAvatarUrl(profile.avatar_url);
      return profile.avatar_url;
    }
    // Use cached avatar as fallback to prevent visual swapping during navigation
    // This prevents the jarring experience of seeing the default avatar briefly
    // while the profile is reloading after page transitions
    const cachedAvatar = userDataService.getCachedAvatarUrl();
    if (cachedAvatar) return cachedAvatar;
    // Final fallback: use the default avatar (new users or cleared cache)
    return userDataService.getDefaultAvatar();
  }, [profile?.avatar_url, avatarError]);

  const handleLogout = async () => {
    try {
      await logout();
      // Storage clearing and redirect is handled by the logout function in AuthContext
    } catch (error) {
      console.error('Logout error:', error);
      alert('Logout failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  const handleCopyAddress = async (address: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(address);
      setTimeout(() => setCopiedAddress(null), 2000);
    } catch (err) {
      // Fallback for Safari/older browsers where clipboard API may fail
      console.warn('[LoggedInUserBtn] Clipboard API failed, trying fallback:', err);
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
        setTimeout(() => setCopiedAddress(null), 2000);
      } catch (fallbackErr) {
        console.error('[LoggedInUserBtn] Copy failed:', fallbackErr);
      }
    }
  };

  const handleSetPrimaryWallet = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setPrimaryWalletIndex(index);
    // Store in localStorage for persistence
    localStorage.setItem('primaryWalletIndex', String(index));
  };

  // Load primary wallet index from localStorage on mount
  useEffect(() => {
    const savedIndex = localStorage.getItem('primaryWalletIndex');
    if (savedIndex !== null) {
      const index = parseInt(savedIndex, 10);
      if (!isNaN(index) && index < connectedWallets.length) {
        setPrimaryWalletIndex(index);
      }
    }
  }, [connectedWallets.length]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDropdown]);

  useEffect(() => {
    if (!baseUser?.id) return;

    const fetchUnreadCount = async () => {
      const count = await notificationService.getUnreadCount(baseUser.id);
      setUnreadCount(count);
    };

    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000);

    return () => clearInterval(interval);
  }, [baseUser]);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Main Button */}
      <div
        className="bg-[#DDE404] overflow-hidden rounded-lg cursor-pointer relative hover:bg-[#DDE404]/90 transition-colors"
        onClick={() => setShowDropdown(!showDropdown)}
      >
        {unreadCount > 0 && (
          <div className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full min-w-[20px] h-[20px] flex items-center justify-center text-xs sequel-75 px-1 z-10 border-2 border-[#1A1A1A]">
            {unreadCount > 99 ? '99+' : unreadCount}
          </div>
        )}
        <div className="flex items-stretch">
          <div className="px-1.5 py-1 flex items-center border-r border-[#1A1A1A]/10">
            <img src={avatarUrl} alt="avatar" className="w-10 h-10 rounded-md object-cover" onError={() => setAvatarError(true)} />
          </div>
          <div className="flex flex-col justify-center px-3 py-1.5">
            <div className="flex items-center gap-1.5">
              <span className="sequel-75 text-[#1A1A1A] text-xs">{displayName}</span>
              <ChevronRight size={14} className={`text-[#1A1A1A] transition-transform ${showDropdown ? 'rotate-90' : ''}`} />
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <WalletCards size={14} className="text-[#1A1A1A]" />
              <span className="sequel-95 text-[#1A1A1A] text-sm">${realTimeLoading ? '...' : realTimeBalance.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Dropdown Menu - Improved mobile and desktop design */}
      {showDropdown && (
        <>
          {/* Mobile overlay backdrop */}
          <div className="fixed inset-0 bg-black/50 z-[99] sm:hidden" onClick={() => setShowDropdown(false)} />

          <div className="fixed sm:absolute inset-x-0 sm:inset-x-auto bottom-0 sm:bottom-auto sm:top-full sm:right-0 sm:mt-2 bg-[#1A1A1A] rounded-t-2xl sm:rounded-xl shadow-2xl z-[100] w-full sm:w-[380px] md:w-[420px] border border-[#2A2A2A] overflow-hidden max-h-[85vh] sm:max-h-[80vh] flex flex-col">
          {/* Mobile drag handle */}
          <div className="sm:hidden w-full py-2 flex justify-center">
            <div className="w-12 h-1 bg-white/20 rounded-full"></div>
          </div>

          {/* Header */}
          <div className="bg-gradient-to-r from-[#2A2A2A] to-[#232323] p-4 flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <img src={avatarUrl} alt="avatar" className="w-12 h-12 rounded-lg object-cover border-2 border-[#DDE404]" onError={() => setAvatarError(true)} />
              <div className="flex-1 min-w-0">
                <p className="sequel-95 text-white text-sm truncate">{displayName}</p>
                <p className="sequel-45 text-white/60 text-xs mt-0.5 truncate">{primaryEmail || truncateString(primaryWallet?.address, 16)}</p>
                <p className="sequel-45 text-[#DDE404] text-xs mt-0.5">{entryCount} active entries</p>
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowDropdown(false);
              }}
              className="text-gray-400 hover:text-white p-1.5 hover:bg-white/10 rounded-lg transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          </div>

          {/* Account Balance - Prominent Display */}
          <div className="p-4 bg-[#DDE404]/5 border-b border-[#2A2A2A]">
            <div className="flex items-center justify-between">
              <div>
                <p className="sequel-45 text-white/60 text-xs uppercase">Account Balance</p>
                <p className="sequel-95 text-[#DDE404] text-3xl mt-1">
                  ${realTimeLoading ? '...' : realTimeBalance.toFixed(2)}
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowTopUpModal(true);
                }}
                className="bg-[#DDE404] hover:bg-[#DDE404]/90 text-[#1A1A1A] sequel-75 text-sm px-4 py-2.5 rounded-lg transition-colors flex items-center gap-2"
              >
                <Plus size={16} />
                Top Up
              </button>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="p-3 grid grid-cols-2 gap-2 border-b border-[#2A2A2A]">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowDropdown(false);
                navigate('/dashboard');
              }}
              className="flex items-center gap-2 px-3 py-2.5 bg-[#2A2A2A] hover:bg-[#3A3A3A] rounded-lg transition-colors"
            >
              <LayoutDashboard size={18} className="text-[#DDE404]" />
              <span className="sequel-75 text-white text-xs">Dashboard</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowDropdown(false);
                navigate('/dashboard/notifications');
              }}
              className="flex items-center gap-2 px-3 py-2.5 bg-[#2A2A2A] hover:bg-[#3A3A3A] rounded-lg transition-colors relative"
            >
              <Bell size={18} className="text-[#DDE404]" />
              <span className="sequel-75 text-white text-xs">Notifications</span>
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center text-[10px] sequel-75">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
          </div>

          {/* Connected Wallets - scrollable section */}
          <div className="p-4 flex-1 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <span className="sequel-75 text-white text-sm">Connected Wallets</span>
              <span className="sequel-45 text-white/40 text-xs">{connectedWallets.length} connected</span>
            </div>

            {connectedWallets.length > 0 ? (
              <div className="space-y-2">
                {connectedWallets.map((walletAccount: any, index: number) => {
                  const isPrimary = index === primaryWalletIndex;
                  const isCopied = copiedAddress === walletAccount.address;

                  return (
                    <div
                      key={walletAccount.address || index}
                      className={`rounded-lg p-3 transition-colors ${
                        isPrimary
                          ? 'bg-[#DDE404]/10 border border-[#DDE404]/30'
                          : 'bg-[#2A2A2A] hover:bg-[#3A3A3A] border border-transparent'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                            isPrimary ? 'bg-[#DDE404]' : 'bg-[#404040]'
                          }`}>
                            <WalletCards size={16} className={isPrimary ? 'text-[#1A1A1A]' : 'text-white'} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="sequel-75 text-white text-xs">
                                {getWalletLabel(walletAccount)}
                              </p>
                              {isPrimary && (
                                <span className="bg-[#DDE404] text-[#1A1A1A] sequel-75 text-[10px] px-1.5 py-0.5 rounded">
                                  PRIMARY
                                </span>
                              )}
                            </div>
                            <p className="sequel-45 text-white/50 text-xs truncate">
                              {truncateString(walletAccount.address || '', 20)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => handleCopyAddress(walletAccount.address || '', e)}
                            className="p-1.5 hover:bg-white/10 rounded-md transition-colors"
                            title="Copy address"
                          >
                            {isCopied ? (
                              <Check size={14} className="text-green-400" />
                            ) : (
                              <Copy size={14} className="text-white/40 hover:text-white" />
                            )}
                          </button>
                          {!isPrimary && (
                            <button
                              onClick={(e) => handleSetPrimaryWallet(index, e)}
                              className="sequel-45 text-[#DDE404] text-[10px] px-2 py-1 hover:bg-[#DDE404]/10 rounded-md transition-colors"
                              title="Set as primary wallet"
                            >
                              Set Primary
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Token Balances for Primary Wallet */}
                      {isPrimary && (
                        <div className="mt-3 pt-3 border-t border-[#DDE404]/20">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-1.5">
                              <Coins size={12} className="text-[#DDE404]" />
                              <span className="sequel-75 text-white/70 text-[10px] uppercase">Wallet Tokens</span>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                refreshTokens();
                              }}
                              className="p-1 hover:bg-white/10 rounded transition-colors"
                              title="Refresh balances"
                            >
                              <RefreshCw size={10} className={`text-white/40 hover:text-white ${tokensLoading ? 'animate-spin' : ''}`} />
                            </button>
                          </div>

                          {tokensLoading ? (
                            <div className="flex items-center justify-center py-2">
                              <div className="w-4 h-4 border-2 border-[#DDE404]/30 border-t-[#DDE404] rounded-full animate-spin"></div>
                            </div>
                          ) : tokens.length > 0 ? (
                            <div className="space-y-1.5">
                              {tokens.map((token) => (
                                <div
                                  key={token.address}
                                  className="flex items-center justify-between bg-[#1A1A1A]/50 rounded-md px-2 py-1.5"
                                >
                                  <div className="flex items-center gap-2">
                                    {token.logoUrl ? (
                                      <img
                                        src={token.logoUrl}
                                        alt={token.symbol}
                                        className="w-5 h-5 rounded-full"
                                        onError={(e) => {
                                          (e.target as HTMLImageElement).style.display = 'none';
                                        }}
                                      />
                                    ) : (
                                      <div className="w-5 h-5 rounded-full bg-[#404040] flex items-center justify-center">
                                        <span className="text-[8px] text-white/60 sequel-75">{token.symbol.slice(0, 2)}</span>
                                      </div>
                                    )}
                                    <span className="sequel-75 text-white text-[11px]">{token.symbol}</span>
                                  </div>
                                  <span className="sequel-45 text-white/70 text-[11px]">{token.formattedBalance}</span>
                                </div>
                              ))}
                            </div>
                          ) : tokensError ? (
                            <div className="text-center py-2">
                              <p className="sequel-45 text-red-400/70 text-[10px]">Error loading tokens</p>
                              <p className="sequel-45 text-white/30 text-[9px] mt-0.5">{tokensError}</p>
                            </div>
                          ) : (
                            <p className="sequel-45 text-white/40 text-[10px] text-center py-2">No tokens found</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-6 bg-[#2A2A2A] rounded-lg">
                <WalletCards size={32} className="text-white/20 mx-auto mb-2" />
                <p className="sequel-45 text-white/40 text-sm">No wallets connected</p>
              </div>
            )}

          </div>

          {/* Action Buttons */}
          <div className="p-3 border-t border-[#2A2A2A] space-y-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                alert('Export wallet functionality coming soon');
              }}
              className="w-full bg-[#2A2A2A] hover:bg-[#3A3A3A] text-white sequel-75 py-2.5 rounded-lg transition-colors text-sm"
            >
              Export Wallet
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleLogout();
              }}
              className="w-full bg-[#EF008F] hover:bg-[#EF008F]/90 text-white sequel-95 uppercase py-2.5 rounded-lg transition-colors text-sm"
            >
              Log Out
            </button>
          </div>
        </div>
        </>
      )}

      {showTopUpModal && (
        <Suspense fallback={null}>
          <TopUpWalletModal
            isOpen={showTopUpModal}
            onClose={() => setShowTopUpModal(false)}
            onSuccess={() => {
              setShowTopUpModal(false);
              refreshRealTimeBalance();
              refreshUserData();
            }}
          />
        </Suspense>
      )}
    </div>
  )
}

export default LoggedInUserBtn
