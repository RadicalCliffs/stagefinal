import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabase";
import PrizesHeader from "./PrizesHeader";
import PrizesDetails from "./PrizesDetails";
import Loader from "../Loader";

interface KeyPrizesSectionProps {
  competitionUid: string;
  competitionId?: string;
  totalTickets: number;
  prizeValue?: number;
}

interface PrizeConfig {
  name: string;
  ticketCount: number;
  priority: number;
  description: string;
  imageUrl: string;
}

interface DatabasePrize {
  UID: string;
  winningTicket: number;
  prize: string | null;
  url: string | null;
  description: string | null;
  priority: number | null;
  winningWalletAddress: string | null;
}

// Default prize images from Supabase storage (used as fallback if admin hasn't set images)
const DEFAULT_PRIZE_IMAGES = {
  grandPrize: 'https://mthwfldcjvpxjtmrqkqm.supabase.co/storage/v1/object/public/Competition%20Images/Competition%20Images/bitcoin-image.webp',
  majorPrize: 'https://mthwfldcjvpxjtmrqkqm.supabase.co/storage/v1/object/public/Competition%20Images/Competition%20Images/Eth%20Tier%201.png',
  jackpot: 'https://mthwfldcjvpxjtmrqkqm.supabase.co/storage/v1/object/public/Competition%20Images/Competition%20Images/soltier1.jpg',
};

// UUID validation regex (RFC 4122)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Helper to validate if a URL looks like a valid image URL
const isValidImageUrl = (url: string | null | undefined): boolean => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.length === 0) return false;
  // Check for common image URL patterns
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

// Fixed prize structure: 3 Major Prizes (1 each)
// This is the standard structure for all instant win competitions
const MAJOR_PRIZE_COUNT = 3;

