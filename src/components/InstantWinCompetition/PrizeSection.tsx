import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import PrizesDetails from "./PrizesDetails";
import PrizesHeader from "./PrizesHeader";
import Loader from "../Loader";

interface PrizeSectionProps {
  competitionUid: string;
  totalTickets: number;
}

// UUID validation regex (RFC 4122)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Default fallback image for prizes
const DEFAULT_PRIZE_IMAGE = 'https://mthwfldcjvpxjtmrqkqm.supabase.co/storage/v1/object/public/Competition%20Images/Competition%20Images/bitcoin-image.webp';

// Helper to validate if a URL looks like a valid image URL
const isValidImageUrl = (url: string | null | undefined): boolean => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.length === 0) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const PrizeSection: React.FC<PrizeSectionProps> = ({ competitionUid, totalTickets: _totalTickets }) => {
  const [prizes, setPrizes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPrizes = async () => {
      // Skip query if no competitionUid or invalid UUID format to avoid errors
      if (!competitionUid || competitionUid.trim() === '' || !UUID_REGEX.test(competitionUid)) {
        if (competitionUid && !UUID_REGEX.test(competitionUid)) {
          console.warn('PrizeSection: Invalid competitionUid format (not a valid UUID):', competitionUid);
        }
        setPrizes([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      const { data, error } = await supabase
        .from('Prize_Instantprizes')
        .select('*')
        .eq('competitionId', competitionUid)
        .order('priority', { ascending: true });

      if (!error && data) {
        const groupedPrizes = data.reduce((acc: any, prize: any) => {
          const existingGroup = acc.find((g: any) => g.prize === prize.prize);
          if (existingGroup) {
            existingGroup.tickets.push({
              id: prize.UID,
              number: prize.winningTicket,
              isWinner: !!prize.winningWalletAddress,
            });
            existingGroup.wonCount = existingGroup.tickets.filter((t: any) => t.isWinner).length;
          } else {
            acc.push({
              prize: prize.prize,
              url: prize.url,
              description: prize.description,
              priority: prize.priority,
              tickets: [{
                id: prize.UID,
                number: prize.winningTicket,
                isWinner: !!prize.winningWalletAddress,
              }],
              wonCount: prize.winningWalletAddress ? 1 : 0,
            });
          }
          return acc;
        }, []);

        groupedPrizes.sort((a: any, b: any) => a.priority - b.priority);
        setPrizes(groupedPrizes);
      }
      setLoading(false);
    };

    fetchPrizes();
  }, [competitionUid]);

  if (loading) {
    return (
      <div className="py-12">
        <Loader />
      </div>
    );
  }

  if (prizes.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-white/70 sequel-45 text-lg">No prizes configured yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {prizes.map((prize, index) => (
        <PrizesHeader
          key={index}
          image={isValidImageUrl(prize.url) ? prize.url : DEFAULT_PRIZE_IMAGE}
          title={prize.prize || 'Prize'}
          toBeWon={`${prize.wonCount}/${prize.tickets.length}`}
          details={<PrizesDetails tickets={prize.tickets} />}
        />
      ))}
    </div>
  );
};

export default PrizeSection;
