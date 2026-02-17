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
    <div className="w-full bg-[#181818] text-white rounded-lg overflow-hidden h-full flex flex-col border border-white/10 max-w-[280px] mx-auto">
      {/* Prize header - compact */}
      <div className="bg-black px-3 py-2 text-center">
        <h5 className="sequel-95 uppercase text-white text-sm mb-0 break-words leading-tight">{prize}</h5>
        <p className="sequel-75 text-xs text-white/90">WINNER</p>
      </div>

      {/* Avatar - small */}
      <div className="flex justify-center relative px-3 py-2 bg-[#1A1A1A]">
        <img
          src={imgError ? avatar : (avatarUrl || avatar)}
          alt="Winner"
          className="w-16 h-16 rounded-md object-cover"
          onError={() => setImgError(true)}
        />
        {showInstantWin && (
          <img
            src={instantWinBannerNew}
            alt="instant-win-banner"
            className="absolute bottom-1 w-14 rounded-md"
          />
        )}
      </div>

      {/* Compact content section */}
      <div className="px-3 py-2 flex-1 flex flex-col gap-1.5">
        {/* Username section */}
        <div>
          <p className="sequel-45 text-[9px] text-white/60 uppercase mb-0">Username:</p>
          <p className="sequel-75 text-xs text-white truncate">{username}</p>
        </div>

        {/* Country section */}
        <div>
          <p className="sequel-45 text-[9px] text-white/60 uppercase mb-0">Country:</p>
          <p className="sequel-75 text-xs text-white truncate">{country}</p>
        </div>

        {/* Social icons row - very compact */}
        <div className="flex items-center justify-center gap-1.5 py-1">
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

        {/* View Competition button */}
        <Link
          to="/competitions/live-competition"
          className="bg-[#DDE404] block cursor-pointer hover:bg-[#DDE404]/90 text-black sequel-95 py-1.5 w-full rounded-md uppercase text-[10px] text-center border border-white"
        >
          VIEW COMPETITION
        </Link>

        {/* Draw date */}
        <p className="sequel-45 text-[9px] text-center bg-[#2A2A2A] text-white py-1.5 rounded-md">
          Draw: <span className="sequel-75">{date || '12.12.2025'}</span>
        </p>
      </div>

      {/* Winner wallet at bottom - very compact */}
      <div className="bg-[#0A0A0A] px-2 py-1.5 border-t border-white/10">
        <p className="sequel-75 text-[9px] text-white/80 uppercase mb-0.5">WINNER WALLET:</p>
        <div className="flex flex-col gap-0.5">
          <p className="sequel-45 text-[8px] text-[#DDE404] truncate font-mono">{wallet}</p>
          {txHash && (
            <a
              href={`https://basescan.org/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="sequel-45 text-[8px] text-[#DDE404] underline hover:text-[#DDE404]/80"
            >
              [View on Explorer]
            </a>
          )}
        </div>
      </div>
    </div>
  );
};