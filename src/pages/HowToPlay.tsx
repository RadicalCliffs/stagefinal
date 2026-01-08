import { smashGraphic } from "../assets/images"
import CashOutLikeAPro from "../components/CashOutLikeAPro"
import FaqSection from "../components/Faqs"
import IndividualFairDraws from "../components/IndividualCompetition/IndividualFairDrawsSteps"
import NeverMissGame from "../components/NeverMissGame"
import StepsExplanations from "../components/StepsExplanations"

const HowToPlay = () => {
    return (
        <>
            <div className="max-w-7xl mx-auto">
                <div className="custom-how-to-play-background bg-full-size absolute inset-0 w-full h-full"></div>
                <div className="xl:px-0 px-4 relative">
                    <IndividualFairDraws showSteps cardClasses="" containerClasses="sm:!mt-10 !mt-3" />
                </div>

                <div className="mt-7 xl:px-0 px-4 relative">
                    <StepsExplanations />
                </div>
            </div>
            <div className='relative overflow-hidden'>
                <img src={smashGraphic} alt="smashGraphic" className='absolute -left-[4%] top-[10%]  w-12/12 mx-auto xl:block hidden' />
                <div className='relative'>
                    <div className='sm:mt-11 mt-9 mb-14 xl:px-0 px-4'>
                        <CashOutLikeAPro />
                    </div>
                    <div className='lg:px-0 px-4'>
                        <NeverMissGame />
                    </div>
                    <div className='mt-10 sm:mb-14 mb-6 xl:px-0 px-4'>
                        <FaqSection />
                    </div>
                </div>
            </div>
        </>
    )
}

export default HowToPlay