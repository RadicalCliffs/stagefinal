import { monkeyNft } from "../../assets/images"
import Countdown from "../Countdown"
import Heading from "../Heading"
import type {  CompetitionWrapper } from '../../models/models';

const FinishedCompetitionHeroSection = ({competition}:CompetitionWrapper) => {
    const {description,title,created_at,image_url,end_date,draw_date} = competition
    return (
        <>
            <div className="max-w-7xl mx-auto">
                <Heading text="Finished Competitions" classes="text-white sequel-95 lg:block hidden" />
                <div className="bg-[#191919] rounded-2xl px-6 pt-5 pb-8 md:mt-10">
                    <Heading text="Finished Competitions" classes="text-white sequel-95 lg:hidden block mb-8" />
                    <div className='flex lg:flex-row flex-col xl:items-end gap-8'>
                        <img src={image_url || monkeyNft} alt="competition" className='w-full' />
                        <div className='w-full lg:text-left text-center'>
                            <h1 className="sequel-95 uppercase text-white lg:text-left text-center sm:text-4xl text-3xl">{title}</h1>
                            <div className='lg:w-6/12 h-[4px] bg-[#EF008F] mt-6'></div>
                            <p className='sequel-45 my-4 text-white leading-loose'>{description || 'Competition has ended.'}</p>
                            <button className='uppercase sequel-95 sm:text-2xl text-xl pointer-events-none bg-[#414141] text-[#1F1F1F] w-full rounded-xl py-3'>Finished</button>
                        </div>
                    </div>
                    <div className="flex md:flex-row flex-col justify-center items-center gap-8 mt-10 ">
                        <p className="sequel-95 uppercase text-white sm:text-3xl text-2xl">Finish Date</p>
                        <Countdown endDate={end_date || draw_date || created_at} isEnded={true} />
                    </div>
                </div>
            </div>

        </>
    )
}

export default FinishedCompetitionHeroSection
