import { useNavigate } from "react-router";
import { bitcoinV2, smashGraphic } from "../assets/images";
import CompetitionPageTabs from "../components/CompetitionPageTabs";
import Heading from "../components/Heading";
import LiveCompetitionCard from "../components/LiveCompetitionCard";
import { scrollToSection } from "../utils/util";
import FaqSection from "../components/Faqs";
import NeverMissGame from "../components/NeverMissGame";
import CashOutLikeAPro from "../components/CashOutLikeAPro";
import { useState, useEffect } from "react";
import Loader from "../components/Loader";
import type { Competition } from "../models/models";
import { useCompetitions } from "../hooks/useFetchCompetitions";

const CompetitionsPage = () => {
  const [tick, setTick] = useState(0);
  const [liveVisible, setLiveVisible] = useState(8);
  const [instantVisible, setInstantVisible] = useState(8);
  const [lastChanceVisible, setLastChanceVisible] = useState(8);
  const [drawnVisible, setDrawnVisible] = useState(8);
  const navigate = useNavigate();

  const {
    liveCompetitions,
    instantWinCompetitions,
    lastChanceCompetitions,
    drawnCompetitions,
    loading,
  } = useCompetitions();

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
      "0"
    )}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };

  void tick;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader />
      </div>
    );
  }

  return (
    <div>
      <div className="custom-competition-page-background bg-full-size absolute inset-0 w-full h-full"></div>
      <div className="relative xl:px-0 sm:px-6 px-0">
        <p className="text-center sm:max-w-4xl max-w-sm mt-9 mx-auto py-3 rounded-t-xl bg-[#E5EE00] text-[#181818] sequel-75 uppercase sm:text-xl text-lg ">
          Competitions
        </p>
        <CompetitionPageTabs />
        <div id="live" className="relative sm:mt-11 mt-6 sm:mb-16 mb-12">
          <Heading
            text="Live Competitions"
            classes="text-white sequel-95 sm:mb-14 mb-11"
          />
          <div
            className={`grid 2xl:grid-cols-4 lg:grid-cols-3 grid-cols-2 2xl:gap-x-4 sm:gap-y-10 gap-x-3 gap-y-7 max-w-7xl mx-auto xl:px-0 sm:px-6 px-3`}
          >
            {liveCompetitions.slice(0, liveVisible).map((comp: Competition) => {
              const rawProgress =
                ((comp.tickets_sold || comp.entries_sold || 0) / (comp.total_tickets || comp.total_entries || 1)) * 100;
              const progressPercent = Number.isFinite(rawProgress)
                ? rawProgress
                : 0;
              return (
                <LiveCompetitionCard
                  id={comp.id}
                  key={comp.id}
                  image={comp.image_url || bitcoinV2}
                  title={comp.title}
                  price={parseFloat(String(comp.ticket_price || comp.entry_fee || '0'))}
                  timeRemaining={calculateTimeRemaining(
                    comp.end_date ?? Date.now()
                  )}
                  endDate={comp.end_date}
                  entriesSold={`${Math.round(progressPercent)}`}
                  progressPercent={progressPercent === 0 ? 10 : progressPercent}
                  onEnter={() => navigate(`/competitions/${comp.id}`)}
                  isInstantWin={comp.is_instant_win || undefined}
                  onchainCompetitionId={comp.onchain_competition_id}
                  isSoldOut={(comp.total_tickets || 0) > 0 && (comp.tickets_sold || 0) >= (comp.total_tickets || 0)}
                />
              );
            })}
          </div>
          {liveCompetitions.length > liveVisible && (
            <div className="text-center md:mt-14 mt-8">
              <button
                onClick={() => setLiveVisible((prev) => prev + 8)}
                className="uppercase border border-white sm:py-2 pt-[0.6rem] pb-1 px-10 rounded-lg sequel-95 hover:bg-[#DDE404]/90 sm:text-[1.3rem] text-xl cursor-pointer custom-box-shadow bg-[#DDE404] text-[#280508] sm:w-96 max-w-full"
              >
                Load More
              </button>
            </div>
          )}
        </div>
      </div>
      <div
        id="instant-win"
        className="bg-[#1A1A1A] sm:pb-16 pb-12 xl:px-0 sm:px-6 px-3 relative"
      >
        <Heading
          text="Instant Win Competitions"
          classes="text-white sequel-95 sm:pt-14 pt-8 sm:mb-14 mb-10"
        />
        <div
          className={`grid 2xl:grid-cols-4 lg:grid-cols-3 grid-cols-2 2xl:gap-x-4 sm:gap-y-10 gap-x-3 gap-y-7  max-w-7xl mx-auto`}
        >
          {instantWinCompetitions
            .slice(0, instantVisible)
            .map((comp: Competition) => {
              const rawProgress =
                ((comp.tickets_sold || comp.entries_sold || 0) / (comp.total_tickets || comp.total_entries || 1)) * 100;
              const progressPercent = Number.isFinite(rawProgress)
                ? rawProgress
                : 0;
              return (
                <LiveCompetitionCard
                  id={comp.id}
                  key={comp.id}
                  image={comp.image_url || bitcoinV2}
                  title={comp.title}
                  price={parseFloat(String(comp.ticket_price || comp.entry_fee || '0'))}
                  timeRemaining={calculateTimeRemaining(
                    comp.created_at ?? Date.now()
                  )}
                  endDate={comp.end_date}
                  entriesSold={`${Math.round(progressPercent)}`}
                  progressPercent={progressPercent === 0 ? 10 : progressPercent}
                  onEnter={() => navigate(`/competitions/${comp.id}`)}
                  isInstantWin={true}
                  onchainCompetitionId={comp.onchain_competition_id}
                  isSoldOut={(comp.total_tickets || 0) > 0 && (comp.tickets_sold || 0) >= (comp.total_tickets || 0)}
                />
              );
            })}
        </div>
        {instantWinCompetitions.length > instantVisible && (
            <div className="text-center md:mt-14 mt-8">
              <button
                onClick={() =>
                  setInstantVisible((prev) => prev + 8)
                }
                className="uppercase border border-white sm:py-2 pt-[0.6rem] pb-1 px-10 rounded-lg sequel-95 hover:bg-[#DDE404]/90 sm:text-[1.3rem] text-xl cursor-pointer custom-box-shadow bg-[#DDE404] text-[#280508] sm:w-96 max-w-full"
              >
                Load More
              </button>
            </div>
          )}
      </div>
      <div
        id="last-chance"
        className="xl:px-0 sm:px-6 px-3 relative sm:pb-16 pb-12"
      >
        <Heading
          text="Last Chance Competitions"
          classes="text-[#DDE404] sequel-95 sm:mt-13 mt-8 sm:mb-14 mb-10"
        />
        <div
          className={`grid 2xl:grid-cols-4 lg:grid-cols-3 grid-cols-2 2xl:gap-x-4 sm:gap-y-10 gap-x-3 gap-y-7  max-w-7xl mx-auto ${
            lastChanceVisible < 8 &&
            lastChanceCompetitions.length > lastChanceVisible
              ? ""
              : ""
          }`}
        >
          {lastChanceCompetitions
            .slice(0, lastChanceVisible)
            .map((comp: Competition) => {
              const rawProgress =
                ((comp.tickets_sold || comp.entries_sold || 0) / (comp.total_tickets || comp.total_entries || 1)) * 100;
              const progressPercent = Number.isFinite(rawProgress)
                ? rawProgress
                : 0;
              return (
                <LiveCompetitionCard
                  id={comp.id}
                  key={comp.id}
                  image={comp.image_url || bitcoinV2}
                  title={comp.title}
                  price={parseFloat(String(comp.ticket_price || comp.entry_fee || '0'))}
                  timeRemaining={calculateTimeRemaining(
                    comp.created_at ?? Date.now()
                  )}
                  endDate={comp.end_date}
                  entriesSold={`${Math.round(progressPercent)}`}
                  progressPercent={progressPercent === 0 ? 10 : progressPercent}
                  onEnter={() => navigate(`/competitions/${comp.id}`)}
                  className="!border-[#DDE404]"
                  isLastChanceCompetition
                  isInstantWin={comp.is_instant_win || undefined}
                  onchainCompetitionId={comp.onchain_competition_id}
                  isSoldOut={(comp.total_tickets || 0) > 0 && (comp.tickets_sold || 0) >= (comp.total_tickets || 0)}
                />
              );
            })}
        </div>
        {lastChanceCompetitions.length > lastChanceVisible && (
            <div className="text-center md:mt-14 mt-8">
              <button
                onClick={() =>
                  setLastChanceVisible((prev) => prev + 8)
                }
                className="uppercase border border-white sm:py-2 pt-[0.6rem] pb-1 px-10 rounded-lg sequel-95 hover:bg-[#DDE404]/90 sm:text-[1.3rem] text-xl cursor-pointer custom-box-shadow bg-[#DDE404] text-[#280508] sm:w-96 max-w-full "
              >
                Load More
              </button>
            </div>
          )}
      </div>
      <div
        id="drawn"
        className="bg-[#1A1A1A] sm:pb-16 pb-12 xl:px-0 sm:px-6 px-3 relative"
      >
        <Heading
          text="Drawn Competitions"
          classes="text-[#EF008F] sequel-95 sm:pt-14 pt-8 sm:mb-14 mb-10"
        />
        <div
          className={`grid 2xl:grid-cols-4 lg:grid-cols-3 grid-cols-2 2xl:gap-x-4 sm:gap-y-10 gap-x-3 gap-y-7  max-w-7xl mx-auto ${
            drawnVisible < 8 && drawnCompetitions.length > drawnVisible
              ? ""
              : ""
          }`}
        >
          {drawnCompetitions.slice(0, drawnVisible).map((comp: Competition) => {
            const rawProgress =
              ((comp.tickets_sold || comp.entries_sold || 0) / (comp.total_tickets || comp.total_entries || 1)) * 100;
            const progressPercent = Number.isFinite(rawProgress) ? rawProgress : 0;
            return (
              <LiveCompetitionCard
                id={comp.id}
                key={comp.id}
                image={comp.image_url || bitcoinV2}
                title={comp.title}
                price={parseFloat(String(comp.ticket_price || comp.entry_fee || '0'))}
                timeRemaining="00:00:00:00"
                ticketsSold={`${Math.round(progressPercent)}`}
                progressPercent={progressPercent === 0 ? 10 : progressPercent}
                onEnter={() => navigate(`/competitions/${comp.id}`)}
                className="!border-[#EF008F]"
                isCompetitionFinished={true}
                isInstantWin={comp.is_instant_win || undefined}
                onchainCompetitionId={comp.onchain_competition_id}
              />
            );
          })}
        </div>
        {drawnCompetitions.length > drawnVisible && (
          <div className="text-center md:mt-14 mt-8">
            <button
              onClick={() => setDrawnVisible((prev) => prev + 8)}
              className="uppercase border border-white sm:py-2 pt-[0.6rem] pb-1 px-10 rounded-lg sequel-95 hover:bg-[#DDE404]/90 sm:text-[1.3rem] text-xl cursor-pointer custom-box-shadow bg-[#DDE404] text-[#280508] sm:w-96 max-w-full"
            >
              Load More
            </button>
          </div>
        )}
        <div className="text-center md:mt-14 mt-8">
          <button
            onClick={() => scrollToSection("live")}
            className="uppercase border border-white sm:pt-3 sm:pb-[14.5px] pt-3 pb-2 sm:text-base text-xs sm:px-10 px-3 rounded-lg sequel-95 hover:bg-[#DDE404]/90 cursor-pointer custom-box-shadow bg-[#DDE404] text-[#280508] w-[600px] max-w-full"
          >
            RETURN TO LIVE COMPETITIONS
          </button>
        </div>
      </div>

      <div className=" relative overflow-hidden">
        <img
          src={smashGraphic}
          alt="smashGraphic"
          className="absolute -left-[4%] top-[35%]  w-12/12 mx-auto xl:block hidden"
        />
        <div className="relative">
          <div className="mt-9 mb-11 xl:px-0 px-4 ">
            <CashOutLikeAPro />
          </div>
          <div className="mt-11 lg:px-0 px-4">
            <NeverMissGame />
          </div>
          <div className="mt-11 sm:mb-14 xl:px-0 px-4">
            <FaqSection />
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompetitionsPage;
