import { useNavigate } from "react-router";
import { useState } from "react";
import { avatar as defaultAvatar, bitcoinV2 } from "../assets/images";

interface WinsCompetitionCardProps {
  id: string;
  image: string;
  title: string;
  prize: string;
  winner: {
    name: string;
    avatar: string;
  };
  date: string;
}

export default function WinsCompetitionCard({
  id,
  image,
  title,
  prize,
  winner,
  date
}: WinsCompetitionCardProps) {
  const navigate = useNavigate();
  const [imgError, setImgError] = useState(false);
  const [avatarError, setAvatarError] = useState(false);

  return (
    <div
      className="bg-[#262626] md:rounded-xl rounded-2xl overflow-hidden border-2 border-[#79C500] hover:border-[#DDE404] transition-all duration-300 cursor-pointer group"
      onClick={() => navigate(`/competitions/drawn-competition?id=${id}`)}
    >
      <div className="relative aspect-square overflow-hidden">
        <img
          src={imgError ? bitcoinV2 : (image || bitcoinV2)}
          alt={title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          onError={() => setImgError(true)}
        />
        <div className="absolute md:top-3 md:right-3 top-3 right-3 bg-[#79C500] text-black md:px-3 md:py-1 px-4 py-2 rounded-md sequel-75 md:text-xs text-xs uppercase">
          Winner
        </div>
      </div>

      <div className="md:p-4 p-5 md:space-y-3 space-y-4">
        <h3 className="text-white sequel-75 md:text-lg text-base uppercase truncate">
          {title}
        </h3>

        <div className="flex items-center justify-between">
          <span className="text-[#DDE404] sequel-75 md:text-sm text-sm">Prize:</span>
          <span className="text-white sequel-45 md:text-sm text-sm">{prize}</span>
        </div>

        <div className="border-t border-[#3B3B3B] md:pt-3 pt-4">
          <div className="flex items-center gap-2 md:mb-2 mb-3">
            <img
              src={avatarError ? defaultAvatar : (winner.avatar || defaultAvatar)}
              alt={winner.name}
              className="md:w-6 md:h-6 w-7 h-7 rounded-md object-contain"
              onError={() => setAvatarError(true)}
            />
            <span className="text-white sequel-45 md:text-sm text-sm truncate flex-1">
              {winner.name}
            </span>
          </div>

          <div className="text-white/60 sequel-45 md:text-xs text-xs">
            Won {date}
          </div>
        </div>
      </div>
    </div>
  );
}
