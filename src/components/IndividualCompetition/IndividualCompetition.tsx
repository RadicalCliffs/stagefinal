import { useState } from "react";
import { smashGraphic } from "../../assets/images";
import CashOutLikeAPro from "../CashOutLikeAPro";
import FaqSection from "../Faqs";
import EntriesWithFilterTabs from "../FinishedCompetition/EntriesWithFilterTabs";
import Heading from "../Heading";
import NeverMissGame from "../NeverMissGame";
import IndividualCompetitionHeroSection from "./IndividualCompetitionHeroSection";
import IndividualCompetitionInfo, {
  type CompetitionPageTextOverrides,
} from "./IndividualCompetitionInfo";
import FairDrawsV2 from "../FairDrawsV2";
import TicketSelector from "./TicketSelectorWithTabs";
import type { CompetitionWrapper } from "../../models/models";

interface IndividualCompetitionProps extends CompetitionWrapper {
  // Optional text overrides for visual editor live preview
  competitionPageTextOverrides?: CompetitionPageTextOverrides;
}

const IndividualCompetition = ({
  competition,
  competitionPageTextOverrides,
}: IndividualCompetitionProps) => {
  const [entriesRefreshKey, setEntriesRefreshKey] = useState(0);

  return (
    <div>
      <div className="custom-individual-competition-page-background bg-full-size absolute inset-0 w-full h-full -z-0"></div>
      <div className="py-10 xl:px-0 sm:px-4 px-2 relative">
        <IndividualCompetitionHeroSection
          competition={competition}
          onEntriesRefresh={() => setEntriesRefreshKey((prev) => prev + 1)}
        />
      </div>

      {(competition.total_tickets ?? 0) > 0 ? (
        <div className="bg-[#1E1E1E] py-10 xl:px-0 px-4 relative">
          <Heading
            text="Select Your Entries"
            classes="text-white sequel-95 mb-10"
          />
          <TicketSelector
            competitionId={competition.id}
            totalTickets={competition.total_tickets ?? 0}
            ticketPrice={competition.ticket_price || 1}
            ticketsSold={competition.tickets_sold || 0}
          />
        </div>
      ) : (
        ""
      )}
      <div className="fair-draws-bg xl:px-0 px-4 relative">
        <div className="pt-6 pb-0 relative z-10">
          <div className="max-w-7xl mx-auto px-4">
            <h2 className="text-[#DDE404] md:text-[2.1rem] text-2xl sequel-95 text-center uppercase mb-1">
              HOW IT WORKS
            </h2>
          </div>
          <div className="overflow-visible scale-[0.85]">
            <FairDrawsV2 />
          </div>
        </div>
        <div className="pt-8 pb-16 relative">
          <IndividualCompetitionInfo
            textOverrides={competitionPageTextOverrides}
          />
        </div>
      </div>

      {/* VRF Information Section */}
      <div className="bg-[#1E1E1E] py-10 xl:px-0 px-4 relative">
        <div className="max-w-7xl mx-auto">
          <div className="bg-[#191919] rounded-2xl lg:px-14 px-6 lg:py-10 py-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="text-[#DDE404]">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
              </div>
              <h3 className="sequel-95 text-white text-xl lg:text-2xl uppercase">
                Provably Fair Draw
              </h3>
            </div>
            <p className="sequel-45 text-white/60 text-sm mb-6">
              This competition uses Chainlink VRF (Verifiable Random Function)
              for provably fair winner selection on the Base blockchain.
            </p>
            <div className="bg-[#2A2A2A] rounded-xl p-4">
              <p className="sequel-75 text-[#DDE404] text-sm mb-2">
                How It Works
              </p>
              <ul className="sequel-45 text-white/80 text-sm space-y-2 list-disc list-inside">
                <li>
                  Winners are selected using blockchain-verified randomization
                  (VRF)
                </li>
                <li>Every draw is fair, transparent, and tamper-proof</li>
                <li>Results are published on-chain for full transparency</li>
                <li>
                  After the draw, you can verify the VRF seed and winning
                  calculation
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className=" bg-[#1E1E1E] xl:px-0 px-4 relative">
        <EntriesWithFilterTabs
          key={entriesRefreshKey}
          competitionId={competition.id}
          competitionUid={competition.uid}
        />
      </div>
      <div className="relative overflow-hidden">
        <img
          src={smashGraphic}
          alt="smashGraphic"
          className="absolute -left-[4%] top-[10%]  w-12/12 mx-auto xl:block hidden"
        />
        <div className="relative">
          <div className="mt-20 mb-14 xl:px-0 sm:px-4 px-2">
            <CashOutLikeAPro />
          </div>
          <div className="lg:px-0 px-4">
            <NeverMissGame />
          </div>
          <div className="mt-14 mb-20 xl:px-0 sm:px-4 px-2">
            <FaqSection />
          </div>
        </div>
      </div>
    </div>
  );
};

export default IndividualCompetition;
