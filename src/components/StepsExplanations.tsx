import ImageTextSection from './ImageTextSection'
import { bitcoinImage, sportsCar, watchImage } from '../assets/images'
import { enteringCompetitionProcess, prizeDistributionProcess, winnerSelectionProcess } from '../constants/constant'

const StepsExplanations = () => {
    
  return (
    <div>
        <ImageTextSection
                imageAlt="sports-car"
                imageClass="lg:rounded-tl-2xl "
                textContainerClass="lg:rounded-tr-xl lg:rounded-tl-none rounded-tl-2xl rounded-tr-2xl"
                imageSrc={sportsCar}
                title={"Entering the\nCompetitions"}
                bullets={enteringCompetitionProcess}
                imagePosition="left"
            />
            <ImageTextSection
                imageSrc={bitcoinImage}
                imageAlt="bitcoin-image"
                title={"Winner Selection &\n Live Draws"}
                bullets={winnerSelectionProcess}
                imagePosition="right"
            />
            <ImageTextSection
                imageSrc={watchImage}
                imageAlt="watch-image"
                imageClass="rounded-bl-2xl"
                textContainerClass="rounded-br-2xl"
                title={"Prize Distribution\n & Winner Spotlight"}
                bullets={prizeDistributionProcess}
                imagePosition="left"
            />
    </div>
  )
}

export default StepsExplanations