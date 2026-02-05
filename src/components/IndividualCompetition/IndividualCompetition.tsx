import { useState } from 'react';
import { smashGraphic } from '../../assets/images'
import CashOutLikeAPro from '../CashOutLikeAPro'
import FaqSection from '../Faqs'
import EntriesWithFilterTabs from '../FinishedCompetition/EntriesWithFilterTabs'
import Heading from '../Heading'
import NeverMissGame from '../NeverMissGame'
import IndividualCompetitionHeroSection from './IndividualCompetitionHeroSection'
import IndividualCompetitionInfo, { type CompetitionPageTextOverrides } from './IndividualCompetitionInfo'
import IndividualFairDraws from './IndividualFairDrawsSteps'
import TicketSelector from './TicketSelectorWithTabs'
import type {  CompetitionWrapper } from '../../models/models';

interface IndividualCompetitionProps extends CompetitionWrapper {
  // Optional text overrides for visual editor live preview
  competitionPageTextOverrides?: CompetitionPageTextOverrides;
}

const IndividualCompetition = ({ competition, competitionPageTextOverrides }: IndividualCompetitionProps) => {
  const [entriesRefreshKey, setEntriesRefreshKey] = useState(0);

  return (
    <div>
      <div className="custom-individual-competition-page-background bg-full-size absolute inset-0 w-full h-full -z-10"></div>
      <div className='py-10 xl:px-0 sm:px-4 px-2 relative'>
        <IndividualCompetitionHeroSection 
          competition={competition} 
          onEntriesRefresh={() => setEntriesRefreshKey(prev => prev + 1)} 
        />
      </div>

      {(competition.total_tickets ?? 0) > 0 ?
        <div className='bg-[#1E1E1E] py-10 xl:px-0 px-4 relative'>
          <Heading text="Select Your Entries" classes="text-white sequel-95 mb-10" />
          <TicketSelector
            competitionId={competition.id}
            totalTickets={competition.total_tickets ?? 0}
            ticketPrice={competition.ticket_price || 1}
            ticketsSold={competition.tickets_sold || 0}
          />
        </div>
        : ""}
      <div className='fair-draws-bg xl:px-0 px-4 relative'>
        <IndividualFairDraws />
        <div className='pt-8 pb-16 relative'>
          <IndividualCompetitionInfo textOverrides={competitionPageTextOverrides} />
        </div>
      </div>
      <div className=" bg-[#1E1E1E] xl:px-0 px-4 relative">
        <EntriesWithFilterTabs 
          key={entriesRefreshKey}
          competitionId={competition.id} 
          competitionUid={competition.uid} 
        />
      </div>
      <div className='relative overflow-hidden'>
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
    </div>
  )
}

export default IndividualCompetition
