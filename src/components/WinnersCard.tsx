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
    <div className="w-full bg-[#1A1A1A] text-white rounded-xl overflow-hidden h-full flex flex-col border border-white/10">
      {/* Simplified image section - no avatar image shown */}
      <div className="bg-black p-6 text-center">
        <h5 className="sequel-95 uppercase text-white text-xl mb-1 break-words">{prize}</h5>
        <p className="sequel-75 text-base text-white/90">WINNER</p>
      </div>

      {/* Compact content section */}
      <div className="px-4 py-3 flex-1 flex flex-col justify-between">
        {/* Username section */}
        <div className="mb-3">
          <p className="sequel-45 text-[10px] text-white/60 uppercase mb-1">Username:</p>
          <p className="sequel-75 text-sm text-white break-words">{username}</p>
        </div>

        {/* Country section */}
        <div className="mb-3">
          <p className="sequel-45 text-[10px] text-white/60 uppercase mb-1">Country:</p>
          <p className="sequel-75 text-sm text-white break-words">{country}</p>
        </div>

        {/* Social icons row - compact */}
        <div className="flex items-center justify-center gap-2 mb-3">
          <a href="https://www.instagram.com/theprize.io/">
            <img src={instagramV2} className="w-5 h-5" alt="instagram" />
          </a>
          <a href="https://x.com/the_prize_io">
            <img src={twitterV2} className="w-5 h-5" alt="X / Twitter" />
          </a>
          <a href="https://t.me/theprizeannouncements">
            <img src={telegramV2} className="w-5 h-5" alt="telegram" />
          </a>
          <a href="https://discord.com/invite/theprize">
            <img src={discordV2} className="w-5 h-5" alt="discord" />
          </a>
        </div>

        {/* View Competition button */}
        <Link
          to="/competitions/live-competition"
          className="bg-[#DDE404] block cursor-pointer hover:bg-[#DDE404]/90 text-black sequel-95 py-2 w-full rounded-md uppercase text-xs text-center"
        >
          VIEW COMPETITION
        </Link>

        {/* Draw date */}
        <p className="sequel-45 text-[10px] text-center bg-[#1A1A1A] text-white py-2 mt-2 rounded-md">
          Draw Date: <span className="sequel-75">{date || '12.12.2025'}</span>
        </p>
      </div>

      {/* Winner wallet at bottom - compact */}
      <div className="bg-[#0A0A0A] px-3 py-2 border-t border-white/10">
        <p className="sequel-75 text-[10px] text-white/80 uppercase mb-1">WINNER WALLET:</p>
        <div className="flex flex-col gap-1">
          <p className="sequel-45 text-[9px] text-[#DDE404] truncate">{wallet}</p>
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