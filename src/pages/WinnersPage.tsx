import { useState, useEffect, useCallback } from "react";
import Activity from "../components/Activity";
import { FilterIcon, List, Search, SlidersHorizontal, X } from "lucide-react";
import { database } from "../lib/database";
import { supabase } from "../lib/supabase";
import { WinnerCard } from "../components/WinnersCard";
import type { WinnerCardProps } from "../models/models";
import Heading from "../components/Heading";
import FilterTabs from "../components/FilterButtons";
import type { Options } from "../models/models";
import NeverMissGame from "../components/NeverMissGame";
import FaqSection from "../components/Faqs";
import {
  chainImg,
  discord,
  discordV2,
  dominoImg,
  dominoResponsiveImg,
  instagram,
  instagramV2,
  telegram,
  telegramV2,
  twitter,
  twitterV2,
} from "../assets/images";
import { Link } from "react-router";

const WinnersPage = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterOption, setFilterOption] = useState<Options>({
    label: "All",
    key: "all",
  });
  const [winners, setWinners] = useState<WinnerCardProps[]>([]);
  const [loading, setLoading] = useState(true);
  const [displayCount, setDisplayCount] = useState(9);
  const [showSearchBar, setShowSearchBar] = useState(false);

  // Function to fetch winners
  const fetchWinners = useCallback(async () => {
    setLoading(true);
    const data = await database.getWinners(50);
    setWinners(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchWinners();

    // Set up real-time subscription for new winners
    const channel = supabase
      .channel('winners-updates')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'winners'
        },
        (payload) => {
          console.log('New winner detected:', payload.new);
          // Refresh winners list when new winner is added
          fetchWinners();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'competitions',
          filter: 'status=eq.completed'
        },
        (payload) => {
          console.log('Competition completed:', payload.new);
          // Refresh winners when a competition is marked as completed
          fetchWinners();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchWinners]);

  const handleLoadMore = () => {
    setDisplayCount((prev) => prev + 9);
  };

  const filterOptions: Options[] = [
    { label: "All", key: "all" },
    { label: "Filter by Prize", key: "prize" },
    { label: "Sort by Date", key: "date" },
  ];

  const filteredWinners = winners.filter((winner) => {
    const matchesSearch =
      winner.prize.toLowerCase().includes(searchTerm.toLowerCase()) ||
      winner.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
      winner.country.toLowerCase().includes(searchTerm.toLowerCase());

      return matchesSearch;
    });
    
  const displayedWinners = filteredWinners.slice(0, displayCount);
  const hasMore = displayCount < filteredWinners.length;

  return (
    <div className="overflow-x-hidden w-full">
      <div className="custom-winners-page-background bg-full-size absolute inset-0 w-full h-full"></div>
      <div className="relative xl:px-0 sm:px-4 sm:py-8 py-8 overflow-x-hidden">
        <div className="max-w-7xl mx-auto ">
          <section className="sm:px-0 px-4 max-[450px]:px-2">
            <Heading
              text="Winners Hall of Fame"
              classes="text-white mb-[1.63rem] sm:block hidden"
            />
            <Heading
              text="Winners"
              classes="text-white sm:mb-[1.63rem] mb-[1.3rem] sm:hidden block max-[650px]:text-2xl"
            />
            <p className="text-center text-white sequel-45 max-w-2xl mx-auto sm:mb-14 mb-9 sm:text-lg text-base leading-relaxed px-2">
              Congratulations to our latest winners! Check out the lucky
              participants who took home amazing{" "}
              <span className="text-[#DDE404]">prizes.</span>
            </p>

            <div className="max-w-7xl mx-auto space-y-4 sm:space-y-6 mb-10">
              <div className="flex sm:gap-4 gap-2">
                <div className="relative flex-1 bg-[#2A2A2A] rounded-xl sm:block hidden">
                  <input
                    type="text"
                    placeholder="Search by username, prize, or country..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full  border border-white/20 rounded-xl pt-3.5 pb-4 px-4 text-white placeholder:text-gray-400 sequel-45 focus:outline-none focus:border-[#DDE404] transition-colors text-sm "
                  />
                  <Search
                    className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 text-[#DDE404]"
                    size={20}
                  />
                </div>
                <div className="flex sm:flex-none flex-1 items-center cursor-pointer justify-between sm:gap-4 gap-2 bg-[#2A2A2A] border border-white/20 rounded-xl pb-[0.563rem] pt-[0.688rem] sm:pt-3.5 sm:pb-4 sm:px-6 px-3">
                  <p className="sequel-45 text-gray-400 sm:text-sm text-xs max-[410px]:text-[0.65rem]">
                    Filter <span className="sm:inline hidden">By</span> Date
                  </p>
                  <SlidersHorizontal color="#DDE404" size={18} />
                </div>
                <div className="flex sm:flex-none flex-1 cursor-pointer items-center justify-between  sm:gap-4 gap-2 bg-[#2A2A2A] border border-white/20 rounded-xl pb-[0.563rem] pt-[0.688rem] sm:pt-3.5 sm:pb-4 sm:px-6 px-3">
                  <p className="sequel-45 text-gray-400 sm:text-sm text-xs max-[410px]:text-[0.65rem]">
                    Sort <span className="sm:inline hidden">By</span> Category
                  </p>
                  <List color="#DDE404" size={18} />
                </div>
                <div className="sm:hidden bg-[#2A2A2A] border border-white/20 cursor-pointer rounded-xl flex justify-center items-center min-w-12 max-[410px]:min-w-10 min-h-8">
                  {showSearchBar ? (
                    <X
                      onClick={() => setShowSearchBar(false)}
                      className="text-[#DDE404]"
                      size={20}
                    />
                  ) : (
                    <Search
                      onClick={() => setShowSearchBar(true)}
                      className="text-[#DDE404]"
                      size={20}
                    />
                  )}
                </div>
              </div>
              <Activity mode={showSearchBar ? "visible" : "hidden"}>
                <div className="relative flex-1 bg-[#2A2A2A] rounded-xl sm:hidden">
                  <input
                    type="text"
                    placeholder="Search by username, prize, or country..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full  border border-white/20 rounded-xl pt-2.5 pb-2 px-4 text-white placeholder:text-gray-400 sequel-45 focus:outline-none focus:border-[#DDE404] transition-colors text-xs"
                  />
                </div>
              </Activity>

              {/* <FilterTabs
                options={filterOptions}
                active={filterOption}
                onChange={setFilterOption}
                containerClasses="flex flex-wrap justify-center gap-2 sm:gap-3"
                buttonClasses="sm:min-w-[140px] min-w-[90px] text-xs sm:text-base py-2.5 sm:py-2"
              /> */}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-5xl mx-auto sm:px-0 ">
              {displayedWinners.map((winner, index) => (
                <WinnerCard key={index} {...winner} />
              ))}
            </div>

            {loading && (
              <div className="text-center py-12">
                <p className="text-white/70 sequel-45 text-lg">
                  Loading winners...
                </p>
              </div>
            )}

            {!loading && filteredWinners.length === 0 && (
              <div className="text-center py-12">
                <p className="text-white/70 sequel-45 text-lg">
                  No winners found matching your search.
                </p>
              </div>
            )}

            {hasMore && (
              <div className="text-center mt-8">
                <button
                  onClick={handleLoadMore}
                  className="uppercase border border-white sm:pt-2 sm:pb-2.5 pt-[0.6rem] pb-1 px-10 rounded-lg sequel-95 hover:bg-[#DDE404]/90 sm:text-[1.3rem] text-xl cursor-pointer custom-box-shadow bg-[#DDE404] text-[#280508] sm:w-72 max-w-full"
                >
                  Load More
                </button>
              </div>
            )}
          </section>

          <section className="max-w-5xl mx-auto mt-8">
            <div className="bg-[#1A1A1A] sm:rounded-3xl rounded-xs px-0 py-12 sm:py-16 sm:px-12 border border-white/10">
              <Heading
                text="How Winners Are Chosen"
                classes="text-white mb-8 sm:mb-12 max-[600px]:text-3xl px-4"
              />
              <img
                src={chainImg}
                alt="chain-img"
                className="mx-auto sm:w-auto w-[200px]"
              />
              <p className="text-white sequel-45 text-center sm:text-xl mt-8 mb-2 leading-relaxed px-4 sm:px-1">
                At ThePrize.io, fairness is built into every draw. Using{" "}
                <span className="text-[#DDE404] sequel-75">Chainlink VRF</span>,
                we generate results that are verifiably random, tamper-proof and
                transparent. With cryptographic randomness backed by on-chain
                verification, every draw is completely unbiased ensuring each
                outcome is truly unpredictable. What you see is what you get,
                trust backed by blockchain.
              </p>

              {/* <div className="flex justify-center">
                <Link
                  to="/how-to-play"
                  className="bg-[#DDE404] hover:bg-[#DDE404]/90 text-black sequel-75 uppercase py-2.5 sm:py-3 px-6 sm:px-8 rounded-xl border border-white cursor-pointer transition-all inline-block text-xs sm:text-base w-10/12 sm:w-auto text-center"
                >
                  Learn More About Our Process
                </Link>
              </div> */}
            </div>
          </section>

          <section className="relative overflow-hidden rounded-2xl sm:rounded-3xl sm:w-auto w-11/12 mx-auto sm:mt-12 mt-9">
            {/* <div className="absolute inset-0 bg-linear-to-br from-[#EF008F] via-[#8B008B] to-[#1A1A1A] opacity-90"></div> */}
            <img
              src={dominoImg}
              alt="domino-img"
              className="md:block  brightness-[90%] hidden mx-auto rounded-tl-3xl w-full h-8/12 object-cover rounded-bl-3xl max-h-[554px]"
            />
            <img
              src={dominoResponsiveImg}
              alt="domino-img"
              className="md:hidden block mx-auto rounded-tl-3xl w-full h-8/12 object-cover rounded-bl-3xl max-h-[554px] brightness-[60%]"
            />
            <div className="z-10 xl:left-20 md:left-10 w-full md:text-left text-center absolute top-1/2 -translate-y-1/2 md:px-0 px-4">
              <h2 className="sequel-45 uppercase md:text-xl mb-3 sm:mb-4 leading-tight text-white max-[400px]:text-sm">
                Want to be our next winner?
              </h2>
              <h3 className="sequel-95 uppercase sm:text-4xl text-2xl max-[400px]:text-xl mb-6 text-white leading-snug">
                Enter our latest <br className="sm:block hidden" /> competition
                for a <br className="sm:block hidden" /> chance to win big!
              </h3>

              <Link
                to="/competitions"
                className="bg-[#DDE404] w-9/12 sm:w-fit sequel-95 md:text-2xl text-xl max-[400px]:text-base uppercase sm:pt-[10px] sm:pb-3 pt-3 pb-2 xl:px-7 px-4 rounded-md border border-white xl:mt-10 cursor-pointer max-[400px]:mt-5 mt-10 sm:mt-6 hover:bg-[#dde404]/90 flex items-center justify-center md:mx-0 mx-auto"
              >
                Enter Now
              </Link>

              <div className="flex flex-wrap md:justify-normal justify-center items-center gap-7 mt-6 sm:mt-8">
                <p className="sequel-45  text-base text-white max-[400px]:text-sm">
                  Follow Us on Social Media for More Winner Announcements!
                </p>

                <div className="flex items-center space-x-6 justify-center ">
                  <a href="https://www.instagram.com/theprize.io/" className="hover:scale-110 transition-transform">
                    <img src={instagram} className="w-14" alt="instagram" />
                  </a>
                  <a href="https://t.me/theprizeannouncements" className="hover:scale-110 transition-transform">
                    <img src={telegram} className="w-14" alt="telegram" />
                  </a>
                  <a href="https://x.com/the_prize_io" className="hover:scale-110 transition-transform">
                    <img src={twitter} className="w-14" alt="X / Twitter" />
                  </a>
                  <a href="https://discord.com/invite/theprize" className="hover:scale-110 transition-transform">
                    <img src={discord} className="w-14" alt="discord" />
                  </a>
                </div>
              </div>
            </div>
          </section>
          <div className="lg:px-0 px-4 sm:mt-17 mt-11">
            <NeverMissGame />
          </div>
          <div className="mt-11 xl:px-0 px-4">
            <FaqSection />
          </div>
        </div>
      </div>
    </div>
  );
};

export default WinnersPage;
