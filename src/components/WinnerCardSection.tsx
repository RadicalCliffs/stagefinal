import { Swiper, SwiperSlide } from "swiper/react";
import { A11y, Navigation, Pagination } from "swiper/modules";
import "swiper/swiper-bundle.css";
import { SwiperNavButtons } from "./SwiperCustomNav";
import { WinnerCard } from "./WinnersCard";
import { useIsMobile } from "../hooks/useIsMobile";
import { useState, useEffect, useCallback, useRef } from "react";
import { database } from "../lib/database";
import { supabase } from "../lib/supabase";
import type { WinnerCardProps } from "../models/models";
import { useSectionTracking } from "../hooks/useSectionTracking";

// Polling interval as fallback (30 seconds)
const POLLING_INTERVAL_MS = 30000;

const WinnersV2 = () => {
  const isMobile = useIsMobile();
  const sectionRef = useSectionTracking("winners_section");
  const [winners, setWinners] = useState<WinnerCardProps[]>([]);
  const [loading, setLoading] = useState(true);
  const initialLoadDoneRef = useRef<boolean>(false);
  const lastFetchRef = useRef<number>(0);

  // Function to fetch winners with debouncing
  const fetchWinners = useCallback(async (force = false) => {
    // Debounce rapid calls (within 2 seconds) unless forced
    const now = Date.now();
    if (!force && now - lastFetchRef.current < 2000) {
      return;
    }
    lastFetchRef.current = now;

    // Only show loading on initial load
    if (!initialLoadDoneRef.current) {
      setLoading(true);
    }

    const data = await database.getAllWinners();
    setWinners(data);
    setLoading(false);
    initialLoadDoneRef.current = true;
  }, []);

  useEffect(() => {
    fetchWinners(true);

    // Set up real-time subscription for new winners
    const channel = supabase
      .channel("home-winners-updates")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "winners",
        },
        (payload) => {
          console.log("[WinnersV2] New winner detected:", payload.new);
          // Refresh winners list when new winner is added
          fetchWinners();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "winners",
        },
        (payload) => {
          console.log("[WinnersV2] Winner updated:", payload.new);
          // Refresh on updates (e.g., claimed status change)
          fetchWinners();
        },
      )
      .subscribe((status) => {
        console.log("[WinnersV2] Realtime subscription status:", status);
      });

    // Polling fallback - realtime can silently disconnect
    const pollInterval = setInterval(() => {
      console.log("[WinnersV2] Polling fallback - refreshing winners");
      fetchWinners();
    }, POLLING_INTERVAL_MS);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollInterval);
    };
  }, [fetchWinners]);

  const displayedWinners = winners.slice(0, 9);

  if (loading) {
    return (
      <div className="sm:py-12 pt-7 max-w-7xl mx-auto sm:px-4 2xl:px-0 text-white">
        <h1 className="text-white text-center uppercase sequel-75 sm:text-4xl text-2xl">
          Winners
        </h1>
        <div className="text-center py-12">
          <p className="text-white/70 sequel-45 text-lg">Loading winners...</p>
        </div>
      </div>
    );
  }

  if (displayedWinners.length === 0) {
    return (
      <div className="sm:py-12 pt-7 max-w-7xl mx-auto sm:px-4 2xl:px-0 text-white">
        <h1 className="text-white text-center uppercase sequel-75 sm:text-4xl text-2xl">
          Winners
        </h1>
        <div className="text-center py-12">
          <p className="text-white/70 sequel-45 text-lg">No winners yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={sectionRef}
      id="landing-page-winners"
      className=" max-w-7xl mx-auto md:px-4 px-5 2xl:px-0 text-white relative z-10 pt-0"
    >
      <h1 className="text-white text-center uppercase sequel-75 md:text-4xl text-2xl">
        Winners
      </h1>

      {isMobile ? (
        <Swiper
          modules={[Navigation, Pagination, A11y]}
          spaceBetween={20}
          loop
          slidesPerView={1}
          className="md:hidden mt-8  mx-auto text-white"
        >
          {displayedWinners.map((winner, idx) => (
            <SwiperSlide key={idx}>
              <WinnerCard {...winner} />
            </SwiperSlide>
          ))}
          <div className="mt-5">
            <SwiperNavButtons />
          </div>
        </Swiper>
      ) : (
        <div className="grid grid-cols-3 gap-8 md:mt-10 mt-8 ">
          {displayedWinners.map((winner, idx) => (
            <WinnerCard key={idx} {...winner} />
          ))}
        </div>
      )}
    </div>
  );
};

export default WinnersV2;
