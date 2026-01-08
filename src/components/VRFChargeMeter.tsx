import { useMemo } from 'react';
import { Zap } from 'lucide-react';
import { VRF_THRESHOLD } from '../constants/vrf';

interface VRFChargeMeterProps {
  currentAmount: number;
  thresholdAmount?: number;
  className?: string;
}

/**
 * VRFChargeMeter displays a charging animation that fills up as the
 * ticket purchase total approaches the VRF threshold ($4.00).
 *
 * - Below threshold: Shows partial fill with amber color
 * - At/above threshold: Shows full pulsating green meter
 */
const VRFChargeMeter: React.FC<VRFChargeMeterProps> = ({
  currentAmount,
  thresholdAmount = VRF_THRESHOLD,
  className = '',
}) => {
  const chargePercentage = useMemo(() => {
    if (currentAmount <= 0) return 0;
    return Math.min((currentAmount / thresholdAmount) * 100, 100);
  }, [currentAmount, thresholdAmount]);

  const isFullyCharged = currentAmount >= thresholdAmount;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* Charge Meter Container */}
      <div className="relative flex-1">
        {/* Background track */}
        <div className="h-3 bg-[#2A2A2A] rounded-full overflow-hidden border border-[#3A3A3A]">
          {/* Fill bar */}
          <div
            className={`h-full transition-all duration-300 ease-out rounded-full ${
              isFullyCharged
                ? 'bg-gradient-to-r from-green-500 to-green-400 animate-pulse'
                : 'bg-gradient-to-r from-amber-600 to-amber-400'
            }`}
            style={{ width: `${chargePercentage}%` }}
          />
        </div>

        {/* Glow effect when fully charged */}
        {isFullyCharged && (
          <div
            className="absolute inset-0 rounded-full animate-ping opacity-30 bg-green-400"
            style={{ animationDuration: '1.5s' }}
          />
        )}
      </div>

      {/* Lightning Bolt Icon */}
      <div
        className={`relative flex items-center justify-center w-10 h-10 rounded-lg transition-all duration-300 ${
          isFullyCharged
            ? 'bg-green-500/20 border-2 border-green-400'
            : chargePercentage > 0
            ? 'bg-amber-500/20 border-2 border-amber-400/50'
            : 'bg-[#2A2A2A] border border-[#3A3A3A]'
        }`}
      >
        <Zap
          size={20}
          className={`transition-all duration-300 ${
            isFullyCharged
              ? 'text-green-400 animate-bounce'
              : chargePercentage > 0
              ? 'text-amber-400'
              : 'text-white/30'
          }`}
          fill={isFullyCharged ? 'currentColor' : 'none'}
        />

        {/* Pulse ring when fully charged */}
        {isFullyCharged && (
          <div className="absolute inset-0 rounded-lg border-2 border-green-400 animate-ping opacity-50" />
        )}
      </div>

      {/* Status Label */}
      <div className="min-w-[80px] text-right">
        <p
          className={`text-xs font-semibold sequel-75 transition-colors duration-300 ${
            isFullyCharged ? 'text-green-400' : 'text-white/60'
          }`}
        >
          {isFullyCharged ? 'VRF READY' : `$${(thresholdAmount - currentAmount).toFixed(2)} to VRF`}
        </p>
        <p className="text-[10px] sequel-45 text-white/40">
          {isFullyCharged ? 'On-chain randomness' : 'Off-chain RNG'}
        </p>
      </div>
    </div>
  );
};

export default VRFChargeMeter;
