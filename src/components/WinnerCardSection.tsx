import { Swiper, SwiperSlide } from "swiper/react";
import { A11y, Navigation, Pagination } from "swiper/modules";
import "swiper/swiper-bundle.css";
import { SwiperNavButtons } from "./SwiperCustomNav";
import { WinnerCard } from "./WinnersCard";
import { useIsMobile } from "../hooks/useIsMobile";
import { useMemo } from "react";
import { database } from "../lib/database";
import type { WinnerCardProps } from "../models/models";
import { useSectionTracking } from "../hooks/useSectionTracking";
import { useLiveData } from "../hooks/useLiveData";

const WinnersV2 = () => {
  const isMobile = useIsMobile();
  const sectionRef = useSectionTracking("winners_section");

  // Fetch winners with realtime updates
  const { data: winners, loading } = useLiveData<WinnerCardProps[]>({
    fetchFn: () => database.getAllWinners(),
    tables: ["winners"],
    channelName: "home-winners",
  });

  const displayedWinners = useMemo(
    () => (winners || []).slice(0, 9),
    [winners],
  );

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
