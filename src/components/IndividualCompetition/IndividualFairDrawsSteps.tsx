import { Swiper, SwiperSlide } from "swiper/react";
import { steps } from "../../constants/constant";
import { useIsMobile } from "../../hooks/useIsMobile";
import FairSteps from "../FairSteps";
import { SwiperNavButtons } from "../SwiperCustomNav";

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
        // ✅ Mobile Swiper Layout
        <Swiper
          spaceBetween={20}
          loop
          slidesPerView={1}
          className="sm:hidden mt-6 text-white w-11/12"
          autoHeight
        >
          {steps.map((step, index) => (
            <SwiperSlide className="!h-max" key={index}>
              <FairSteps
                titleDesktop={"How it Works"}
                titleMobile="How it Works"
                steps={[step]}
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
                outerContainerClasses="pt-1"
              />
            </SwiperSlide>
          ))}
            <SwiperNavButtons />
        </Swiper>
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
