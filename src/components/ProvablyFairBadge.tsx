import { Shield } from 'lucide-react';

interface ProvablyFairBadgeProps {
  /** The on-chain competition ID - if present, competition is VRF-enabled */
  onchainCompetitionId?: number | null;
  /** Size variant */
  size?: 'sm' | 'md';
  /** Additional CSS classes */
  className?: string;
}

/**
 * ProvablyFairBadge Component
 *
 * Displays a "Provably Fair" badge for competitions that use on-chain VRF.
 * Only renders if the competition has an onchain_competition_id.
 *
 * The badge links to BaseScan for verification of the VRF contract.
 */
export function ProvablyFairBadge({
  onchainCompetitionId,
  size = 'sm',
  className = '',
}: ProvablyFairBadgeProps) {
  // Only render if competition has an on-chain ID
  if (onchainCompetitionId === undefined || onchainCompetitionId === null) {
    return null;
  }

  const VRF_CONTRACT_ADDRESS = '0x8ce54644e3313934D663c43Aea29641DFD8BcA1A';
  const baseScanUrl = `https://basescan.org/address/${VRF_CONTRACT_ADDRESS}`;

  const sizeClasses = {
    sm: 'text-[10px] px-1.5 py-0.5 gap-1',
    md: 'text-xs px-2 py-1 gap-1.5',
  };

  const iconSize = size === 'sm' ? 10 : 12;

  return (
    <a
      href={baseScanUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center rounded-full bg-green-500/20 text-green-400 font-medium hover:bg-green-500/30 transition-colors ${sizeClasses[size]} ${className}`}
      title={`Provably Fair - On-chain ID: ${onchainCompetitionId}`}
    >
      <Shield size={iconSize} />
      <span>Provably Fair</span>
    </a>
  );
}

export default ProvablyFairBadge;
