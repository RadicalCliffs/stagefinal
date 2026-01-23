/**
 * Spend Permission Manager Component
 * 
 * UI for managing Base Spend Permissions - allows users to view, create, and revoke
 * spend permissions for one-click payments.
 * 
 * Features:
 * - Display active spend permission details
 * - Show allowance and period information
 * - Request new spend permissions
 * - Revoke existing permissions
 * - Visual indicators for permission status
 */

import { useState } from 'react';
import { useSpendPermission } from '../hooks/useSpendPermission';
import { Shield, Check, X, AlertCircle, Clock, DollarSign, RefreshCw, Trash2 } from 'lucide-react';

interface SpendPermissionManagerProps {
  /** Whether to show in compact mode */
  compact?: boolean;
  /** Custom CSS class */
  className?: string;
}

export function SpendPermissionManager({ compact = false, className = '' }: SpendPermissionManagerProps) {
  const {
    isSupported,
    isLoading,
    activePermission,
    hasPermission,
    currentPeriodSpend,
    requestPermission,
    revokePermission,
    canSpend,
    error,
  } = useSpendPermission();

  const [isRequesting, setIsRequesting] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [operationSuccess, setOperationSuccess] = useState<string | null>(null);

  /**
   * Request a new spend permission
   */
  const handleRequestPermission = async () => {
    setIsRequesting(true);
    setOperationError(null);
    setOperationSuccess(null);

    try {
      const permission = await requestPermission({
        allowanceUSD: 500, // $500 per period
        periodInDays: 30, // Monthly
        validityDays: 365, // Valid for 1 year
      });

      if (permission) {
        setOperationSuccess('Spend permission granted successfully!');
        setTimeout(() => setOperationSuccess(null), 3000);
      } else {
        setOperationError('Failed to grant permission. Please try again.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to request permission';
      setOperationError(message);
    } finally {
      setIsRequesting(false);
    }
  };

  /**
   * Revoke the active spend permission
   */
  const handleRevokePermission = async () => {
    if (!confirm('Are you sure you want to revoke this spend permission? You will need to grant it again for one-click payments.')) {
      return;
    }

    setIsRevoking(true);
    setOperationError(null);
    setOperationSuccess(null);

    try {
      const success = await revokePermission();

      if (success) {
        setOperationSuccess('Spend permission revoked successfully.');
        setTimeout(() => setOperationSuccess(null), 3000);
      } else {
        setOperationError('Failed to revoke permission. Please try again.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to revoke permission';
      setOperationError(message);
    } finally {
      setIsRevoking(false);
    }
  };

  /**
   * Format date for display
   */
  const formatDate = (date: Date): string => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  };

  /**
   * Format USDC amount for display
   */
  const formatUSDC = (amount: bigint): string => {
    // USDC has 6 decimals
    const usdcAmount = Number(amount) / 1_000_000;
    return `$${usdcAmount.toFixed(2)}`;
  };

  // Don't show if not supported
  if (!isSupported) {
    return null;
  }

  // Compact mode - just show status
  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Shield className={`w-4 h-4 ${hasPermission ? 'text-green-400' : 'text-gray-400'}`} />
        <span className="text-sm text-gray-300">
          {hasPermission ? 'One-Click Enabled' : 'One-Click Disabled'}
        </span>
      </div>
    );
  }

  // Full mode - show permission details and controls
  return (
    <div className={`p-4 bg-gray-800/50 rounded-lg ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Shield className={`w-5 h-5 ${hasPermission ? 'text-green-400' : 'text-gray-400'}`} />
          <span className="font-semibold text-white">One-Click Payments</span>
        </div>
        <div className={`px-2 py-1 rounded text-xs font-medium ${
          hasPermission ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'
        }`}>
          {hasPermission ? 'Enabled' : 'Disabled'}
        </div>
      </div>

      {/* Error Message */}
      {(error || operationError) && (
        <div className="mb-4 p-3 bg-red-900/20 border border-red-500/50 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-400">{error || operationError}</p>
        </div>
      )}

      {/* Success Message */}
      {operationSuccess && (
        <div className="mb-4 p-3 bg-green-900/20 border border-green-500/50 rounded-lg flex items-start gap-2">
          <Check className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-green-400">{operationSuccess}</p>
        </div>
      )}

      {/* No Permission - Show Enable Button */}
      {!hasPermission && (
        <div className="space-y-3">
          <p className="text-sm text-gray-400">
            Enable one-click payments to skip wallet confirmations for each transaction.
            You'll grant permission once, and subsequent payments will be instant.
          </p>
          <button
            onClick={handleRequestPermission}
            disabled={isRequesting || isLoading}
            className="w-full bg-gradient-to-r from-[#DDE404] to-[#C5CC03] hover:from-[#C5CC03] hover:to-[#DDE404] text-black font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRequesting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Requesting Permission...</span>
              </>
            ) : (
              <>
                <Shield className="w-4 h-4" />
                <span>Enable One-Click Payments</span>
              </>
            )}
          </button>
          <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <p className="text-xs text-blue-300/70">
              Default settings: $500 monthly allowance, valid for 1 year. You can revoke this permission at any time.
            </p>
          </div>
        </div>
      )}

      {/* Has Permission - Show Details and Revoke */}
      {hasPermission && activePermission && (
        <div className="space-y-4">
          {/* Permission Details */}
          <div className="space-y-3">
            {/* Allowance */}
            <div className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg">
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-400">Allowance</span>
              </div>
              <span className="text-sm font-medium text-white">
                {formatUSDC(BigInt(activePermission.permission.allowance))}
              </span>
            </div>

            {/* Period */}
            <div className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-400">Period</span>
              </div>
              <span className="text-sm font-medium text-white">
                {Math.floor(activePermission.permission.period / (24 * 60 * 60))} days
              </span>
            </div>

            {/* Current Period Spend */}
            {currentPeriodSpend && (
              <div className="p-3 bg-gray-900/50 rounded-lg space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Spent this period</span>
                  <span className="font-medium text-white">{formatUSDC(currentPeriodSpend.spent)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Remaining</span>
                  <span className="font-medium text-green-400">{formatUSDC(currentPeriodSpend.remaining)}</span>
                </div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#DDE404] to-[#C5CC03] transition-all duration-300"
                    style={{
                      // Use safe BigInt arithmetic to calculate percentage
                      // Multiply by 100 first, then divide to maintain precision
                      width: `${Math.min(100, Number((currentPeriodSpend.spent * BigInt(10000) / currentPeriodSpend.allowance) / BigInt(100)))}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Validity Period */}
            <div className="p-3 bg-gray-900/50 rounded-lg">
              <div className="text-xs text-gray-400 mb-1">Valid Period</div>
              <div className="text-sm text-white">
                {formatDate(new Date(activePermission.permission.start * 1000))} - {formatDate(new Date(activePermission.permission.end * 1000))}
              </div>
            </div>
          </div>

          {/* Revoke Button */}
          <button
            onClick={handleRevokePermission}
            disabled={isRevoking || isLoading}
            className="w-full bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-400 font-medium py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRevoking ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Revoking...</span>
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                <span>Revoke Permission</span>
              </>
            )}
          </button>

          <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
            <p className="text-xs text-yellow-300/70">
              Revoking will disable one-click payments. You'll need to confirm each transaction manually until you grant permission again.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default SpendPermissionManager;
