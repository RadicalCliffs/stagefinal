import { astheticCircle, trustpilotDesktop, trustpilotMobile } from "../assets/images";
import CountUp from "./CountUp";

const Reviews = () => {
  return (
    <div className="">
      <div className="sm:hidden block mx-auto sm:mt-0 mt-4">
        <a href="https://uk.trustpilot.com/review/theprize.io" target="_blank" rel="noopener noreferrer" className="block mx-auto w-fit">
          <img className="mx-auto max-w-[308px]" src={trustpilotMobile} alt="Trustpilot Reviews" />
        </a>
      </div>
      <div className="flex flex-row md:gap-0 gap-10 text-white md:justify-between justify-center items-center xl:max-w-8/12 lg:max-w-3xl max-w-2xl mx-auto sm:pt-8 pt-4 sm:pb-2 pb-7">
        <div>
          <p className="sequel-95 md:text-4xl text-xl md:text-left text-center">
            {/* $200k */}
            <CountUp prefix="$" end={200} suffix="k" classes="sm:min-w-[189px]"/>
          </p>
          <p className="sequel-45 sm:text-sm text-[0.65rem] uppercase text-center mt-2">
            Given in Prizes
          </p>
        </div>
        <img
          src={astheticCircle}
          alt="asthetic-circle-1"
          className="xl:block hidden"
          style={{ animation: 'none' }}
        />
        <div className="sm:block hidden max-w-[250px]">
          <a href="https://uk.trustpilot.com/review/theprize.io" target="_blank" rel="noopener noreferrer">
            <img src={trustpilotDesktop} alt="Trustpilot Reviews" className="w-full" />
          </a>
        </div>
        <img
          src={astheticCircle}
          alt="asthetic-circle-2"
          className="xl:block hidden"
          style={{ animation: 'none' }}
        />
        <div>
          <p className="sequel-95 md:text-4xl text-xl md:text-left text-center">
            <CountUp end={500} suffix="+" />
          </p>
          <p className="sequel-45 sm:text-sm text-[0.65rem] uppercase  mt-2">
            Happy Winners
          </p>
        </div>
      </div>
    </div>
  );
};

export default Reviews;
