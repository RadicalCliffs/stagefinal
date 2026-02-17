import { Link } from "react-router";
import { useState } from "react";
import {
  avatar,
  discordV2,
  instagramV2,
  instantWinBannerNew,
  telegramV2,
  twitterV2,
} from "../assets/images";
import type { WinnerCardProps } from "../models/models";


export const WinnerCard = ({
  prize,
  username,
  country,
  wallet,
  date,
  showInstantWin = false,
  avatarUrl,
  competitionId: _competitionId,
  txHash,
}: WinnerCardProps) => {
  const [imgError, setImgError] = useState(false);

  return (
    <div className="w-full bg-[#1A1A1A] text-white rounded-xl overflow-hidden border border-white/10 flex flex-col max-w-[300px] mx-auto">
      {/* Prize header */}
      <div className="bg-black px-3 py-2 text-center">
        <h5 className="sequel-95 uppercase text-white text-base mb-0 break-words leading-tight">{prize}</h5>
        <p className="sequel-75 text-xs text-white/90">WINNER</p>
      </div>

      {/* Main content: Avatar on left, info on right */}
      <div className="flex p-3 gap-3 flex-1">
        {/* Avatar - takes full height on left */}
        <div className="flex-shrink-0 relative w-24">
          <img
            src={imgError ? avatar : (avatarUrl || avatar)}
            alt="Winner"
            className="w-full h-full rounded-md object-cover"
            onError={() => setImgError(true)}
          />
          {showInstantWin && (
            <img
              src={instantWinBannerNew}
              alt="instant-win-banner"
              className="absolute bottom-1 left-0 right-0 w-full rounded-md"
            />
          )}
        </div>

        {/* Info on right side */}
        <div className="flex-1 flex flex-col gap-1.5 min-w-0">
          {/* Username */}
          <div>
            <p className="sequel-45 text-[9px] text-white/60 uppercase mb-0">USERNAME:</p>
            <p className="sequel-75 text-xs text-white truncate">{username}</p>
          </div>

          {/* Country */}
          <div>
            <p className="sequel-45 text-[9px] text-white/60 uppercase mb-0">COUNTRY:</p>
            <p className="sequel-75 text-xs text-white truncate">{country}</p>
          </div>

          {/* Social icons */}
          <div className="flex items-center gap-1.5 mt-auto">
            <a href="https://www.instagram.com/theprize.io/">
              <img src={instagramV2} className="w-4 h-4" alt="instagram" />
            </a>
            <a href="https://x.com/the_prize_io">
              <img src={twitterV2} className="w-4 h-4" alt="X / Twitter" />
            </a>
            <a href="https://t.me/theprizeannouncements">
              <img src={telegramV2} className="w-4 h-4" alt="telegram" />
            </a>
            <a href="https://discord.com/invite/theprize">
              <img src={discordV2} className="w-4 h-4" alt="discord" />
            </a>
          </div>
        </div>
      </div>

      {/* Yellow button with draw date nested underneath */}
      <div className="px-3 pb-3">
        <Link
          to="/competitions/live-competition"
          className="bg-[#DDE404] block cursor-pointer hover:bg-[#DDE404]/90 text-black sequel-95 py-2 w-full rounded-md uppercase text-xs text-center border border-white"
        >
          VIEW COMPETITION
        </Link>
        <p className="sequel-45 text-[10px] text-center text-white py-1.5 mt-1">
          Draw Date: <span className="sequel-75">{date || '12.12.2025'}</span>
        </p>
      </div>

      {/* Winner wallet at bottom */}
      <div className="bg-[#0A0A0A] px-3 py-2 border-t border-white/10">
        <p className="sequel-75 text-[9px] text-white/80 uppercase mb-0.5">WINNER WALLET:</p>
        <div className="flex flex-col gap-0.5">
          <p className="sequel-45 text-[9px] text-[#DDE404] truncate font-mono">{wallet}</p>
          {txHash && (
            <a
              href={`https://basescan.org/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="sequel-45 text-[9px] text-[#DDE404] underline hover:text-[#DDE404]/80"
            >
              [View on Explorer]
            </a>
          )}
        </div>
      </div>
    </div>
  );
};