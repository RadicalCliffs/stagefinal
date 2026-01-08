import { useState, useEffect } from 'react';

interface CompetitionCountdownProps {
  endDate: string;
  format?: 'badge' | 'full';
  /** When true, the countdown stops immediately (e.g., competition is sold out or ended) */
  isEnded?: boolean;
}

const CompetitionCountdown = ({ endDate, format = 'badge', isEnded = false }: CompetitionCountdownProps) => {
  const [timeRemaining, setTimeRemaining] = useState('00:00:00:00');

  useEffect(() => {
    // If competition has ended (sold out, drawn, etc.), stop the countdown immediately
    if (isEnded) {
      setTimeRemaining('00:00:00:00');
      return;
    }

    const calculateTime = () => {
      const end = new Date(endDate).getTime();
      const now = new Date().getTime();
      const diff = end - now;

      if (diff <= 0) {
        setTimeRemaining('00:00:00:00');
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setTimeRemaining(`${String(days).padStart(2, '0')}:${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`);
    };

    calculateTime();
    const interval = setInterval(calculateTime, 1000);

    return () => clearInterval(interval);
  }, [endDate, isEnded]);

  if (format === 'full') {
    const [days, hours, minutes, seconds] = timeRemaining.split(':');
    return (
      <div className='flex items-center gap-1'>
        <div className="flex items-center gap-1">
          <p className='bg-white sequel-75 text-center text-[#2E2122] px-2 sm:text-3xl text-2xl rounded-lg sm:pb-2'>
            {days || '00'}
          </p>
          <span className="text-white sm:text-2xl text-xl sequel-75">:</span>
        </div>
        <div className="flex items-center gap-1">
          <p className='bg-white sequel-75 text-center text-[#2E2122] px-2 sm:text-3xl text-2xl rounded-lg sm:pb-2'>
            {hours || '00'}
          </p>
          <span className="text-white sm:text-2xl text-xl sequel-75">:</span>
        </div>
        <div className="flex items-center gap-1">
          <p className='bg-white sequel-75 text-center text-[#2E2122] px-2 sm:text-3xl text-2xl rounded-lg sm:pb-2'>
            {minutes || '00'}
          </p>
          <span className="text-white sm:text-2xl text-xl sequel-75">:</span>
        </div>
        <p className='bg-white sequel-75 text-center text-[#2E2122] px-2 sm:text-3xl text-2xl rounded-lg sm:pb-2'>
          {seconds || '00'}
        </p>
      </div>
    );
  }

  return <span className="sequel-75 md:text-sm text-xs sm:pt-[0.2rem] sm:pb-1.5 pt-1.5 pb-1 ">{timeRemaining}</span>;
};

export default CompetitionCountdown;
