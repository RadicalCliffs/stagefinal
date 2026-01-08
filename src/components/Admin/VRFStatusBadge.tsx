import { useVRFReadyCheck } from '../../hooks/useVRFDebug';
import type { ParsedVRFState } from '../../lib/vrf-debug';

interface VRFStatusBadgeProps {
  /** The on-chain competition ID */
  onchainCompetitionId?: number | null;
  /** Optional: Pre-loaded VRF state (skip fetching if provided) */
  vrfState?: ParsedVRFState | null;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Whether to show the full status text */
  showText?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * VRFStatusBadge Component
 *
 * Displays the VRF status of an on-chain competition as a badge.
 * Can either fetch the status automatically or use pre-loaded state.
 *
 * @example
 * ```tsx
 * // Auto-fetch status
 * <VRFStatusBadge onchainCompetitionId={12345} />
 *
 * // Use pre-loaded state
 * <VRFStatusBadge vrfState={preloadedState} />
 *
 * // Small badge with just emoji
 * <VRFStatusBadge onchainCompetitionId={12345} size="sm" showText={false} />
 * ```
 */
export function VRFStatusBadge({
  onchainCompetitionId,
  vrfState: preloadedState,
  size = 'md',
  showText = true,
  className = '',
}: VRFStatusBadgeProps) {
  // Only fetch if no preloaded state and we have an ID
  const shouldFetch = !preloadedState && onchainCompetitionId !== undefined && onchainCompetitionId !== null;
  const { ready, loading, error } = useVRFReadyCheck(shouldFetch ? onchainCompetitionId : undefined);

  // Determine status from preloaded state or fetched state
  let status: 'ready' | 'drawn' | 'active' | 'inactive' | 'loading' | 'error' | 'no_id' = 'no_id';
  let emoji = '';
  let label = '';
  let bgColor = '';
  let textColor = '';

  if (preloadedState) {
    // Use preloaded state
    switch (preloadedState.status) {
      case 'ready_for_draw':
        status = 'ready';
        emoji = '🟢';
        label = 'Ready for Draw';
        bgColor = 'bg-green-500/20';
        textColor = 'text-green-400';
        break;
      case 'already_drawn':
        status = 'drawn';
        emoji = '🔵';
        label = 'Drawn';
        bgColor = 'bg-blue-500/20';
        textColor = 'text-blue-400';
        break;
      case 'active_not_ready':
        status = 'active';
        emoji = '🟡';
        label = 'Active';
        bgColor = 'bg-yellow-500/20';
        textColor = 'text-yellow-400';
        break;
      case 'inactive':
        status = 'inactive';
        emoji = '🔴';
        label = 'Inactive';
        bgColor = 'bg-red-500/20';
        textColor = 'text-red-400';
        break;
    }
  } else if (!shouldFetch) {
    // No on-chain ID
    status = 'no_id';
    emoji = '⚪';
    label = 'No On-Chain ID';
    bgColor = 'bg-gray-500/20';
    textColor = 'text-gray-400';
  } else if (loading) {
    status = 'loading';
    emoji = '⏳';
    label = 'Checking...';
    bgColor = 'bg-gray-500/20';
    textColor = 'text-gray-400';
  } else if (error) {
    status = 'error';
    emoji = '⚠️';
    label = 'Error';
    bgColor = 'bg-red-500/20';
    textColor = 'text-red-400';
  } else if (ready) {
    status = 'ready';
    emoji = '🟢';
    label = 'Ready for Draw';
    bgColor = 'bg-green-500/20';
    textColor = 'text-green-400';
  } else {
    // Not ready - could be active, drawn, or inactive
    status = 'active';
    emoji = '🟡';
    label = 'Not Ready';
    bgColor = 'bg-yellow-500/20';
    textColor = 'text-yellow-400';
  }

  // Size classes
  const sizeClasses = {
    sm: 'text-xs px-1.5 py-0.5',
    md: 'text-sm px-2 py-1',
    lg: 'text-base px-3 py-1.5',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full ${bgColor} ${textColor} ${sizeClasses[size]} font-medium ${className}`}
      title={showText ? undefined : label}
    >
      <span>{emoji}</span>
      {showText && <span>{label}</span>}
    </span>
  );
}

/**
 * Compact VRF indicator for use in tables or tight spaces
 */
export function VRFIndicator({
  onchainCompetitionId,
  vrfState,
}: {
  onchainCompetitionId?: number | null;
  vrfState?: ParsedVRFState | null;
}) {
  return (
    <VRFStatusBadge
      onchainCompetitionId={onchainCompetitionId}
      vrfState={vrfState}
      size="sm"
      showText={false}
    />
  );
}

export default VRFStatusBadge;
