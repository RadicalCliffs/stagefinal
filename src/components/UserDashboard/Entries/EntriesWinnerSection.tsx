import Activity from '../../Activity';
import WinnerHashCard from '../../FinishedCompetition/WinnerHashCard';
import { ArrowLeftCircleIcon } from 'lucide-react';
import { flowersV2, trophyV2 } from '../../../assets/images';
import type { Options, WinnerInfoField } from '../../../models/models';
import { Link } from 'react-router';

interface EntriesWinnerSectionProps {
  activeTab: Options;
  fields: WinnerInfoField[];
  status?: "live" | "drawn" | "completed" | "tbd";
  isWinner?: boolean;
  vrfTxHash?: string | null;
  winnerWalletAddress?: string | null;
}

const EntriesWinnerSection = ({ 
  activeTab, 
  fields, 
  status = "live", 
  isWinner = false,
  vrfTxHash = null,
  winnerWalletAddress = null
}: EntriesWinnerSectionProps) => {
  const isFinished = status === "drawn" || status === "completed" || status === "tbd" || activeTab.key === 'finished';
  
  // Determine button color based on status and outcome
  // Check status first, then determine winner/loser within completed status
  let background = "bg-[#EF008F]"; // Default to pink (lost)
  let statusText = "Competition Lost";
  
  if (status === "tbd") {
    // Competition completed but no VRF data yet
    background = "bg-[#DDE404]";
    statusText = "TBD";
  } else if (status === "drawn") {
    // Competition ended, VRF draw in progress
    background = "bg-[#FF8C00]";
    statusText = "Drawing";
  } else if (status === "completed") {
    // Competition fully completed with VRF data
    if (isWinner) {
      background = "bg-[#10B981]";
      statusText = "Competition Won!";
    } else if (vrfTxHash) {
      // User lost and VRF hash exists
      background = "bg-[#EF008F]";
      statusText = "Competition Lost";
    } else {
      // Completed but no VRF hash (shouldn't happen, but fallback to TBD)
      background = "bg-[#DDE404]";
      statusText = "TBD";
    }
  }
  
  // Create blockchain explorer link for VRF transaction
  const vrfExplorerLink = vrfTxHash 
    ? `https://basescan.org/tx/${vrfTxHash}` 
    : null;

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
            <div className="flex gap-4 flex-col lg:flex-row w-full lg:w-auto">
              <div className={`${background} text-[#1A1A1A] rounded-lg py-4 sm:px-6 px-3 lg:w-auto w-full`}>
                <div className='md:block flex items-center gap-4 justify-between'>
                  <h1 className="sequel-95 md:border-r-0 max-[500px]:border-r-2 uppercase md:text-left text-center lg:text-4xl md:text-3xl text-2xl max-[500px]:text-xl max-[420px]:text-base">
                    {statusText}
                  </h1>
                  {(isWinner || status === "completed") && (
                    <img src={isWinner ? trophyV2 : flowersV2} alt={isWinner ? "trophy" : "flowers"} className="min-w-17 max-[440px]:min-w-12 md:hidden block" />
                  )}
                </div>
                <div className="bg-[#1A1A1A] h-0.5 w-full my-2 md:hidden block"></div>
                <span className="text-[0.7rem] sequel-45 mt-1 md:text-left text-center block">
                  {status === "tbd" 
                    ? "Draw date to be determined. Check back soon for results!"
                    : status === "drawn"
                      ? "Competition has ended. Drawing in progress..."
                      : isWinner 
                        ? `A member of our team will reach out to you to give you your prize. Congrats!`
                        : status === "completed" && vrfTxHash
                          ? `Sadly you didn't win it this time, but see our current competitions to enter more!`
                          : "Results pending verification."}
                </span>
                
                {/* VRF Link Display for Lost Competitions */}
                {!isWinner && vrfTxHash && status === "completed" && (
                  <a 
                    href={vrfExplorerLink!} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-[0.7rem] sequel-75 mt-2 block underline hover:opacity-80 transition-opacity"
                  >
                    View VRF Draw on Blockchain →
                  </a>
                )}
                
                {/* VRF Link and Wallet Address for Won Competitions */}
                {isWinner && vrfTxHash && (
                  <div className="mt-2 space-y-1">
                    <a 
                      href={vrfExplorerLink!} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-[0.7rem] sequel-75 block underline hover:opacity-80 transition-opacity"
                    >
                      View VRF Draw on Blockchain →
                    </a>
                    {winnerWalletAddress && (
                      <div className="text-[0.7rem] sequel-45">
                        Winner: {winnerWalletAddress.slice(0, 6)}...{winnerWalletAddress.slice(-4)}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {(isWinner || status === "completed") && (
                <div className={`${background} text-[#1A1A1A] md:flex hidden rounded-lg py-4 px-6 items-center justify-center`}>
                  <img src={isWinner ? trophyV2 : flowersV2} alt={isWinner ? "trophy" : "flowers"} className="w-18" />
                </div>
              )}
            </div>

            <Link to={'/dashboard/entries'} className="border border-[#DDE404] rounded-md sm:py-3 py-2 sm:px-6 px-4 cursor-pointer hover:scale-105 transition-all flex items-center lg:mx-0 mx-auto">
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
