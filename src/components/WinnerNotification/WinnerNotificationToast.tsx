import React, { useState, useEffect, useCallback } from 'react';
import { Trophy, X, PartyPopper, Star } from 'lucide-react';
import { useWinnerNotifications } from '../../hooks/useRealTimeBalance';

interface WinnerNotificationProps {
  // Optionally pass a custom handler for wins
  onWinDismissed?: (win: any) => void;
}

interface WinData {
  prize: string;
  competitionId: string;
  timestamp: Date;
}

/**
 * Winner Notification Toast Component
 *
 * Displays celebratory notifications when users win prizes.
 * Includes:
 * - Animated toast notification
 * - Confetti celebration effect
 * - Sound effect (optional)
 * - Link to view prize details
 */
const WinnerNotificationToast: React.FC<WinnerNotificationProps> = ({
  onWinDismissed,
}) => {
  const [currentWin, setCurrentWin] = useState<WinData | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  const handleWin = useCallback((win: WinData) => {
    setCurrentWin(win);
    setIsVisible(true);
    setIsAnimating(true);

    // Trigger confetti effect
    triggerConfetti();

    // Auto-hide after 10 seconds
    setTimeout(() => {
      setIsAnimating(false);
    }, 10000);
  }, []);

  const { wins, hasNewWin, clearNewWin } = useWinnerNotifications(handleWin);

  useEffect(() => {
    if (hasNewWin && wins.length > 0) {
      const latestWin = wins[wins.length - 1];
      handleWin(latestWin);
      clearNewWin();
    }
  }, [hasNewWin, wins, handleWin, clearNewWin]);

  const triggerConfetti = async () => {
    // Dynamically import canvas-confetti for better code splitting
    // This library is only needed when a user wins, which is a rare event
    const confettiModule = await import('canvas-confetti');
    const confetti = confettiModule.default;

    // Central burst
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#DDE404', '#EF008F', '#FFD700', '#00FF00', '#FF6B6B'],
    });

    // Side bursts
    setTimeout(() => {
      confetti({
        particleCount: 50,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: ['#DDE404', '#EF008F', '#FFD700'],
      });
      confetti({
        particleCount: 50,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: ['#DDE404', '#EF008F', '#FFD700'],
      });
    }, 200);
  };

  const handleDismiss = () => {
    setIsAnimating(false);
    setTimeout(() => {
      setIsVisible(false);
      if (onWinDismissed && currentWin) {
        onWinDismissed(currentWin);
      }
      setCurrentWin(null);
    }, 300);
  };

  const handleViewPrize = () => {
    // Navigate to dashboard or prize details
    window.location.href = '/dashboard/entries';
    handleDismiss();
  };

  if (!isVisible || !currentWin) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 bg-black/50 z-9998 transition-opacity duration-300 ${
          isAnimating ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={handleDismiss}
      />

      {/* Toast notification */}
      <div
        className={`fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-9999 transition-all duration-500 ${
          isAnimating
            ? 'opacity-100 scale-100'
            : 'opacity-0 scale-75'
        }`}
      >
        <div className="bg-linear-to-br from-[#1A1A1A] via-[#252525] to-[#1A1A1A] border-2 border-[#DDE404] rounded-2xl p-6 max-w-md mx-4 shadow-2xl shadow-[#DDE404]/20">
          {/* Close button */}
          <button
            onClick={handleDismiss}
            className="absolute top-3 right-3 text-white/60 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>

          {/* Celebration header */}
          <div className="text-center mb-4">
            <div className="relative inline-block">
              <div className="w-20 h-20 bg-linear-to-br from-[#DDE404] to-[#B8C700] rounded-full flex items-center justify-center animate-bounce">
                <Trophy size={40} className="text-black" />
              </div>
              {/* Sparkles */}
              <Star
                size={16}
                className="absolute -top-2 -right-2 text-[#DDE404] animate-pulse"
                fill="#DDE404"
              />
              <Star
                size={12}
                className="absolute -bottom-1 -left-3 text-[#EF008F] animate-pulse"
                fill="#EF008F"
                style={{ animationDelay: '0.2s' }}
              />
              <Star
                size={14}
                className="absolute top-0 -left-2 text-[#DDE404] animate-pulse"
                fill="#DDE404"
                style={{ animationDelay: '0.4s' }}
              />
            </div>
          </div>

          {/* Congratulations message */}
          <div className="text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <PartyPopper size={24} className="text-[#DDE404]" />
              <h2 className="text-[#DDE404] sequel-95 text-2xl uppercase">
                Congratulations!
              </h2>
              <PartyPopper size={24} className="text-[#DDE404] transform scale-x-[-1]" />
            </div>

            <p className="text-white sequel-75 text-lg mb-2">
              You've won an Instant Prize!
            </p>

            <div className="bg-[#DDE404]/10 border border-[#DDE404]/30 rounded-lg px-4 py-3 mb-4">
              <p className="text-[#DDE404] sequel-95 text-xl">
                {currentWin.prize}
              </p>
            </div>

            <p className="text-white/60 sequel-45 text-sm mb-4">
              Your prize has been added to your account. Check your dashboard to claim it!
            </p>

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={handleViewPrize}
                className="flex-1 bg-[#DDE404] hover:bg-[#DDE404]/90 text-black sequel-75 py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors"
              >
                <Trophy size={18} />
                View Prize
              </button>
              <button
                onClick={handleDismiss}
                className="bg-[#2A2A2A] hover:bg-[#3A3A3A] text-white sequel-75 py-3 px-4 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

/**
 * Simple toast notification for wins (non-modal version)
 */
export const WinnerToastSimple: React.FC<{ win: WinData; onDismiss: () => void }> = ({
  win,
  onDismiss,
}) => {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 8000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className="fixed top-4 right-4 z-9999 animate-slide-in-right">
      <div className="bg-linear-to-r from-[#1A1A1A] to-[#252525] border border-[#DDE404] rounded-xl p-4 shadow-lg shadow-[#DDE404]/10 max-w-sm">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-[#DDE404] rounded-full flex items-center justify-center shrink-0">
            <Trophy size={20} className="text-black" />
          </div>
          <div className="flex-1">
            <p className="text-[#DDE404] sequel-75 text-sm mb-1">You Won!</p>
            <p className="text-white sequel-95 text-base">{win.prize}</p>
          </div>
          <button
            onClick={onDismiss}
            className="text-white/60 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default WinnerNotificationToast;
