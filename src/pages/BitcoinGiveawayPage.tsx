import { useEffect, useState } from 'react';
import { btcGiveaway, tokenLogo } from '../assets/images';
import Countdown from '../components/Countdown';
import { useIsMobile } from '../hooks/useIsMobile';
import EntriesWithFilterTabs from '../components/FinishedCompetition/EntriesWithFilterTabs';
import { database } from '../lib/database';
import Loader from '../components/Loader';
import { canEnterCompetition } from '../constants/competition-status';

const SLUG = 'bitcoin-giveaway';

const BitcoinGiveawayPage = () => {
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [heroData, setHeroData] = useState<any>(null);
  const [competition, setCompetition] = useState<any>(null);
  const [entriesRefreshKey, setEntriesRefreshKey] = useState(0);

  // Compute end date - use competition end date or default to 14 days from now
  const endDate = competition?.end_date || (() => {
    const date = new Date();
    date.setDate(date.getDate() + 14);
    return date.toISOString();
  })();

  // Compute ticket info from competition or use defaults
  const ticketPrice = competition?.ticket_price || 1;
  const totalTickets = competition?.total_tickets || 50000;
  const ticketsSold = competition?.tickets_sold || 0;

  // Check if competition has ended (sold out or status not accepting entries)
  const isSoldOut = totalTickets > 0 && ticketsSold >= totalTickets;
  const isNotAcceptingEntries = competition?.status && !canEnterCompetition(competition.status);
  const isEnded = isSoldOut || isNotAcceptingEntries;

  useEffect(() => {
    window.scrollTo(0, 0);

    const fetchData = async () => {
      setLoading(true);
      try {
        const data = await database.getHeroCompetitionBySlug(SLUG);
        if (data) {
          setHeroData(data.heroCompetition);
          setCompetition(data.competition);
        }
      } catch (error) {
        console.error('Error fetching competition data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // If we have a linked competition, use its ID for entries display
  const competitionId = competition?.id;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1A1A1A]">
      {/* Hero Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="bg-[#040404] rounded-2xl overflow-hidden border-2 border-white/10">
          {/* Image */}
          <div className="relative">
            <img
              src={btcGiveaway}
              alt="Bitcoin Giveaway"
              className="w-full h-[300px] sm:h-[500px] lg:h-[600px] object-cover"
            />
            <div className="absolute top-4 right-4 bg-[#DDE404] text-black px-4 py-2 rounded-lg sequel-75 text-sm sm:text-base">
              CRYPTO DRAW
            </div>
          </div>

          {/* Content */}
          <div className="p-6 sm:p-10">
            <div className="flex flex-col lg:flex-row gap-8 items-start lg:items-stretch">
              {/* Left Column */}
              <div className="flex-1">
                <h1 className="sequel-95 text-white text-3xl sm:text-4xl lg:text-5xl mb-4 leading-tight">
                  INSTANT CRYPTO KING: WIN 1 BTC
                </h1>
                <p className="sequel-45 text-white/80 text-base sm:text-lg leading-relaxed mb-6">
                  1 BTC. One draw. Unlimited envy. When this hits your wallet, your friends won't just notice, they'll wish they were you. Step into the arena and take your chance at walking away with the most iconic digital asset on the planet
                </p>

                {/* Key Features - Centered on mobile */}
                <div className="flex flex-col items-center lg:items-stretch">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8 w-full lg:w-auto lg:max-w-none max-w-[400px]">
                  <div className="bg-[#1A1A1A] border border-[#DDE404]/20 rounded-lg p-4">
                    <h3 className="sequel-75 text-[#DDE404] text-sm mb-1">PRIZE VALUE</h3>
                    <p className="sequel-45 text-white text-base sm:text-lg lg:text-xl">1 Bitcoin</p>
                  </div>
                  <div className="bg-[#1A1A1A] border border-[#DDE404]/20 rounded-lg p-4">
                    <h3 className="sequel-75 text-[#DDE404] text-sm mb-1">INSTANT TRANSFER</h3>
                    <p className="sequel-45 text-white text-base sm:text-lg lg:text-xl">To Your Wallet</p>
                  </div>
                  <div className="bg-[#1A1A1A] border border-[#DDE404]/20 rounded-lg p-4">
                    <h3 className="sequel-75 text-[#DDE404] text-sm mb-1">DRAW TYPE</h3>
                    <p className="sequel-45 text-white text-base sm:text-lg lg:text-xl">Provably Fair</p>
                  </div>
                  <div className="bg-[#1A1A1A] border border-[#DDE404]/20 rounded-lg p-4">
                    <h3 className="sequel-75 text-[#DDE404] text-sm mb-1">ENTRY COST</h3>
                    <p className="sequel-45 text-white text-base sm:text-lg lg:text-xl">Just ${ticketPrice.toFixed(2)}</p>
                  </div>
                </div>

                {/* Countdown - Centered on mobile */}
                <div className="bg-[#1A1A1A] border border-[#DDE404]/30 rounded-xl p-6 mb-6 w-full lg:w-auto lg:max-w-none max-w-[400px]">
                  <h3 className="sequel-75 text-[#DDE404] text-sm sm:text-base mb-3 text-center">DRAW CLOSES IN</h3>
                  <div className="flex justify-center">
                    <Countdown endDate={endDate} isEnded={isEnded} />
                  </div>
                </div>
                </div>
              </div>

              {/* Right Column - Entry Card */}
              <div className="w-full lg:w-[400px]">
                <div className="bg-white rounded-xl p-6 border-2 border-[#DDE404]">
                  <div className="flex justify-center mb-6">
                    <img src={tokenLogo} alt="ThePrize.io" className="h-12 w-auto" />
                  </div>

                  <div className="text-center mb-6">
                    <div className="sequel-95 text-4xl sm:text-5xl lg:text-6xl text-black">${ticketPrice.toFixed(2)}</div>
                    <p className="sequel-45 text-black/70 mt-1">per entry</p>
                  </div>

                  <div className="space-y-3 mb-6">
                    <div className="flex justify-between items-center py-2 border-b border-black/10">
                      <span className="sequel-45 text-black/70 text-sm">Total Entries</span>
                      <span className="sequel-75 text-black">{totalTickets.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-black/10">
                      <span className="sequel-45 text-black/70 text-sm">Entries Sold</span>
                      <span className="sequel-75 text-black">{ticketsSold.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center py-2">
                      <span className="sequel-45 text-black/70 text-sm">Your Odds</span>
                      <span className="sequel-75 text-[#EF008F]">1 in {totalTickets.toLocaleString()}</span>
                    </div>
                  </div>

                  <p className="sequel-45 text-black/50 text-xs text-center">
                    Fair play. Fixed odds. Provably fair draws.
                  </p>
                </div>

                {/* Ticket Selection Tools - Coming Soon */}
                <div className="mt-6">
                  <div className="bg-[#1A1A1A] border border-[#DDE404]/20 rounded-xl p-6 text-center">
                    <p className="sequel-75 text-white mb-2">Coming soon!</p>
                    <p className="sequel-45 text-white/60 text-sm">
                      This crypto draw is not yet open for entries. Check back soon!
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Prize Details */}
            <div className="mt-12 pt-8 border-t border-white/10">
              <h2 className="sequel-95 text-white text-2xl sm:text-3xl mb-6">What You'll Win</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <h3 className="sequel-75 text-[#DDE404] mb-2">1 Full Bitcoin</h3>
                  <p className="sequel-45 text-white/70 text-sm">
                    Receive 1 complete Bitcoin directly to your wallet. No strings attached, no fees deducted.
                  </p>
                </div>
                <div>
                  <h3 className="sequel-75 text-[#DDE404] mb-2">Instant Transfer</h3>
                  <p className="sequel-45 text-white/70 text-sm">
                    Bitcoin transferred to your wallet immediately after the draw. Watch it arrive in real-time.
                  </p>
                </div>
                <div>
                  <h3 className="sequel-75 text-[#DDE404] mb-2">Tax Documentation</h3>
                  <p className="sequel-45 text-white/70 text-sm">
                    We provide all necessary documentation for tax purposes. Clean, transparent, and above board.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Entries Table Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {competitionId ? (
          <EntriesWithFilterTabs
            key={entriesRefreshKey}
            competitionId={competitionId}
            competitionUid={competitionId}
          />
        ) : (
          <div className="py-10 space-y-8 max-w-7xl mx-auto">
            <h2 className="text-white sequel-95 text-2xl">Entries</h2>
            <div className="text-center text-white/50 sequel-45 py-10 border-2 border-[#DDE404] rounded-2xl">
              No entries yet for this competition. Be the first to enter!
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BitcoinGiveawayPage;
