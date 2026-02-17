import { Swiper, SwiperSlide } from "swiper/react";
import { steps } from "../../constants/constant";
import { useIsMobile } from "../../hooks/useIsMobile";
import FairSteps from "../FairSteps";
import { SwiperNavButtons } from "../SwiperCustomNav";
import { howItWorksMobile } from "../../assets/images";

const IndividualFairDraws = ({
  showSteps = false,
  cardClasses = "custom-box-shadow",
  containerClasses = "xl:gap-5",
}: {
  showSteps?: boolean;
  cardClasses?: string;
  containerClasses?: string;
}) => {
  const isMobile = useIsMobile();

  return (
    <>
      {isMobile ? (
        // ✅ Mobile Static Image Layout (matching landing page)
        <div className="sm:hidden mt-6 flex justify-center px-4">
          <div className="text-center">
            <h2 className="text-white sequel-75 text-xl uppercase mb-4">
              How it Works
            </h2>
            <img
              src={howItWorksMobile}
              alt="How It Works - Transparent Ticketing, Tamper-Proof Prize Draws, Instant & Verified Payouts"
              className="w-full max-w-sm mx-auto"
            />
          </div>
        </div>
      ) : (
        // ✅ Desktop / Tablet Layout
        <FairSteps
          titleDesktop={"How it Works"}
          titleMobile="How it Works"
          steps={steps}
          linkText="How to Play"
          linkTo="/how-to-play"
          primaryColor="#EF008F"
          titleClasses="uppercase !text-lg"
          descriptionClasses="leading-loose text-xs"
          containerClasses={containerClasses}
          showSteps={showSteps}
          cardClasses={cardClasses}
          bgImageClasses="opacity-20 top-10 !left-1/2 -translate-x-1/2 w-9/12"
          showInstructionLink={false}
          outerContainerClasses="sm:pt-7 "
        />
      )}
    </>
  );
};

export default IndividualFairDraws;
