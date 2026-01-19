import React, { useState, useCallback } from 'react';
import { X, Wallet, Settings, RefreshCw, LogOut, Shield, AlertCircle, CheckCircle, ExternalLink } from 'lucide-react';
import { useAuthUser } from '../../contexts/AuthContext';
import { useCurrentUser, useSignOut } from '@coinbase/cdp-hooks';
import { ConnectWallet, Wallet as WalletComponent, WalletDropdown } from '@coinbase/onchainkit/wallet';
import { Identity, Avatar, Name, Address } from '@coinbase/onchainkit/identity';
import { useAccount, useDisconnect } from 'wagmi';
import { truncateString } from '../../utils/util';

interface WalletSettingsPanelProps {
  onClose: () => void;
}

/**
 * WalletSettingsPanel - Comprehensive Wallet Management UI
 * 
 * Features:
 * - View all connected wallets (CDP embedded + external)
 * - Switch between wallets
 * - Disconnect/reconnect wallets
 * - View wallet details and balances
 * - Access CDP/OnchainKit wallet settings
 */
export const WalletSettingsPanel: React.FC<WalletSettingsPanelProps> = ({ onClose }) => {
  const { baseUser, linkedWallets, baseAccount, embeddedWallet, logout, refreshUserData } = useAuthUser();
  const { currentUser } = useCurrentUser();
  const { signOut } = useSignOut();
  const { address: wagmiAddress, isConnected: wagmiIsConnected } = useAccount();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleDisconnectCDP = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    
    try {
      await signOut();
      setSuccess('CDP wallet disconnected successfully');
      
      // Refresh user data after disconnect completes
      await refreshUserData();
    } catch (err) {
      console.error('[WalletSettings] CDP disconnect error:', err);
      setError('Failed to disconnect CDP wallet');
    } finally {
      setIsLoading(false);
    }
  }, [signOut, refreshUserData]);

  const handleDisconnectExternal = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    
    try {
      wagmiDisconnect();
      setSuccess('External wallet disconnected successfully');
      
      // Refresh user data after disconnect completes
      await refreshUserData();
    } catch (err) {
      console.error('[WalletSettings] External disconnect error:', err);
      setError('Failed to disconnect external wallet');
    } finally {
      setIsLoading(false);
    }
  }, [wagmiDisconnect, refreshUserData]);

  const handleFullLogout = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      await logout();
      onClose();
    } catch (err) {
      console.error('[WalletSettings] Logout error:', err);
      setError('Failed to log out');
      setIsLoading(false);
    }
  }, [logout, onClose]);

  const openBlockExplorer = (address: string) => {
    const isMainnet = import.meta.env.VITE_BASE_MAINNET === 'true';
    const explorerDomain = isMainnet ? 'basescan.org' : 'sepolia.basescan.org';
    const newWindow = window.open(`https://${explorerDomain}/address/${address}`, '_blank', 'noopener,noreferrer');
    // Additional security for older browsers
    if (newWindow) {
      newWindow.opener = null;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999] p-4">
      <div className="bg-[#101010] border border-white/10 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-[#101010] border-b border-white/10 p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#DDE404] rounded-full flex items-center justify-center">
              <Settings size={20} className="text-black" />
            </div>
            <h2 className="text-white sequel-95 text-xl uppercase">Wallet Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Status Messages */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 flex items-start gap-2">
              <AlertCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
              <p className="text-red-400 sequel-45 text-sm">{error}</p>
            </div>
          )}
          
          {success && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3 flex items-start gap-2">
              <CheckCircle size={16} className="text-green-400 mt-0.5 flex-shrink-0" />
              <p className="text-green-400 sequel-45 text-sm">{success}</p>
            </div>
          )}

          {/* Current User Info */}
          {baseUser && (
            <div className="bg-[#1E1E1E] rounded-xl p-5">
              <h3 className="text-white sequel-75 text-sm uppercase mb-4">Current Account</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-white/50 sequel-45 text-xs mb-1">Wallet Address</p>
                  <div className="flex items-center gap-2">
                    <p className="text-white sequel-75 text-sm font-mono">{truncateString(baseUser.id, 24)}</p>
                    <button
                      onClick={() => openBlockExplorer(baseUser.id)}
                      className="text-[#DDE404] hover:text-[#DDE404]/80"
                      title="View on BaseScan"
                    >
                      <ExternalLink size={14} />
                    </button>
                  </div>
                </div>
                {baseUser.email && (
                  <div>
                    <p className="text-white/50 sequel-45 text-xs mb-1">Email</p>
                    <p className="text-white sequel-75 text-sm">{baseUser.email}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Connected Wallets Section */}
          <div className="bg-[#1E1E1E] rounded-xl p-5">
            <h3 className="text-white sequel-75 text-sm uppercase mb-4">Connected Wallets</h3>
            <div className="space-y-3">
              {linkedWallets.map((wallet, index) => (
                <div
                  key={wallet.address || index}
                  className={`rounded-lg p-4 transition-colors ${
                    wallet.isEmbeddedWallet || (wallet.isBaseAccount && !wallet.isExternalWallet)
                      ? 'bg-[#DDE404]/5 border border-[#DDE404]/20'
                      : 'bg-[#2A2A2A] hover:bg-[#3A3A3A]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        wallet.isEmbeddedWallet || (wallet.isBaseAccount && !wallet.isExternalWallet)
                          ? 'bg-[#DDE404]/20'
                          : 'bg-[#404040]'
                      }`}>
                        {wallet.isEmbeddedWallet || (wallet.isBaseAccount && !wallet.isExternalWallet) ? (
                          <Shield size={16} className="text-[#DDE404]" />
                        ) : (
                          <Wallet size={16} className="text-white/60" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-white sequel-75 text-sm">
                            {wallet.isEmbeddedWallet || (wallet.isBaseAccount && !wallet.isExternalWallet) 
                              ? 'Base Account' 
                              : wallet.type || 'External Wallet'}
                          </p>
                          {(wallet.isEmbeddedWallet || (wallet.isBaseAccount && !wallet.isExternalWallet)) && (
                            <span className="bg-[#DDE404] text-black sequel-75 text-[10px] px-2 py-0.5 rounded">
                              PRIMARY
                            </span>
                          )}
                        </div>
                        <p className="text-white/50 sequel-45 text-xs mt-0.5 font-mono">
                          {truncateString(wallet.address, 20)}
                        </p>
                      </div>
                    </div>
                    
                    <button
                      onClick={() => openBlockExplorer(wallet.address)}
                      className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                      title="View on BaseScan"
                    >
                      <ExternalLink size={14} className="text-white/40 hover:text-white" />
                    </button>
                  </div>
                </div>
              ))}

              {linkedWallets.length === 0 && (
                <div className="text-center py-8 bg-[#2A2A2A] rounded-lg">
                  <Wallet size={32} className="text-white/20 mx-auto mb-2" />
                  <p className="text-white/40 sequel-45 text-sm">No wallets connected</p>
                </div>
              )}
            </div>
          </div>

          {/* Connect Additional Wallet */}
          <div className="bg-[#1E1E1E] rounded-xl p-5">
            <h3 className="text-white sequel-75 text-sm uppercase mb-4">Connect Additional Wallet</h3>
            <p className="text-white/60 sequel-45 text-xs mb-4">
              Connect another wallet to use with your account. This is useful if you want to switch between different wallets.
            </p>
            
            <div className="w-full">
              <WalletComponent>
                <ConnectWallet 
                  className="w-full bg-[#0052FF] hover:bg-[#0052FF]/90 text-white sequel-75 py-3 px-6 rounded-lg flex items-center justify-center gap-2 transition-colors"
                  aria-label="Connect additional wallet to your account"
                >
                  <Wallet size={18} />
                  <span>Connect Wallet</span>
                </ConnectWallet>
                <WalletDropdown>
                  <Identity className="px-4 pt-3 pb-2" hasCopyAddressOnClick>
                    <Avatar />
                    <Name />
                    <Address />
                  </Identity>
                </WalletDropdown>
              </WalletComponent>
            </div>

            <div className="mt-3 bg-blue-500/10 border border-blue-500/20 rounded-lg px-4 py-3">
              <p className="text-blue-300/70 sequel-45 text-xs">
                You can connect multiple wallets to your account. Your primary wallet is your Base Account (CDP embedded wallet).
              </p>
            </div>
          </div>

          {/* Wallet Management Actions */}
          <div className="bg-[#1E1E1E] rounded-xl p-5">
            <h3 className="text-white sequel-75 text-sm uppercase mb-4">Management Actions</h3>
            <div className="space-y-3">
              {/* Disconnect CDP Wallet */}
              {(embeddedWallet || baseAccount) && currentUser && (
                <button
                  onClick={handleDisconnectCDP}
                  disabled={isLoading}
                  className="w-full bg-[#2A2A2A] hover:bg-[#3A3A3A] disabled:bg-[#1A1A1A] text-white sequel-75 py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isLoading ? (
                    <RefreshCw size={16} className="animate-spin" />
                  ) : (
                    <LogOut size={16} />
                  )}
                  <span>Disconnect CDP Wallet</span>
                </button>
              )}

              {/* Disconnect External Wallet */}
              {wagmiIsConnected && (
                <button
                  onClick={handleDisconnectExternal}
                  disabled={isLoading}
                  className="w-full bg-[#2A2A2A] hover:bg-[#3A3A3A] disabled:bg-[#1A1A1A] text-white sequel-75 py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isLoading ? (
                    <RefreshCw size={16} className="animate-spin" />
                  ) : (
                    <LogOut size={16} />
                  )}
                  <span>Disconnect External Wallet</span>
                </button>
              )}

              {/* Refresh Connection */}
              <button
                onClick={async () => {
                  setIsLoading(true);
                  setError(null);
                  setSuccess(null);
                  try {
                    await refreshUserData();
                    setSuccess('Connection refreshed successfully');
                  } catch (err) {
                    console.error('[WalletSettings] Refresh error:', err);
                    setError('Failed to refresh connection. Please try again.');
                  } finally {
                    setIsLoading(false);
                  }
                }}
                disabled={isLoading}
                className="w-full bg-[#2A2A2A] hover:bg-[#3A3A3A] disabled:bg-[#1A1A1A] text-white sequel-75 py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
                <span>Refresh Connection</span>
              </button>

              {/* Full Logout */}
              <button
                onClick={handleFullLogout}
                disabled={isLoading}
                className="w-full bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 sequel-75 py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                <LogOut size={16} />
                <span>Log Out Completely</span>
              </button>
            </div>
          </div>

          {/* Information Panel */}
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Shield size={20} className="text-blue-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-blue-400 sequel-75 text-sm mb-1">About Wallet Management</p>
                <p className="text-blue-300/70 sequel-45 text-xs">
                  Your Base Account is your primary wallet powered by Coinbase. You can connect additional external wallets (MetaMask, Coinbase Wallet, etc.) to use with your account. All wallets will have access to your account balance and entries.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WalletSettingsPanel;
