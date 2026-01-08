import { useState } from "react";
import { ArrowDownCircle } from "lucide-react";
import type { PrizeHeaderProps } from "../../models/models";

// Default fallback image for prizes when the provided image fails to load
const DEFAULT_PRIZE_IMAGE = 'https://mthwfldcjvpxjtmrqkqm.supabase.co/storage/v1/object/public/Competition%20Images/Competition%20Images/bitcoin-image.webp';

const PrizesHeader: React.FC<PrizeHeaderProps> = ({
  image,
  title,
  toBeWon,
  details,
}) => {
  const [showDetails, setShowDetails] = useState(false);
  const [imgError, setImgError] = useState(false);

  // Handle image load error by falling back to default
  const handleImageError = () => {
    setImgError(true);
  };

  // Use fallback image if error or no valid image provided
  const displayImage = imgError || !image ? DEFAULT_PRIZE_IMAGE : image;

  return (
    <div className="max-w-5xl mx-auto border-[3px] border-[#DDE404] rounded-2xl sm:p-4 p-2 transition-all duration-300">
      {/* Header section */}
      <div
        onClick={() => setShowDetails((prev) => !prev)}
        className="flex justify-between items-center sm:gap-0 gap-4 cursor-pointer"
      >
        <div className="flex items-center w-full sm:gap-7 gap-3">
          <img
            src={displayImage}
            alt={title}
            className="sm:w-44 w-32 object-contain"
            onError={handleImageError}
          />
          <div className="w-full">
            <h1 className="sequel-95 sm:text-2xl text-sm uppercase text-white mb-3">
              {title}
            </h1>
            <div className="bg-[#DDE404] rounded-lg py-2 px-4 w-fit">
              <p className="text-[#232323] sequel-45 uppercase sm:text-lg text-xs">
                <span className="sequel-95">{toBeWon}</span> to be won
              </p>
            </div>
          </div>
        </div>
        <div className="md:pr-10">
          <ArrowDownCircle
            size={30}
            color="white"
            className={`transition-transform duration-300 ${
              showDetails ? "rotate-180" : "rotate-0"
            }`}
          />
        </div>
      </div>

      {/* Smooth expanding details */}
      <div
        className={`transition-all duration-500 overflow-hidden ${
          showDetails ? "max-h-[1000px] opacity-100 mt-8" : "max-h-0 opacity-0"
        }`}
      >
        <div className="bg-[#575757] w-[99%] mx-auto h-[3px] mb-6"></div>
        {details}
      </div>
    </div>
  );
};

export default PrizesHeader;
