import { Link } from "react-router";
import { heroSectionImage, priceTag } from "../assets/images";
import CardPayments from "./CardPayments";
import Partners from "./Partners";
import Reviews from "./Reviews";
import FairDrawsV2 from "./FairDrawsV2";
import HeroCarouselV2 from "./HeroCarouselV2";

const HeroSection = () => {
  return (
    <>
      <div className="bg-[#1a1a1a] max-w-7xl mx-auto rounded-xl sm:p-3">
        {/* <div>
          <img
            className="w-full"
            src={heroSectionImage}
            alt="hero-section-banner"
          />
          <div className="bg-[#040404] text-white flex md:flex-row flex-col justify-between items-center sm:py-10 py-4 xl:px-20 sm:px-10 px-4 relative  rounded-bl-xl rounded-br-xl xl:gap-0 gap-6">
            <div className="md:w-6/12">
              <h1 className="sequel-95 lg:text-4xl sm:text-3xl text-2xl sm:text-left text-center">
                WIN 10 BITCOIN
              </h1>
              <p className="sequel-45 text-sm sm:mt-4 mt-1 sm:text-left text-center">
                Ape into this $50,000 competition for just $1 and stand a 39/1
                chance to win one of 2800 prizes. Even if you don't bag.
              </p>
            </div>
            <div className="bg-white text-[#1A1A1A] rounded-xl xl:w-3/12 md:w-6/12 w-full sm:block flex items-center gap-3">
              <p className="sequel-45 sm:px-0 pl-4 sm:text-center sm:w-auto w-full sm:text-base text-xs">
                <img
                  src={priceTag}
                  alt="price-tag"
                  className="sm:inline hidden"
                />{" "}
                <span className="sequel-95">$24.99 / </span>Entry
              </p>

              <Link
                to={"/competitions"}
                className="md:sequel-95 text-center block sequel-95 bg-[#DDE404] sm:py-3 pt-3 pb-2.5 rounded-xl sm:text-lg text-xs w-full cursor-pointer border border-white hover:bg-[#c7cc04] custom-box-shadow"
              >
                ENTER NOW
              </Link>
            </div>
          </div>
        </div> */}
        <HeroCarouselV2 />
        <Reviews />
      </div>
      <div className="max-w-[77rem] mx-auto relative z-0">
        <CardPayments />
      </div>
      <div className="max-w-[77rem] mx-auto">
        <div className="max-w-[calc(100%*11.5/12)] mx-auto">
          <Partners />
        </div>
        <div className="text-center sm:px-0 px-4">
          <Link
            to={"/competitions"}
            className="md:sequel-95 inline-block sequel-95 sm:mt-9 mt-6 mb-4 font-medium  md:text-xl sm:text-sm text-xs md:max-w-7xl bg-[#DDE404] sm:pt-2.5 sm:pb-3 pt-3.5 pb-2.5 sm:rounded-xl rounded-lg text-[#1B1B1B] md:px-14 px-4 max-[410px]:text-[0.65rem] max-w-11/12 cursor-pointer border border-white hover:bg-[#c7cc04] custom-box-shadow"
          >
            BROWSE ALL COMPETITIONS
          </Link>
        </div>
      </div>
      <div className="overflow-hidden">
        <FairDrawsV2 />
      </div>
    </>
  );
};

export default HeroSection;
