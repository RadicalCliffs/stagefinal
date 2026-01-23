/**
 * Base Account Status Component
 * 
 * Displays the current Base Account SDK session status and account information.
 * Shows connected account address, session state, and provides controls for
 * managing the Base Account session.
 * 
 * Features:
 * - Display connected account address from SDK
 * - Show active session status
 * - Refresh session button
 * - Copy address functionality
 * - Sign-out control (if applicable)
 */

import { useState } from 'react';
import { useBaseAccountSDK } from '../contexts/BaseAccountSDKContext';
import { Copy, Check, RefreshCw, LogOut, Shield } from 'lucide-react';
import { truncateString } from '../utils/util';

interface BaseAccountStatusProps {
  /** Whether to show full controls or just status */
  compact?: boolean;
  /** Custom CSS class */
  className?: string;
}

export function BaseAccountStatus({ compact = false, className = '' }: BaseAccountStatusProps) {
  const { sdk, hasSession, account, refreshSession, isReady, error } = useBaseAccountSDK();
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  /**
   * Copy account address to clipboard
   */
  const handleCopyAddress = async () => {
    if (!account?.address) return;

    try {
      await navigator.clipboard.writeText(account.address);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  /**
   * Refresh the session state
   */
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshSession();
    } catch (err) {
      console.error('Failed to refresh session:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Don't render if SDK is not ready
  if (!isReady) {
    return (
      <div className={`p-4 bg-gray-800/50 rounded-lg ${className}`}>
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <Shield className="w-4 h-4 animate-pulse" />
          <span>Initializing Base Account SDK...</span>
        </div>
      </div>
    );
  }

  // Show error if SDK failed to initialize
  if (error) {
    return (
      <div className={`p-4 bg-red-900/20 border border-red-500/50 rounded-lg ${className}`}>
        <div className="flex items-center gap-2 text-red-400 text-sm">
          <Shield className="w-4 h-4" />
          <span>SDK Error: {error.message}</span>
        </div>
      </div>
    );
  }

  // Compact mode - just show session status
  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Shield className={`w-4 h-4 ${hasSession ? 'text-green-400' : 'text-gray-400'}`} />
        <span className="text-sm text-gray-300">
          {hasSession ? 'Base Account Active' : 'No Active Session'}
        </span>
      </div>
    );
  }

  // Full mode - show account details and controls
  return (
    <div className={`p-4 bg-gray-800/50 rounded-lg ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Shield className={`w-5 h-5 ${hasSession ? 'text-green-400' : 'text-gray-400'}`} />
          <span className="font-semibold text-white">Base Account SDK</span>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="p-1.5 rounded-lg hover:bg-gray-700/50 transition-colors disabled:opacity-50"
          title="Refresh session"
        >
          <RefreshCw className={`w-4 h-4 text-gray-400 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Session Status */}
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-1">
          <div className={`w-2 h-2 rounded-full ${hasSession ? 'bg-green-400' : 'bg-gray-400'}`} />
          <span className="text-sm text-gray-300">
            {hasSession ? 'Active Session' : 'No Active Session'}
          </span>
        </div>
      </div>

      {/* Account Address */}
      {account?.address && (
        <div className="space-y-2">
          <div className="text-xs text-gray-400 uppercase tracking-wide">Account Address</div>
          <div className="flex items-center gap-2 p-2 bg-gray-900/50 rounded-lg">
            <code className="flex-1 text-sm font-mono text-gray-300 overflow-hidden text-ellipsis">
              {truncateString(account.address, 12, 10)}
            </code>
            <button
              onClick={handleCopyAddress}
              className="p-1.5 rounded hover:bg-gray-700/50 transition-colors"
              title="Copy address"
            >
              {copiedAddress ? (
                <Check className="w-4 h-4 text-green-400" />
              ) : (
                <Copy className="w-4 h-4 text-gray-400" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Public Key (if available) */}
      {account?.publicKey && (
        <div className="space-y-2 mt-3">
          <div className="text-xs text-gray-400 uppercase tracking-wide">Public Key</div>
          <div className="p-2 bg-gray-900/50 rounded-lg">
            <code className="text-xs font-mono text-gray-400 break-all">
              {truncateString(account.publicKey, 16, 16)}
            </code>
          </div>
        </div>
      )}

      {/* SDK Info */}
      <div className="mt-4 pt-4 border-t border-gray-700">
        <div className="text-xs text-gray-500">
          SDK Status: <span className="text-gray-400">{isReady ? 'Ready' : 'Not Ready'}</span>
        </div>
        <div className="text-xs text-gray-500 mt-1">
          Provider: <span className="text-gray-400">{sdk ? 'Available' : 'Not Available'}</span>
        </div>
      </div>
    </div>
  );
}

export default BaseAccountStatus;
