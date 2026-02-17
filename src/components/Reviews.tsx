import { astheticCircle, trustPilotStars } from "../assets/images";
import CountUp from "./CountUp";

interface ReviewsProps {
  /** Compact variant for use inside competition detail pages */
  compact?: boolean;
}

const Reviews = ({ compact = false }: ReviewsProps) => {
  return (
    <div className={compact ? "bg-[#111111] rounded-xl border border-white/10 py-4 sm:py-6 px-4" : ""}>
      <div className={`flex flex-row ${compact ? "gap-6 sm:gap-8" : "md:gap-0 gap-10"} text-white ${compact ? "justify-center" : "md:justify-between justify-center"} items-center ${compact ? "max-w-full" : "xl:max-w-8/12 lg:max-w-3xl max-w-2xl"} mx-auto ${compact ? "sm:pt-4 pt-2 sm:pb-2 pb-3" : "sm:pt-8 pt-4 sm:pb-2 pb-7"}`}>
        <div>
          <p className={`sequel-95 ${compact ? "md:text-3xl text-lg" : "md:text-4xl text-xl"} md:text-left text-center`}>
            <CountUp prefix="$" end={200} suffix="k" classes={compact ? "sm:min-w-[140px]" : "sm:min-w-[189px]"}/>
          </p>
          <p className={`sequel-45 ${compact ? "text-[0.6rem] sm:text-xs" : "sm:text-sm text-[0.65rem]"} uppercase text-center mt-2`}>
            Given in Prizes
          </p>
        </div>
        {/* TrustPilot logo centered between the two stats */}
        <div className="flex items-center justify-center">
          <a href="https://uk.trustpilot.com/review/theprize.io" target="_blank" rel="noopener noreferrer">
            <img src={trustPilotStars} alt="Trustpilot Reviews" className={`${compact ? "max-w-[80px]" : "max-w-[120px]"} mx-auto`} />
          </a>
        </div>
        <div>
          <p className={`sequel-95 ${compact ? "md:text-3xl text-lg" : "md:text-4xl text-xl"} md:text-left text-center`}>
            <CountUp end={500} suffix="+" />
          </p>
          <p className={`sequel-45 ${compact ? "text-[0.6rem] sm:text-xs" : "sm:text-sm text-[0.65rem]"} uppercase  mt-2`}>
            Happy Winners
          </p>
        </div>
      </div>
    </div>
  );
};

export default Reviews;