const KeyPrizesSection: React.FC<KeyPrizesSectionProps> = ({
  competitionUid,
  competitionId,
  totalTickets: _totalTickets,
  prizeValue: _prizeValue = 10000
}) => {
  const [claimedTickets, setClaimedTickets] = useState<Map<number, boolean>>(new Map());
  const [databasePrizes, setDatabasePrizes] = useState<DatabasePrize[]>([]);
  const [loading, setLoading] = useState(true);

  // Fixed prize configuration: 3 Major Prizes (1 winner each)
  // Admin can configure custom names and images for each
  // Total major prize winners = 3
  const defaultPrizeConfig: PrizeConfig[] = useMemo(() => [
    {
      name: 'Grand Prize',
      ticketCount: 1,
      priority: 1,
      description: 'The ultimate grand prize winner!',
      imageUrl: DEFAULT_PRIZE_IMAGES.grandPrize,
    },
    {
      name: 'Major Prize',
      ticketCount: 1,
      priority: 2,
      description: 'Major prize winner!',
      imageUrl: DEFAULT_PRIZE_IMAGES.majorPrize,
    },
    {
      name: 'Jackpot',
      ticketCount: 1,
      priority: 3,
      description: 'Jackpot prize winner!',
      imageUrl: DEFAULT_PRIZE_IMAGES.jackpot,
    },
  ], []);

  // Merge database prizes with defaults - database values take precedence
  const prizeConfig: PrizeConfig[] = useMemo(() => {
    // Group database prizes by priority to get images/descriptions
    const prizeByPriority = new Map<number, DatabasePrize>();
    databasePrizes.forEach(prize => {
      if (prize.priority !== null && prize.priority <= MAJOR_PRIZE_COUNT) {
        // Only keep the first prize of each priority (for the image/description)
        if (!prizeByPriority.has(prize.priority)) {
          prizeByPriority.set(prize.priority, prize);
        }
      }
    });

    return defaultPrizeConfig.map(defaultPrize => {
      const dbPrize = prizeByPriority.get(defaultPrize.priority);
      if (dbPrize) {
        // Use database values if valid, otherwise fall back to defaults
        // For imageUrl, validate that it's a proper URL to avoid broken images
        const dbImageUrl = isValidImageUrl(dbPrize.url) ? dbPrize.url : null;
        return {
          ...defaultPrize,
          name: dbPrize.prize || defaultPrize.name,
          description: dbPrize.description || defaultPrize.description,
          imageUrl: dbImageUrl || defaultPrize.imageUrl,
        };
      }
      return defaultPrize;
    });
  }, [defaultPrizeConfig, databasePrizes]);

  // Group winning tickets by prize tier from database
  // Major prizes have priority 1, 2, 3 (one winner each)
  const prizeTicketDistribution = useMemo(() => {
    const distribution: Map<string, DatabasePrize[]> = new Map();

    // Initialize all prize tiers
    prizeConfig.forEach(prize => {
      distribution.set(prize.name, []);
    });

    // Group database prizes by their priority/tier
    databasePrizes.forEach(prize => {
      if (prize.priority !== null && prize.priority >= 1 && prize.priority <= MAJOR_PRIZE_COUNT) {
        const prizeConfigItem = prizeConfig.find(p => p.priority === prize.priority);
        if (prizeConfigItem) {
          const tickets = distribution.get(prizeConfigItem.name) || [];
          tickets.push(prize);
          distribution.set(prizeConfigItem.name, tickets);
        }
      }
    });

    return distribution;
  }, [prizeConfig, databasePrizes]);

  // Fetch prize configuration and winning tickets from database
  useEffect(() => {
    const fetchPrizesAndClaimedTickets = async () => {
      // Determine the best identifier to use
      // Try competitionUid first if it's a valid UUID, otherwise use competitionId
      let lookupId = competitionUid;
      if (!competitionUid || competitionUid.trim() === '' || !UUID_REGEX.test(competitionUid)) {
        // Fall back to competitionId if uid is not a valid UUID
        if (competitionId && UUID_REGEX.test(competitionId)) {
          lookupId = competitionId;
        } else if (competitionId && competitionId.trim() !== '') {
          // Use competitionId even if not UUID format - the database might have entries matching it
          lookupId = competitionId;
        } else {
          setLoading(false);
          return;
        }
      }

      setLoading(true);
      try {
        // Fetch all prizes for this competition (major prizes have priority 1-3)
        const { data, error } = await supabase
          .from('Prize_Instantprizes')
          .select('UID, winningTicket, prize, url, description, priority, winningWalletAddress')
          .eq('competitionId', lookupId)
          .lte('priority', MAJOR_PRIZE_COUNT)
          .order('priority', { ascending: true } as any);

        if (!error && data) {
          // Store the full prize data
          setDatabasePrizes(data as DatabasePrize[]);

          // Build claimed tickets map
          const claimed = new Map<number, boolean>();
          data.forEach((prize: any) => {
            if (prize.winningTicket !== null) {
              claimed.set(prize.winningTicket, !!prize.winningWalletAddress);
            }
          });
          setClaimedTickets(claimed);
        }
      } catch (err) {
        console.error('Error fetching prizes:', err);
      }
      setLoading(false);
    };

    fetchPrizesAndClaimedTickets();
  }, [competitionUid, competitionId]);

  if (loading) {
    return (
      <div className="py-12">
        <Loader />
      </div>
    );
  }

  // Show message if no prizes configured yet (VRF not applied)
  const hasMajorPrizes = databasePrizes.length > 0;
  if (!hasMajorPrizes) {
    return (
      <div className="max-w-5xl mx-auto text-center py-8">
        <p className="text-white/60 sequel-45">
          Major prizes will be revealed once the competition is ready.
        </p>
      </div>
    );
  }

  // Build prize sections with tickets from database
  const prizeSections = prizeConfig.map(prize => {
    const prizePrizes = prizeTicketDistribution.get(prize.name) || [];
    const ticketEntries = prizePrizes.map((dbPrize, idx) => ({
      id: idx + 1,
      number: String(dbPrize.winningTicket),
      isWinner: !!dbPrize.winningWalletAddress,
    }));

    const claimedCount = ticketEntries.filter(t => t.isWinner).length;

    return {
      ...prize,
      tickets: ticketEntries,
      claimedCount,
      totalCount: prize.ticketCount,
    };
  });

  return (
    <div className="space-y-8">
      {prizeSections.map((prize, index) => (
        <PrizesHeader
          key={index}
          image={prize.imageUrl}
          title={prize.name}
          toBeWon={`${prize.claimedCount}/${prize.totalCount}`}
          details={<PrizesDetails tickets={prize.tickets} />}
        />
      ))}
    </div>
  );
};

export default KeyPrizesSection;
