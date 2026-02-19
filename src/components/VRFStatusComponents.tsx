/**
 * VRF Status Components
 * 
 * React components for displaying VRF (Verifiable Random Function) status
 * and transaction details for competitions.
 */

import { useEffect, useState } from 'react';
import { ExternalLink, Zap, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import vrfMonitor, { type VRFStatus } from '../lib/vrf-monitor';

// ============================================================================
// VRF Status Badge Component
// ============================================================================

interface VRFStatusBadgeProps {
  competitionId: string;
  showTriggerButton?: boolean; // Admin only
  className?: string;
}

/**
 * Displays a badge showing the current VRF status of a competition
 * Updates in real-time via Supabase subscriptions
 */
export function VRFStatusBadge({ 
  competitionId, 
  showTriggerButton = false,
  className = '' 
}: VRFStatusBadgeProps) {
  const [status, setStatus] = useState<VRFStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);

  useEffect(() => {
    const unsubscribe = vrfMonitor.subscribeToVRFStatus(competitionId, (newStatus) => {
      setStatus(newStatus);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [competitionId]);

  const handleTrigger = async () => {
    if (!status || triggering) return;
    
    setTriggering(true);
    try {
      const result = await vrfMonitor.triggerVRF(competitionId);
      if (result.success) {
        alert(`VRF draw triggered! TX: ${result.txHash}`);
      } else {
        alert(`Failed to trigger VRF: ${result.message}`);
      }
    } catch (error) {
      alert(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setTriggering(false);
    }
  };

  if (loading) {
    return (
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 bg-gray-500/20 text-gray-400 rounded-lg ${className}`}>
        <Clock className="w-4 h-4 animate-spin" />
        <span className="text-sm sequel-45">Checking VRF...</span>
      </div>
    );
  }

  if (!status) return null;

  // Status colors and icons
  const statusConfig = {
    pending: {
      bg: 'bg-gray-500/20',
      text: 'text-gray-400',
      icon: <Clock className="w-4 h-4" />,
      label: 'Pending',
    },
    requested: {
      bg: 'bg-blue-500/20',
      text: 'text-blue-400',
      icon: <Zap className="w-4 h-4" />,
      label: 'Requested',
    },
    processing: {
      bg: 'bg-purple-500/20',
      text: 'text-purple-400',
      icon: <Zap className="w-4 h-4 animate-pulse" />,
      label: 'Processing',
    },
    completed: {
      bg: 'bg-green-500/20',
      text: 'text-green-400',
      icon: <CheckCircle2 className="w-4 h-4" />,
      label: 'Completed',
    },
    failed: {
      bg: 'bg-red-500/20',
      text: 'text-red-400',
      icon: <AlertCircle className="w-4 h-4" />,
      label: 'Failed',
    },
  };

  const config = statusConfig[status.status];

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 ${config.bg} ${config.text} rounded-lg`}>
        {config.icon}
        <span className="text-sm sequel-45">{config.label}</span>
        {status.vrfVerified && <span className="text-xs">✓</span>}
      </div>

      {showTriggerButton && status.status === 'pending' && (
        <button
          onClick={handleTrigger}
          disabled={triggering}
          className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm sequel-45 disabled:opacity-50"
        >
          {triggering ? 'Triggering...' : 'Trigger VRF'}
        </button>
      )}
    </div>
  );
}

// ============================================================================
// VRF Transaction Details Component
// ============================================================================

interface VRFTransactionDetailsProps {
  competitionId: string;
  className?: string;
}

/**
 * Displays detailed VRF transaction information with links to BaseScan
 */
export function VRFTransactionDetails({ 
  competitionId,
  className = '' 
}: VRFTransactionDetailsProps) {
  const [status, setStatus] = useState<VRFStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = vrfMonitor.subscribeToVRFStatus(competitionId, (newStatus) => {
      setStatus(newStatus);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [competitionId]);

  if (loading) {
    return (
      <div className={`p-4 bg-[#1A1A1A] border border-white/10 rounded-lg ${className}`}>
        <div className="flex items-center gap-2 text-white/60">
          <Clock className="w-4 h-4 animate-spin" />
          <span className="sequel-45 text-sm">Loading VRF details...</span>
        </div>
      </div>
    );
  }

  if (!status) return null;

  return (
    <div className={`p-4 bg-[#1A1A1A] border border-white/10 rounded-lg space-y-3 ${className}`}>
      <div className="flex items-center gap-2 text-white">
        <Zap className="w-5 h-5 text-purple-400" />
        <h3 className="sequel-75 text-lg">VRF Draw Information</h3>
      </div>

      <div className="space-y-2 text-sm">
        {/* Status */}
        <div className="flex items-center justify-between">
          <span className="text-white/60 sequel-45">Status:</span>
          <VRFStatusBadge competitionId={competitionId} />
        </div>

        {/* Transaction Hash */}
        {status.vrfTxHash && (
          <div className="flex items-center justify-between">
            <span className="text-white/60 sequel-45">Transaction:</span>
            <a
              href={status.explorerUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-purple-400 hover:text-purple-300 sequel-45"
            >
              <span className="font-mono text-xs">
                {status.vrfTxHash.slice(0, 10)}...{status.vrfTxHash.slice(-8)}
              </span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}

        {/* Verified */}
        {status.vrfVerified && (
          <div className="flex items-center justify-between">
            <span className="text-white/60 sequel-45">Verified:</span>
            <div className="flex items-center gap-1 text-green-400">
              <CheckCircle2 className="w-4 h-4" />
              <span className="sequel-45">On-chain</span>
            </div>
          </div>
        )}

        {/* Timestamp */}
        {status.timestamp && (
          <div className="flex items-center justify-between">
            <span className="text-white/60 sequel-45">Draw Time:</span>
            <span className="text-white sequel-45">
              {new Date(status.timestamp).toLocaleString()}
            </span>
          </div>
        )}

        {/* Winners Count */}
        {status.winnersCount && (
          <div className="flex items-center justify-between">
            <span className="text-white/60 sequel-45">Winners:</span>
            <span className="text-white sequel-45">{status.winnersCount}</span>
          </div>
        )}

        {/* Error Message */}
        {status.errorMessage && (
          <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded">
            <p className="text-red-400 text-xs sequel-45">{status.errorMessage}</p>
          </div>
        )}
      </div>

      {/* Contract Link */}
      <div className="pt-3 border-t border-white/10">
        <a
          href={vrfMonitor.getContractUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-purple-400 hover:text-purple-300 text-sm sequel-45"
        >
          <Zap className="w-4 h-4" />
          <span>View VRF Contract on BaseScan</span>
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
}

// ============================================================================
// Hook for VRF Status
// ============================================================================

/**
 * Custom hook for fetching and subscribing to VRF status
 */
export function useVRFStatus(competitionId: string) {
  const [status, setStatus] = useState<VRFStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = vrfMonitor.subscribeToVRFStatus(competitionId, (newStatus) => {
      setStatus(newStatus);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [competitionId]);

  return { status, loading };
}
