import CompetitionCountdown from './CompetitionCountdown';

interface CountdownProps {
  endDate?: string | null;
  /** When true, the countdown stops immediately (e.g., competition is sold out or ended) */
  isEnded?: boolean;
}

const Countdown = ({ endDate, isEnded = false }: CountdownProps) => {
  if (!endDate) {
    const defaultEnd = new Date();
    defaultEnd.setDate(defaultEnd.getDate() + 7);
    return <CompetitionCountdown endDate={defaultEnd.toISOString()} format="full" isEnded={isEnded} />;
  }

  return <CompetitionCountdown endDate={endDate} format="full" isEnded={isEnded} />;

}

export default Countdown