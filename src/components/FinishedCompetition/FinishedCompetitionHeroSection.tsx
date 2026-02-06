import { monkeyNft, individualLogoToken } from "../../assets/images"
import Countdown from "../Countdown"
import type { CompetitionWrapper } from '../../models/models';

const FinishedCompetitionHeroSection = ({competition}:CompetitionWrapper) => {
    const {description,title,created_at,image_url,end_date,draw_date} = competition
    return (
        <div className="max-w-7xl mx-auto bg-[#1D1D1D] rounded-2xl px-3 py-4">
            <div className="flex xl:flex-row flex-col lg:gap-8 gap-4 relative overflow-hidden">
                <div className="bg-[#111111] rounded-2xl w-full relative">
                    {/* Mobile countdown - on top of image */}
                    <div className="xl:hidden absolute top-4 left-0 right-0">
                        <div className="flex flex-col items-center justify-center">
                            <Countdown endDate={end_date || draw_date || created_at} isEnded={true} />
                        </div>
                    </div>
                    <img src={image_url || monkeyNft} alt={`${title} - Competition image`} className="xl:w-auto w-full" />
                    {/* Desktop countdown - below image */}
                    <div className="xl:flex hidden flex-col items-center justify-center mt-5 xl:pb-0 pb-8">
                        <p className="sequel-95 uppercase text-white mb-4 sm:text-3xl text-2xl">
                            Finish Date
                        </p>
                        <Countdown endDate={end_date || draw_date || created_at} isEnded={true} />
                    </div>
                </div>
                <img
                    src={individualLogoToken}
                    alt="Prize token logo"
                    className="absolute md:block hidden w-96 xl:-right-5 xl:-top-8 bottom-0 right-0"
                />

                <div className="w-full lg:mt-5">
                    <h1 className="sequel-95 lg:text-4xl sm:text-3xl text-2xl sm:text-left text-center text-white">
                        {title}
                    </h1>
                    <p className="text-white sequel-45 text-sm sm:mt-4 mt-3 leading-loose sm:text-left text-center">
                        {description || 'Competition has ended.'}
                    </p>
                    <div className="bg-[#141414] rounded-xl p-4 mt-4 relative">
                        <p className="sequel-75 uppercase text-white md:text-xl text-lg mb-4">
                            Competition Status
                        </p>
                        <button className='uppercase sequel-95 sm:text-2xl text-xl pointer-events-none bg-[#414141] text-[#1F1F1F] w-full rounded-xl py-3'>
                            Finished
                        </button>
                        <div className="mt-4 border-t border-[#2A2A2A] pt-4">
                            <p className="sequel-45 text-white/60 text-sm text-center">
                                This competition has ended. Check winner details below.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default FinishedCompetitionHeroSection
