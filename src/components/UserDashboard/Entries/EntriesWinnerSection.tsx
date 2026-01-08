import Activity from '../../Activity';
import WinnerHashCard from '../../FinishedCompetition/WinnerHashCard';
import { ArrowLeftCircleIcon } from 'lucide-react';
import { flowersV2, trophyV2 } from '../../../assets/images';
import type { Options, WinnerInfoField } from '../../../models/models';
import { Link } from 'react-router';

interface EntriesWinnerSectionProps {
  activeTab: Options;
  fields: WinnerInfoField[];
  status?: "live" | "drawn";
  isWinner?: boolean;
}

const EntriesWinnerSection = ({ activeTab, fields, status = "live", isWinner = false }: EntriesWinnerSectionProps) => {
  const isFinished = status === "drawn" || activeTab.key === 'finished';
  const background =
     isWinner
      ? "bg-[#DDE404]"
      : "bg-[#EF008F]"

  return (
    <Activity mode={isFinished ? 'visible' : 'hidden'}>
      <div>
        <div className="bg-[#DDE404] h-0.5 w-full my-8"></div>

        <WinnerHashCard
          fields={fields}
          showBackgroundImage={false}
          outerContainerClasses="bg-transparent !px-0 !py-0 !max-w-4xl !mx-0 !rounded-none"
        />

        <div>
          <p className="text-white sequel-95 md:text-3xl text-xl uppercase mt-6">Result:</p>

          <div className="mt-5 flex lg:flex-row flex-col gap-4 lg:items-center justify-between xl:pr-20 p-0">
            <div className="flex gap-4">
              <div className={`${background} text-[#1A1A1A] rounded-lg py-4 sm:px-6 px-3 lg:w-auto w-full`}>
                <div className='md:block flex items-center gap-4 justify-between'>
                  <h1 className="sequel-95 md:border-r-0 max-[500px]:border-r-2  uppercase md:text-left text-center lg:text-4xl md:text-3xl text-2xl max-[500px]:text-xl max-[420px]:text-base">Competition {isWinner ? "Won!" : "Lost"}</h1>
                  <img src={isWinner ? trophyV2 : flowersV2} alt="trophy" className="min-w-17 max-[440px]:min-w-12 md:hidden block" />
                </div>
              <div className="bg-[#1A1A1A] h-0.5 w-full my-2 md:hidden block"></div>
                <span className="text-[0.7rem] sequel-45 mt-1 md:text-left text-center block">
                {isWinner ? `A member of our team will reach out to you to give you your prize.
                  Congrats!` : `Sadly you didn't win it this time, but see our current competitions to enter more!`}
                </span>
              </div>

              <div className={`${background} text-[#1A1A1A] md:flex hidden rounded-lg py-4 px-6  items-center justify-center`}>
                <img src={isWinner ? trophyV2 : flowersV2} alt="trophy" className="w-18" />
              </div>
            </div>

            <Link to={'/dashboard/entries'} className="border border-[#DDE404] rounded-md sm:py-3 py-2 sm:px-6 px-4  cursor-pointer hover:scale-105 transition-all flex items-center lg:mx-0 mx-auto">
              <ArrowLeftCircleIcon color="#DDE404" size={24} />
              <span className="sequel-45 text-white uppercase sm:text-base text-sm ml-3 sm:pb-[3.5px] sm:pt-0 pt-1">
                Back
              </span>
            </Link>
          </div>
        </div>
      </div>
    </Activity>
  );
};

export default EntriesWinnerSection;
