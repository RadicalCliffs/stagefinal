import { smashGraphic } from "../assets/images";
import CashOutLikeAPro from "../components/CashOutLikeAPro";
import FaqSection from "../components/Faqs";
import Heading from "../components/Heading";
import HeroSection from "../components/HeroSection";
import NeverMissGame from "../components/NeverMissGame";
import TableWithFilters from "../components/TableWithFilters";
import LiveCompetitionSection from "../components/LiveCompetitionSection";
import { Link } from "react-router";
import WinnersV2 from "../components/WinnerCardSection";
import FeaturedInLogos from "../components/FeaturedInLogos";

const LandingPage = () => {
  return (
    <>
      <div className="custom-landing-page-background bg-full-size absolute inset-0 w-full h-full"></div>
      <div className="mt-5 xl:px-0 px-4 relative">
        <HeroSection />
      </div>
      <div className="bg-[#1A1B1A] relative xl:px-0 px-4  md:py-10 py-7">
        <Heading
          text="Live Activity"
          classes="sequel-95 text-white uppercase mb-8 md:hidden block"
        />
        <TableWithFilters />
      </div>
      <FeaturedInLogos />
      <div className="pt-8 pb-10 sm:pt-14 sm:pb-14 relative  bg-[#1A1A1A] ">
        <div className="max-w-7xl mx-auto">
          <Heading
            text="Live Competitions"
            classes="text-[#DDE404] md:text-[2.1rem] max-[600px]:text-2xl sm:mb-0 mb-9 sm:px-0 px-2"
          />
          <div className="text-center mt-9 sm:block hidden">
            <Link
              to={"/competitions"}
              className="uppercase mb-3 inline-block border border-white py-3 px-10 rounded-lg sequel-45 hover:bg-[#DDE404] text-[0.85rem] cursor-pointer bg-transparent text-[#fff] hover:text-[#280508] custom-box-shadow hover:font-bold"
            >
              View All Competitions
            </Link>
          </div>
          <div className="relative xl:px-0 sm:px-6 px-3">
            <LiveCompetitionSection />
          </div>
        </div>
      </div>

      {/* How It Works section moved here from HeroSection */}
      <div className="overflow-hidden">
        <FairDrawsV2 />
      </div>

      <div className=" relative overflow-hidden">
        <WinnersV2 />
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
    </>
  );
};

export default LandingPage;
