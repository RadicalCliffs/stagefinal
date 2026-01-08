import React from 'react';
import {
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  Trophy,
  AlertTriangle,
  PlayCircle,
  PauseCircle,
  Zap
} from 'lucide-react';

type CompetitionStatus =
  | 'active'
  | 'completed'
  | 'drawn'
  | 'drawing'
  | 'cancelled'
  | 'expired'
  | 'draft'
  | 'paused';

interface CompetitionStatusIndicatorProps {
  status: string;
  isInstantWin?: boolean;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const statusConfig: Record<CompetitionStatus, {
  label: string;
  icon: typeof Clock;
  bgColor: string;
  textColor: string;
  borderColor: string;
  pulse?: boolean;
}> = {
  active: {
    label: 'Live',
    icon: PlayCircle,
    bgColor: 'bg-green-500/10',
    textColor: 'text-green-400',
    borderColor: 'border-green-500/30',
    pulse: true,
  },
  drawing: {
    label: 'Drawing...',
    icon: Loader2,
    bgColor: 'bg-purple-500/10',
    textColor: 'text-purple-400',
    borderColor: 'border-purple-500/30',
    pulse: true,
  },
  drawn: {
    label: 'Drawn',
    icon: Trophy,
    bgColor: 'bg-[#EF008F]/10',
    textColor: 'text-[#EF008F]',
    borderColor: 'border-[#EF008F]/30',
  },
  completed: {
    label: 'Completed',
    icon: CheckCircle,
    bgColor: 'bg-[#DDE404]/10',
    textColor: 'text-[#DDE404]',
    borderColor: 'border-[#DDE404]/30',
  },
  cancelled: {
    label: 'Cancelled',
    icon: XCircle,
    bgColor: 'bg-red-500/10',
    textColor: 'text-red-400',
    borderColor: 'border-red-500/30',
  },
  expired: {
    label: 'Expired',
    icon: Clock,
    bgColor: 'bg-gray-500/10',
    textColor: 'text-gray-400',
    borderColor: 'border-gray-500/30',
  },
  draft: {
    label: 'Draft',
    icon: AlertTriangle,
    bgColor: 'bg-yellow-500/10',
    textColor: 'text-yellow-400',
    borderColor: 'border-yellow-500/30',
  },
  paused: {
    label: 'Paused',
    icon: PauseCircle,
    bgColor: 'bg-orange-500/10',
    textColor: 'text-orange-400',
    borderColor: 'border-orange-500/30',
  },
};

const sizeConfig = {
  sm: {
    padding: 'px-1.5 py-0.5',
    text: 'text-[10px]',
    icon: 10,
    gap: 'gap-0.5',
  },
  md: {
    padding: 'px-2 py-1',
    text: 'text-xs',
    icon: 14,
    gap: 'gap-1',
  },
  lg: {
    padding: 'px-3 py-1.5',
    text: 'text-sm',
    icon: 18,
    gap: 'gap-1.5',
  },
};

/**
 * Competition Status Indicator Component
 *
 * Displays the current status of a competition with appropriate styling
 * and icons. Supports real-time status updates with visual feedback.
 */
const CompetitionStatusIndicator: React.FC<CompetitionStatusIndicatorProps> = ({
  status,
  isInstantWin = false,
  showLabel = true,
  size = 'md',
  className = '',
}) => {
  // Normalize status
  const normalizedStatus = (status?.toLowerCase() || 'active') as CompetitionStatus;
  const config = statusConfig[normalizedStatus] || statusConfig.active;
  const s = sizeConfig[size];

  const IconComponent = config.icon;
  const isSpinning = normalizedStatus === 'drawing';

  return (
    <div className={`inline-flex items-center ${s.gap} ${className}`}>
      {/* Main status badge */}
      <span
        className={`
          inline-flex items-center ${s.gap} ${s.padding} rounded-full
          ${config.bgColor} ${config.textColor} border ${config.borderColor}
          sequel-75 uppercase ${s.text}
          ${config.pulse ? 'animate-pulse' : ''}
        `}
      >
        <IconComponent
          size={s.icon}
          className={isSpinning ? 'animate-spin' : ''}
        />
        {showLabel && <span>{config.label}</span>}
      </span>

      {/* Instant Win badge */}
      {isInstantWin && normalizedStatus === 'active' && (
        <span
          className={`
            inline-flex items-center ${s.gap} ${s.padding} rounded-full
            bg-[#DDE404]/20 text-[#DDE404] border border-[#DDE404]/30
            sequel-75 uppercase ${s.text}
          `}
        >
          <Zap size={s.icon} className="animate-pulse" />
          {showLabel && <span>Instant Win</span>}
        </span>
      )}
    </div>
  );
};

export default CompetitionStatusIndicator;
