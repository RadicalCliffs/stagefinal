import { smashGraphic } from "../../assets/images"
import CashOutLikeAPro from "../CashOutLikeAPro"
import FaqSection from "../Faqs"
import NeverMissGame from "../NeverMissGame"
import EntriesWithFilterTabs from "./EntriesWithFilterTabs"
import FinishedCompetitionHeroSection from "./FinishedCompetitionHeroSection"
import WinnerResultsTable from "./WinnerResultsTable"
import type {  CompetitionWrapper } from '../../models/models';

const FinishedCompetition = ({competition}:CompetitionWrapper) => {
  return (
    <>
      <div className="custom-finished-competition-page-background bg-full-size absolute inset-0 w-full h-full"></div>
      <div className="relative py-10">
        <div className="xl:px-0 px-4">
          <FinishedCompetitionHeroSection competition={competition}/>
        </div>
        <div className="mt-10 xl:px-0 px-4">
          <WinnerResultsTable competitionId={competition.id} />
        </div>
      </div>
      <div className=" bg-[#1E1E1E] xl:px-0 px-4 relative">
        <EntriesWithFilterTabs competitionId={competition.id} competitionUid={competition.uid} />
      </div>
      <div className=' relative overflow-hidden'>
        <img src={smashGraphic} alt="smashGraphic" className='absolute -left-[4%] top-[10%]  w-12/12 mx-auto xl:block hidden' />
        <div className='relative'>
          <div className='mt-20 mb-14 xl:px-0 sm:px-4 px-2'>
            <CashOutLikeAPro />
          </div>
          <div className='lg:px-0 px-4'>
            <NeverMissGame />
          </div>
          <div className='mt-14 mb-20 xl:px-0 sm:px-4 px-2'>
            <FaqSection />
          </div>
        </div>
      </div>
    </>
  )
}

export default FinishedCompetition
