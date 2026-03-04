import { useState, useEffect } from "react";
import FilterTabs from "./FilterButtons";
import LiveCompetitionCard from "./LiveCompetitionCard";
import { useNavigate } from "react-router";
import { database } from "../lib/database";
import Loader from "./Loader";
import type { Competition } from "../models/models";
import { bitcoinV2 } from "../assets/images";
import { useCompetitions } from "../hooks/useFetchCompetitions";
import LandingPageTabs from "./LandingPageTabs";
import { useSectionTracking } from "../hooks/useSectionTracking";

const LiveCompetitionSection = () => {
  const sectionRef = useSectionTracking("live_competitions_section");

  const OPTIONS = [
    { label: "Bitcoin", key: "bitcoin" },
    { label: "Cars & Watches", key: "car-watches" },
    { label: "Instant Wins", key: "instant-wins" },
    { label: "High Rollers", key: "high-rollers" },
    { label: "Nft's", key: "nft" },
    { label: "Alt Coins", key: "alt-coins" },
  ];

  const [activeTab, setActiveTab] = useState<{
    label: string;
    key: string;
  } | null>(null);
  // const [competitions, setCompetitions] = useState<any[]>([]);
  // const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [visibleCount, setVisibleCount] = useState(4);
  const navigate = useNavigate();

  const { liveCompetitions, loading } = useCompetitions();

  // useEffect(() => {
  //     const fetchCompetitions = async () => {
  //         setLoading(true);
  //         const data = await database.getCompetitionsV2('active');
  //         const now = new Date().getTime();
  //         // const liveCompetitionsWithImages = data.filter(comp => {
  //         //     const hasImage = comp.image_url && comp.image_url.length > 0;
  //         //     const isLive = comp.end_date && new Date(comp.end_date).getTime() > now;
  //         //     return hasImage && isLive;
  //         // });
  //         setCompetitions(data);
  //         setLoading(false);
  //     };
  //     fetchCompetitions();
  // }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setTick((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const calculateTimeRemaining = (endDate: string) => {
    const end = new Date(endDate).getTime();
    const now = new Date().getTime();
    const diff = end - now;

    if (diff <= 0) return "00:00:00:00";

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    return `${String(days).padStart(2, "0")}:${String(hours).padStart(
      2,
      "0",
    )}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };

  // const filteredCompetitions = competitions.filter(comp => {
  //     if (!activeTab) return true;
  //     if (activeTab.key === 'instant-wins') return comp.is_instant_win;
  //     if (activeTab.key === 'bitcoin') return comp.prize_type.toLowerCase().includes('crypto') && comp.title.toLowerCase().includes('bitcoin');
  //     if (activeTab.key === 'nft') return comp.prize_type.toLowerCase().includes('nft');
  //     return true;
  // });

  const displayedCompetitions = liveCompetitions.slice(0, visibleCount);
  const canLoadMore =
    visibleCount < 8 && liveCompetitions.length > visibleCount;

  const handleLoadMore = () => {
    setVisibleCount((prev) => Math.min(prev + 4, 8));
  };

  if (loading) {
    return (
      <div className="py-20">
        <Loader />
      </div>
    );
  }

  return (
    <div ref={sectionRef} className="relative ">
      <FilterTabs
        containerClasses="sm:grid hidden lg:grid-cols-3 sm:grid-cols-2 grid-cols-1 lg:gap-x-2 lg:gap-y-3 sm:gap-4 gap-3 sm:px-0 px-5 max-w-7xl mx-auto"
        active={activeTab}
        options={OPTIONS}
        onChange={(tab) => {
          setActiveTab(tab);
          setVisibleCount(4);
        }}
        buttonClasses="bg-white/15 !rounded-lg lg:text-sm"
      />
      <div className="sm:hidden block">
        <LandingPageTabs />
      </div>
      <div className="md:pt-14 pt-12 grid 2xl:grid-cols-4 lg:grid-cols-3 grid-cols-2 2xl:gap-x-4 2xl:gap-y-8 gap-x-4 sm:gap-y-8 gap-y-7 max-w-7xl mx-auto">
        {displayedCompetitions.map((comp: Competition) => {
          const rawProgress =
            ((comp.tickets_sold || comp.entries_sold || 0) /
              (comp.total_tickets || comp.total_entries || 1)) *
            100;
          const progressPercent = Number.isFinite(rawProgress)
            ? rawProgress
            : 0;

          return (
            <LiveCompetitionCard
              id={comp.id}
              key={comp.id}
              image={comp.image_url || bitcoinV2}
              title={comp.title}
              price={parseFloat(
                String(comp.ticket_price || comp.entry_fee || "0"),
              )}
              endDate={comp.end_date || comp.draw_date || undefined}
              timeRemaining={calculateTimeRemaining(
                comp.end_date || comp.draw_date || new Date().toISOString(),
              )}
              entriesSold={`${Math.round(progressPercent)}`}
              ticketsSold={comp.tickets_sold || comp.entries_sold || 0}
              totalTickets={comp.total_tickets || comp.total_entries || 0}
              progressPercent={progressPercent === 0 ? 10 : progressPercent}
              onEnter={() => navigate(`/competitions/${comp.id}`)}
              isInstantWin={comp.is_instant_win || undefined}
              onchainCompetitionId={
                comp.onchain_competition_id
                  ? Number(comp.onchain_competition_id)
                  : undefined
              }
            />
          );
        })}
      </div>
      {canLoadMore && (
        <div className="text-center sm:mt-13 mt-7">
          <button
            onClick={handleLoadMore}
            className="uppercase border border-white py-3 px-10 rounded-lg sequel-95 hover:bg-[#DDE404]/90 sm:text-lg  text-sm cursor-pointer custom-box-shadow bg-[#DDE404] text-[#280508]  max-w-full"
          >
            Browse All <span className="sm:inline hidden">Competitions</span>{" "}
            <span className="sm:hidden inline">Comps</span>
          </button>
        </div>
      )}
      {liveCompetitions.length === 0 && (
        <div className="text-center py-12">
          <p className="text-white/70 sequel-45 text-lg">
            No competitions found in this category.
          </p>
        </div>
      )}
    </div>
  );
};

export default LiveCompetitionSection;
