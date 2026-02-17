import { astheticCircle, trustpilotDesktop } from "../assets/images";
import CountUp from "./CountUp";

interface ReviewsProps {
  /** Compact variant for use inside competition detail pages */
  compact?: boolean;
}

const Reviews = ({ compact = false }: ReviewsProps) => {
  return (
    <div className={compact ? "bg-[#111111] rounded-xl border border-white/10 py-4 sm:py-6 px-4 overflow-hidden" : "overflow-hidden"}>
      <div className={`flex flex-row ${compact ? "gap-4 sm:gap-6" : "md:gap-4 gap-8"} text-white ${compact ? "justify-center" : "md:justify-between justify-center"} items-center ${compact ? "max-w-full" : "xl:max-w-6xl lg:max-w-4xl max-w-3xl"} mx-auto ${compact ? "sm:pt-4 pt-2 sm:pb-2 pb-3" : "sm:pt-8 pt-4 sm:pb-2 pb-7"}`}>
        <div className="flex-shrink-0 overflow-hidden">
          <p className={`sequel-95 ${compact ? "md:text-3xl text-lg" : "md:text-4xl text-xl"} md:text-left text-center`}>
            <CountUp prefix="$" end={200} suffix="k" classes={compact ? "sm:min-w-[140px] max-w-[140px]" : "sm:min-w-[189px] max-w-[189px]"}/>
          </p>
          <p className={`sequel-45 ${compact ? "text-[0.6rem] sm:text-xs" : "sm:text-sm text-[0.65rem]"} uppercase text-center mt-2`}>
            Given in Prizes
          </p>
        </div>
        {/* TrustPilot logo centered between the two stats - SMALLER */}
        <div className="flex items-center justify-center flex-shrink-0">
          <a href="https://uk.trustpilot.com/review/theprize.io" target="_blank" rel="noopener noreferrer">
            <img src={trustpilotDesktop} alt="Trustpilot Reviews" className={`${compact ? "max-w-[100px]" : "max-w-[120px]"} mx-auto`} />
          </a>
        </div>
        <div className="flex-shrink-0 overflow-hidden">
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
