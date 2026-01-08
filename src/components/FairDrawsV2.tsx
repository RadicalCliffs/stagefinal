import { Link } from "react-router";
import { Swiper, SwiperSlide } from "swiper/react";
import "swiper/swiper-bundle.css";

import { arrow, crown, fairDrawBg, rocket, ticket } from "../assets/images";
import { SwiperNavButtons } from "./SwiperCustomNav";
import { useIsMobile } from "../hooks/useIsMobile";

const FairDrawsV2 = () => {
  const isMobile = useIsMobile();

  const cardData = [
    {
      img: ticket,
      title: "Transparent Entry System",
      text: "Each entry links directly to your crypto wallet, displayed on the competition page for full verification.",
    },
    {
      img: crown,
      title: "Tamper-Proof Prize Draws",
      text: "Competitions use Chainlink's secure VRF to generate a truly random winner automatically.",
    },
    {
      img: rocket,
      title: "Instant & Verified Payouts",
      text: "Prizes are instantly sent to winners' wallets. All results and transactions are verifiable on the blockchain.",
    },
  ];

  return (
    <div
      id="landing-page-fair-draws"
      className="sm:py-10 py-8 max-w-7xl mx-auto 2xl:px-0 sm:px-4 overflow-visible"
    >
      <h1 className="text-white xl:block hidden uppercase text-[2.1rem] leading-normal sequel-95 text-center">
        How Blockchain Powers <br />
        Our Fair Draws
      </h1>
      <h1 className="text-white xl:hidden block uppercase sm:text-4xl text-2xl leading-14 sequel-75 text-center">
        How it Works
      </h1>

      {/* --- Conditional Layout --- */}
      {isMobile ? (
        // Mobile Swiper Layout
        <Swiper
          spaceBetween={20}
          loop
          slidesPerView={1}
          className="sm:hidden mt-2 text-white w-11/12"
        >
          {cardData.map((card, idx) => (
            <SwiperSlide className="!h-auto" key={idx}>
              <div className="bg-[#EF008F] px-6 py-8 rounded-2xl w-full relative overflow-hidden text-center h-full sm:h-auto">
                <img className="mx-auto mb-4" src={card.img} alt={card.title} />
                <h1 className="sequel-75 text-2xl mb-4">{card.title}</h1>
                <div className="w-6/12 mx-auto h-[1px] bg-white my-4"></div>
                <p className="sequel-45 text-sm leading-loose">{card.text}</p>
                <img
                  src={fairDrawBg}
                  alt="fair-bg"
                  className="absolute top-8 left-8 z-10"
                />
              </div>
            </SwiperSlide>
          ))}
          <div className="mt-5">
            <SwiperNavButtons />
          </div>
        </Swiper>
      ) : (
        // Desktop / Tablet Layout
        <div className="lg:flex grid md:grid-cols-2 sm:mt-10 mt-6 text-center text-white xl:gap-3 gap-5 2xl:max-w-10/12 mx-auto">
          <div className="bg-[#EF008F] px-4 py-8 rounded-2xl w-full relative overflow-hidden custom-box-shadow">
            <img className="mx-auto mb-4" src={ticket} alt="entry" />
            <h1 className="sequel-75 sm:text-2xl text-xl mb-4">
              Transparent <br /> Entry System
            </h1>
            <div className="w-6/12 mx-auto h-[1px] bg-white my-4"></div>
            <p className="sequel-45 text-sm leading-loose">
              Each entry links directly to your crypto wallet, displayed on the
              competition page for full verification.
            </p>
            <img
              src={fairDrawBg}
              alt="fair-bg"
              className="absolute top-8 left-8 z-10"
            />
          </div>
          <img src={arrow} alt="arrow" className="w-14 xl:block hidden" />
          <div className="bg-[#EF008F] px-4 py-8 rounded-2xl w-full relative overflow-hidden custom-box-shadow">
            <img className="mx-auto mb-4" src={crown} alt="crown" />
            <h1 className="sequel-75 sm:text-2xl text-xl mb-4">
              Tamper-Proof <br /> Prize Draws
            </h1>
            <div className="w-6/12 mx-auto h-[1px] bg-white my-4"></div>
            <p className="sequel-45 text-sm leading-loose">
              Competitions use Chainlink's secure VRF to generate a truly random
              winner automatically.
            </p>
            <img
              src={fairDrawBg}
              alt="fair-bg"
              className="absolute top-8 left-8 z-10"
            />
          </div>
          <img src={arrow} alt="arrow" className="w-14 xl:block hidden" />
          <div className="bg-[#EF008F] px-4 py-8 rounded-2xl w-full relative overflow-hidden custom-box-shadow">
            <img className="mx-auto mb-4" src={rocket} alt="rocket" />
            <h1 className="sequel-75 sm:text-2xl text-xl">
              Instant & <br /> Verified Payouts
            </h1>
            <div className="w-6/12 mx-auto h-[1px] bg-white my-4"></div>
            <p className="sequel-45 text-sm leading-loose">
              Prizes are instantly sent to winners' wallets. All results and
              transactions are verifiable on the blockchain.
            </p>
            <img
              src={fairDrawBg}
              alt="fair-bg"
              className="absolute top-8 left-8 z-10"
            />
          </div>
        </div>
      )}

      <p className="sequel-45 text-center sm:mt-11 mt-7 sm:text-lg text-white md:leading-none leading-relaxed">
        For more information on how to enter see{" "}
        <Link
          to={"/how-to-play"}
          className="text-[#DDE404] font-bold uppercase hover:text-[#DDE404]/90"
        >
          how to play
        </Link>
      </p>
    </div>
  );
};

export default FairDrawsV2;
