import { useEffect, useState } from "react"
import { smashGraphic } from "../../assets/images"
import CashOutLikeAPro from "../CashOutLikeAPro"
import FaqSection from "../Faqs"
import EntriesWithFilterTabs from "../FinishedCompetition/EntriesWithFilterTabs"
import Heading from "../Heading"
import IndividualCompetitionHeroSection from "../IndividualCompetition/IndividualCompetitionHeroSection"
import IndividualCompetitionInfo from "../IndividualCompetition/IndividualCompetitionInfo"
import NeverMissGame from "../NeverMissGame"
import EndPrizeBanner from "./EndPrizeBanner"
import InstantWinHowItWorks from "./InstantWinHowItWorks"
import InstantWinTabs from "./InstantWinTabs"
import KeyPrizesSection from "./KeyPrizesSection"
import WinningTicketsDisplay from "./WinningTicketsDisplay"
import MinorPrizesSection from "./MinorPrizesSection"
import VRFVerificationSection from "./VRFVerificationSection"
import WinnersModal from "./WinnersModal"
import type { CompetitionWrapper } from '../../models/models';
import { useInstantWinTickets } from "../../hooks/useInstantWinTickets"
import { Trophy, Eye } from "lucide-react"

const InstantWinCompetition = ({competition}:CompetitionWrapper) => {
    // State for Winners Modal
    const [showWinnersModal, setShowWinnersModal] = useState(false);

    // Initialize winning tickets when competition loads
    // This hook generates deterministic winning tickets based on competition UID
    // and fetches claimed status from the database
    const {
        initialized,
        loading: ticketsLoading,
        stats,
        error: ticketsError,
    } = useInstantWinTickets({
        competitionUid: competition.uid || '',
        totalTickets: competition.total_tickets || 1000,
        autoInitialize: true, // Automatically initialize tickets on mount
    });

    // Log initialization status for debugging (can be removed in production)
    useEffect(() => {
        if (initialized && !ticketsLoading) {
            console.log(`[InstantWin] Competition ${competition.uid} tickets initialized:`, {
                totalWinningTickets: stats.totalWinningTickets,
                keyPrizes: stats.totalKeyPrizes,
                minorPrizes: stats.totalMinorPrizes,
            });
        }
        if (ticketsError) {
            console.error(`[InstantWin] Error initializing tickets for ${competition.uid}:`, ticketsError);
        }
    }, [initialized, ticketsLoading, ticketsError, competition.uid, stats]);

    return (
        <div>
            <div className="custom-individual-competition-page-background bg-full-size absolute inset-0 w-full h-full -z-10"></div>
            <div>
                <div className='py-10 xl:px-0 sm:px-4 px-2 relative'>
                    <IndividualCompetitionHeroSection competition={competition}/>
                </div>
                <div className="pb-10 sm:px-4 px-2 relative">
                    <InstantWinHowItWorks />
                </div>
            </div>

            {/* Fixed Prize Structure Header */}
            <div className="bg-[#1E1E1E] py-6 xl:px-0 px-4 relative">
                <div className="max-w-4xl mx-auto">
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-[#2A2A2A] rounded-xl p-4 border border-[#404040]">
                        <div className="flex items-center gap-3">
                            <Trophy size={24} className="text-[#DDE404]" />
                            <div>
                                <h3 className="text-white sequel-95 text-lg">53 INSTANT WINNERS</h3>
                                <p className="text-white/60 sequel-45 text-sm">3 Major Prizes + 50 Wallet Credits</p>
                            </div>
                        </div>
                        <button
                            onClick={() => setShowWinnersModal(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-[#DDE404] text-[#1A1A1A] rounded-lg sequel-75 hover:bg-[#DDE404]/90 transition-colors"
                        >
                            <Eye size={18} />
                            View All Winners
                        </button>
                    </div>
                </div>
            </div>

            {/* Winning Tickets Display - All 53 winning tickets shown upfront */}
            <div className="pb-6 xl:px-0 sm:px-4 px-2 relative bg-[#1E1E1E] pt-10">
                <WinningTicketsDisplay
                    competitionUid={competition.uid || ''}
                    competitionId={competition.id}
                    totalTickets={competition.total_tickets || 1000}
                />
            </div>

            {/* VRF Verification Section */}
            <div className="pb-6 xl:px-0 sm:px-4 px-2 relative bg-[#1E1E1E]">
                <VRFVerificationSection
                    competitionUid={competition.uid || ''}
                    competitionId={competition.id}
                    totalTickets={competition.total_tickets || 1000}
                />
            </div>

            {/* Key Prizes Section - 3 Major Prizes (Grand Prize, Major Prize, Jackpot) */}
            <div className="pt-14 pb-20 bg-[#232323] xl:px-0 px-4 relative">
                <Heading text="Major Prizes" classes="text-white uppercase sequel-95 sm:mb-12 mb-7" />
                <p className="text-center text-white/60 sequel-45 text-sm mb-8 -mt-4">
                    3 Major prizes with 1 winner each - configurable names and images
                </p>
                <KeyPrizesSection
                    competitionUid={competition.uid || ''}
                    competitionId={competition.id}
                    totalTickets={competition.total_tickets || 1000}
                    prizeValue={competition.prize_value || 10000}
                />
            </div>

            {/* Minor Prizes Section - 50 wallet credits (20x$2, 20x$3, 10x$5) */}
            <div className="pb-6 xl:px-0 sm:px-4 px-2 relative bg-[#1E1E1E] pt-10">
                <div className="max-w-5xl mx-auto">
                    <Heading text="Wallet Credits" classes="text-white uppercase sequel-95 sm:mb-8 mb-4" />
                    <p className="text-center text-white/60 sequel-45 text-sm mb-8 -mt-4">
                        50 smaller prizes: 20x $2 + 20x $3 + 10x $5
                    </p>
                    <MinorPrizesSection
                        competitionUid={competition.uid || ''}
                        competitionId={competition.id}
                        totalEntries={competition.total_tickets || 1000}
                    />
                </div>
            </div>

            <div className="bg-[#1E1E1E] py-10 xl:px-0 px-4 relative">
                <EndPrizeBanner />
            </div>
            <div className="relative">
                <InstantWinTabs />
            </div>
            <div className="pt-14 pb-20 bg-[#232323] xl:px-0 px-4 relative">
                <Heading text="Competition Details" classes="text-white uppercase sequel-95 sm:mb-12 mb-7" />
                <div>
                    <IndividualCompetitionInfo />
                </div>
            </div>
            {/* Entries Table - shows all entries for this competition */}
            <div className="bg-[#1E1E1E] xl:px-0 px-4 relative">
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

            {/* Winners Modal */}
            <WinnersModal
                isOpen={showWinnersModal}
                onClose={() => setShowWinnersModal(false)}
                competitionUid={competition.uid || ''}
                competitionId={competition.id}
            />
        </div>
    )
}

export default InstantWinCompetition