import { Swiper, SwiperSlide } from "swiper/react";
import "swiper/swiper-bundle.css";
import { Link } from "react-router";
import Heading from "./Heading";
import {
  baseAppLogo,
  neverMissWin,
  safeSmashLogo,
  telegramSafeSmashLogo,
} from "../assets/images";
import { SwiperNavButtons } from "./SwiperCustomNav";
import { useSectionTracking } from "../hooks/useSectionTracking";

const NeverMissGame = () => {
  const sectionRef = useSectionTracking('never_miss_game_section');

  const slides = [
    {
      title: "Join The Telegram",
      text: "Join our Telegram channel to be the first to know about exclusive offers.",
      link: "",
      image: telegramSafeSmashLogo,
      disabled: false,
    },
    {
      title: "Play the Game",
      text: "Step into the THEPRIZE.IO Safe Smash Telegram Game!",
      link: "",
      image: safeSmashLogo,
      disabled: false,
    },
    {
      title: "App Coming Soon",
      text: "Play, win, and claim rewards instantly inside the Base ecosystem.",
      link: "",
      image: baseAppLogo,
      disabled: true,
    },
  ];

  return (
    <div ref={sectionRef} className="w-full max-w-7xl mx-auto" id="never-miss-game">
      <Heading
        text="Never Miss a Win!"
        classes="text-white max-[600px]:text-2xl lg:text-4xl"
      />

      {/* Shared desktop image */}
      <div className="hidden md:block mt-14">
        <img
          className="mx-auto 2xl:w-[800px] md:w-10/12"
          src={neverMissWin}
          alt="never-miss-win"
          loading="lazy"
        />
      </div>

      {/* Mobile Swiper */}
      <div className="md:hidden mt-10">
        <Swiper
          spaceBetween={20}
          loop
          slidesPerView={1}
          className="sm:hidden mt-6 text-white w-11/12"
        >
          {slides.map((slide, index) => (
            <SwiperSlide key={index}>
              <img src={slide.image} alt={slide.title} className="mx-auto " />
              <div className="bg-[#DDE404] rounded-xl py-8 px-6 text-center h-full">
                <Link
                  to={slide.link}
                  className={`sequel-75 w-full inline-block text-sm uppercase pt-3 pb-2.5 px-4 rounded-xl border-3 border-white ${
                    slide.disabled
                      ? "bg-[#212121] text-[#6d6d6d] pointer-events-none"
                      : "bg-[#212121] text-white hover:bg-[#212121]/90"
                  }`}
                >
                  {slide.title}
                </Link>
                <p className="sequel-45 mt-3 text-sm leading-loose text-black">
                  {slide.text}
                </p>
              </div>
            </SwiperSlide>
          ))}
          <div className="mt-5">
            <SwiperNavButtons />
          </div>
        </Swiper>
      </div>

      {/* Desktop 3-column layout */}
      <div className="hidden md:grid lg:grid-cols-3 grid-cols-2 gap-6 bg-[#DDE404] rounded-xl py-8 px-6 max-w-4xl mx-auto ">
        {slides.map((slide, index) => (
          <div key={index} className="text-center">
            <Link
              to={slide.link}
              className={`sequel-75 w-full inline-block text-sm uppercase sm:pt-2.5 sm:pb-3 py-3 px-4 rounded-xl border-3 border-white ${
                slide.disabled
                  ? "bg-[#212121] text-[#6d6d6d] pointer-events-none"
                  : "bg-[#212121] text-white hover:bg-[#212121]/90"
              }`}
            >
              {slide.title}
            </Link>
            <p className="sequel-45 mt-3 text-sm leading-loose">{slide.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default NeverMissGame;
