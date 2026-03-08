import { trustpilotMobile, rouletteWheel } from "../assets/images";
import CountUp from "./CountUp";

interface ReviewsProps {
  /** Compact variant for use inside competition detail pages */
  compact?: boolean;
}

const Reviews = ({ compact = false }: ReviewsProps) => {
  return (
    <div
      className={`overflow-hidden ${compact ? "bg-[#111111] rounded-xl border border-white/10 py-4 sm:py-6 px-4" : ""}`}
    >
      {/* Desktop layout - horizontal row with stats, trustpilot, and roulette wheels */}
      <div
        className={`hidden sm:flex flex-row ${compact ? "gap-4 sm:gap-6" : "md:gap-4 gap-8"} text-white ${compact ? "justify-center" : "md:justify-between justify-center"} items-center ${compact ? "max-w-full" : "xl:max-w-6xl lg:max-w-4xl max-w-3xl"} mx-auto ${compact ? "sm:pt-4 pt-2 sm:pb-2 pb-3" : "sm:pt-8 pt-4 sm:pb-2 pb-7"}`}
      >
        <div className="shrink-0 overflow-hidden">
          <p
            className={`sequel-95 ${compact ? "md:text-3xl text-lg" : "md:text-4xl text-xl"} md:text-left text-center`}
          >
            <CountUp
              prefix="$"
              end={200}
              suffix="k"
              classes={
                compact
                  ? "sm:min-w-[140px] sm:max-w-[140px]"
                  : "sm:min-w-[189px] sm:max-w-[189px]"
              }
            />
          </p>
          <p
            className={`sequel-45 ${compact ? "text-[0.6rem] sm:text-xs" : "sm:text-sm text-[0.65rem]"} uppercase text-center mt-2`}
          >
            Given in Prizes
          </p>
        </div>
        {/* TrustPilot logo centered with roulette wheels */}
        <div className="flex items-center justify-center shrink-0 gap-4">
          <img
            src={rouletteWheel}
            alt="Roulette Wheel"
            className="w-12 h-12 md:w-16 md:h-16"
          />
          <a
            href="https://uk.trustpilot.com/review/theprize.io"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              src={trustpilotMobile}
              alt="Trustpilot Reviews"
              className={`${compact ? "max-w-[280px]" : "max-w-[360px]"} mx-auto`}
            />
          </a>
          <img
            src={rouletteWheel}
            alt="Roulette Wheel"
            className="w-12 h-12 md:w-16 md:h-16"
          />
        </div>
        <div className="shrink-0 overflow-hidden">
          <p
            className={`sequel-95 ${compact ? "md:text-3xl text-lg" : "md:text-4xl text-xl"} md:text-left text-center`}
          >
            <CountUp
              end={500}
              suffix="+"
              classes={
                compact
                  ? "sm:min-w-[140px] sm:max-w-[140px]"
                  : "sm:min-w-[189px] sm:max-w-[189px]"
              }
            />
          </p>
          <p
            className={`sequel-45 ${compact ? "text-[0.6rem] sm:text-xs" : "sm:text-sm text-[0.65rem]"} uppercase mt-2`}
          >
            Happy Winners
          </p>
        </div>
      </div>

      {/* Mobile layout - vertical stack with logo on top */}
      <div
        className={`sm:hidden flex flex-col text-white ${compact ? "max-w-full" : "max-w-3xl"} mx-auto ${compact ? "pt-2 pb-3" : "pt-4 pb-7"}`}
      >
        {/* TrustPilot logo on top - 80% width with padding */}
        <div className="flex items-center justify-center mb-6">
          <a
            href="https://uk.trustpilot.com/review/theprize.io"
            target="_blank"
            rel="noopener noreferrer"
            className="w-4/5 px-4"
          >
            <img
              src={trustpilotMobile}
              alt="Trustpilot Reviews"
              className="w-full h-auto"
            />
          </a>
        </div>
        {/* Animated numbers below - centered */}
        <div className="flex flex-row gap-8 justify-center items-center">
          <div className="shrink-0 overflow-hidden">
            <p
              className={`sequel-95 ${compact ? "text-[22.5px]" : "text-[25px]"} text-center`}
            >
              <CountUp prefix="$" end={200} suffix="k" />
            </p>
            <p
              className={`sequel-45 ${compact ? "text-[0.75rem]" : "text-[0.8125rem]"} uppercase text-center mt-2`}
            >
              Given in Prizes
            </p>
          </div>
          <div className="shrink-0 overflow-hidden">
            <p
              className={`sequel-95 ${compact ? "text-[22.5px]" : "text-[25px]"} text-center`}
            >
              <CountUp end={500} suffix="+" />
            </p>
            <p
              className={`sequel-45 ${compact ? "text-[0.75rem]" : "text-[0.8125rem]"} uppercase text-center mt-2`}
            >
              Happy Winners
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Reviews;
