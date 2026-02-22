/**
 * Profile Update Success Modal
 *
 * Displays a success message after profile update with a horizontally scrolling
 * carousel of currently live competitions. This component uses the profiles table
 * to store user-editable profile data separately from the canonical_users table.
 *
 * The profiles table acts as a staging area for user profile updates, allowing
 * the system to process changes asynchronously while showing instant feedback.
 */

import React, { useEffect, useRef, useState } from 'react';
import { X, CheckCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useCompetitions } from '../hooks/useFetchCompetitions';
import type { Competition } from '../models/models';
import { Link } from 'react-router';
import { bitcoinV2 } from '../assets/images';

interface ProfileUpdateSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  username?: string;
}

const ProfileUpdateSuccessModal: React.FC<ProfileUpdateSuccessModalProps> = ({
  isOpen,
  onClose,
  username,
}) => {
  const { liveCompetitions, instantWinCompetitions, loading } = useCompetitions();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);
  const [imgErrors, setImgErrors] = useState<Set<string>>(new Set());

  // Combine live and instant win competitions, limit to 10
  const allCompetitions = [...liveCompetitions, ...instantWinCompetitions].slice(0, 10);

  // Update scroll button states
  const updateScrollButtons = () => {
    if (scrollContainerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
      setCanScrollLeft(scrollLeft > 0);
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10);
    }
  };

  // Scroll handlers
  const scrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -280, behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 280, behavior: 'smooth' });
    }
  };

  // Handle image error
  const handleImageError = (id: string) => {
    setImgErrors(prev => new Set(prev).add(id));
  };

  // Setup scroll listener
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('scroll', updateScrollButtons);
      // Initial check
      updateScrollButtons();
      return () => container.removeEventListener('scroll', updateScrollButtons);
    }
  }, [isOpen, allCompetitions.length]);

  // Auto-close after 15 seconds (give user time to browse competitions)
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        onClose();
      }, 15000);
      return () => clearTimeout(timer);
    }
  }, [isOpen, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // Calculate time remaining for a competition
  const getTimeRemaining = (endDate?: string): string => {
    if (!endDate) return 'Coming Soon';
    const end = new Date(endDate);
    const now = new Date();
    const diff = end.getTime() - now.getTime();

    if (diff <= 0) return 'Ended';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    if (days > 0) return `${days}d ${hours}h left`;
    if (hours > 0) return `${hours}h left`;

    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${minutes}m left`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-3xl bg-[#0A0A0F] border border-white/10 rounded-2xl shadow-2xl relative overflow-hidden">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white/50 hover:text-white transition-colors z-10"
        >
          <X size={24} />
        </button>

        {/* Success message section */}
        <div className="p-8 pb-4 text-center">
          <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
            <CheckCircle size={40} className="text-green-400" />
          </div>

          <h2 className="text-2xl font-bold text-white mb-2 sequel-95">
            Thanks for the info!
          </h2>

          <p className="text-white/70 sequel-45 mb-2">
            {username ? (
              <>Your profile has been updated, <span className="text-[#DDE404]">{username}</span>!</>
            ) : (
              'Your profile has been updated!'
            )}
          </p>

          <p className="text-white/50 text-sm sequel-45">
            You should see your changes reflected in your account section in 1-2 minutes.
          </p>
        </div>

        {/* Divider */}
        <div className="h-px bg-linear-to-r from-transparent via-[#DDE404] to-transparent mx-8" />

        {/* Live competitions carousel section */}
        <div className="p-8 pt-6">
          <h3 className="text-lg text-white sequel-75 mb-4 text-center">
            Check out some of our live competitions
          </h3>

          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[#DDE404]"></div>
            </div>
          ) : allCompetitions.length === 0 ? (
            <p className="text-white/50 text-center py-8 sequel-45">
              No live competitions at the moment. Check back soon!
            </p>
          ) : (
            <div className="relative">
              {/* Scroll left button */}
              {canScrollLeft && (
                <button
                  onClick={scrollLeft}
                  className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-black/80 hover:bg-black text-white rounded-full p-2 transition-all shadow-lg -ml-2"
                >
                  <ChevronLeft size={24} />
                </button>
              )}

              {/* Carousel container */}
              <div
                ref={scrollContainerRef}
                className="flex gap-4 overflow-x-auto scrollbar-hide pb-2 px-1 scroll-smooth"
                style={{
                  scrollbarWidth: 'none',
                  msOverflowStyle: 'none',
                }}
              >
                {allCompetitions.map((comp: Competition) => (
                  <Link
                    key={comp.id}
                    to={`/competitions/${comp.id}`}
                    onClick={onClose}
                    className="shrink-0 w-[220px] sm:w-[260px] bg-[#1A1A1A] rounded-xl border border-white/10 hover:border-[#DDE404] transition-all overflow-hidden group"
                  >
                    {/* Competition image */}
                    <div className="relative h-[130px] sm:h-[150px] overflow-hidden">
                      <img
                        src={imgErrors.has(comp.id) ? bitcoinV2 : (comp.image_url || bitcoinV2)}
                        alt={comp.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        onError={() => handleImageError(comp.id)}
                      />

                      {/* Time badge */}
                      <div className="absolute top-2 left-2 bg-black/80 text-white text-xs px-2 py-1 rounded sequel-45">
                        {getTimeRemaining(comp.end_date || undefined)}
                      </div>

                      {/* Instant win badge */}
                      {comp.is_instant_win && (
                        <div className="absolute top-2 right-2 bg-[#EF008F] text-white text-xs px-2 py-1 rounded sequel-45">
                          Instant Win
                        </div>
                      )}
                    </div>

                    {/* Competition info */}
                    <div className="p-3">
                      <h4 className="text-white text-sm sequel-75 line-clamp-2 mb-2 min-h-[40px]">
                        {comp.title}
                      </h4>

                      <div className="flex items-center justify-between">
                        <span className="text-[#DDE404] sequel-95 text-sm">
                          ${comp.ticket_price?.toFixed(2) || '0.00'}
                        </span>
                        <span className="text-white/50 text-xs sequel-45">
                          / entry
                        </span>
                      </div>

                      {/* Progress bar */}
                      <div className="mt-2">
                        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-linear-to-r from-[#DDE404] to-[#00FF88] rounded-full transition-all"
                            style={{
                              width: `${Math.min(100, Math.max(5, comp.progressPercent || ((comp.tickets_sold || 0) / (comp.max_tickets || 1000) * 100)))}%`
                            }}
                          />
                        </div>
                        <p className="text-white/40 text-xs sequel-45 mt-1">
                          {Math.round(comp.progressPercent || ((comp.tickets_sold || 0) / (comp.max_tickets || 1000) * 100))}% sold
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>

              {/* Scroll right button */}
              {canScrollRight && allCompetitions.length > 2 && (
                <button
                  onClick={scrollRight}
                  className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-black/80 hover:bg-black text-white rounded-full p-2 transition-all shadow-lg -mr-2"
                >
                  <ChevronRight size={24} />
                </button>
              )}
            </div>
          )}

          {/* Browse all button */}
          <div className="mt-6 text-center">
            <Link
              to="/competitions"
              onClick={onClose}
              className="inline-block bg-[#DDE404] hover:bg-[#DDE404]/90 text-black sequel-95 uppercase px-6 py-2.5 rounded-lg text-sm transition-all"
            >
              Browse All Competitions
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileUpdateSuccessModal;
