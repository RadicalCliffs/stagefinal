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
    <div className="w-full bg-[#1A1A1A] text-white rounded-xl overflow-hidden border-[3px] border-white hover:border-[#DDE404] transition-colors flex flex-col max-w-[260px] mx-auto cursor-pointer">
      {/* Prize header */}
      <div className="bg-black px-3 py-2 text-center">
        <h5 className="sequel-95 uppercase text-white text-sm mb-0 break-all leading-tight">{prize}</h5>
        <p className="sequel-75 text-[11px] text-white/90">WINNER</p>
      </div>

      {/* Main content: Avatar on left, info on right */}
      <div className="flex p-2.5 gap-2.5 flex-1">
        {/* Avatar - takes full height on left */}
        <div className="shrink-0 relative w-20">
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
              className="absolute bottom-0.5 left-0 right-0 w-full rounded-md"
            />
          )}
        </div>

        {/* Info on right side */}
        <div className="flex-1 flex flex-col gap-1 min-w-0">
          {/* Username */}
          <div>
            <p className="sequel-45 text-[8px] text-white/60 uppercase mb-0">USERNAME:</p>
            <p className="sequel-75 text-[11px] text-white truncate">{username}</p>
          </div>

          {/* Country */}
          <div>
            <p className="sequel-45 text-[8px] text-white/60 uppercase mb-0">COUNTRY:</p>
            <p className="sequel-75 text-[11px] text-white truncate">{country}</p>
          </div>

          {/* Social icons */}
          <div className="flex items-center gap-1 mt-auto">
            <a href="https://www.instagram.com/theprize.io/">
              <img src={instagramV2} className="w-3.5 h-3.5" alt="instagram" />
            </a>
            <a href="https://x.com/the_prize_io">
              <img src={twitterV2} className="w-3.5 h-3.5" alt="X / Twitter" />
            </a>
            <a href="https://t.me/theprizeannouncements">
              <img src={telegramV2} className="w-3.5 h-3.5" alt="telegram" />
            </a>
            <a href="https://discord.com/invite/theprize">
              <img src={discordV2} className="w-3.5 h-3.5" alt="discord" />
            </a>
          </div>
        </div>
      </div>

      {/* Yellow button with draw date nested underneath */}
      <div className="px-2.5 pb-2.5">
        <Link
          to="/competitions/live-competition"
          className="bg-[#DDE404] block cursor-pointer hover:bg-[#DDE404]/90 text-black sequel-95 py-1.5 w-full rounded-md uppercase text-[10px] text-center border border-white"
        >
          VIEW COMPETITION
        </Link>
        <p className="sequel-45 text-[9px] text-center text-white py-1 mt-0.5">
          Draw Date: <span className="sequel-75">{date || '12.12.2025'}</span>
        </p>
      </div>

      {/* Winner wallet at bottom - CENTERED and ALWAYS CLICKABLE */}
      <div className="bg-[#0A0A0A] px-2.5 py-1.5 border-t border-white/10">
        <p className="sequel-75 text-[8px] text-white/80 uppercase mb-0.5 text-center">WINNER WALLET:</p>
        <div className="flex flex-col gap-0.5 items-center">
          <a
            href={`https://basescan.org/address/${wallet}`}
            target="_blank"
            rel="noopener noreferrer"
            className="sequel-45 text-[8px] text-[#DDE404] hover:text-[#DDE404]/80 hover:underline font-mono break-all text-center"
            onClick={(e) => e.stopPropagation()}
          >
            {wallet}
          </a>
        </div>
        {/* VRF Transaction Hash - clickable link to BaseScan */}
        {txHash && /^0x[a-fA-F0-9]{64}$/.test(txHash) && (
          <div className="mt-1 pt-1 border-t border-white/5">
            <p className="sequel-75 text-[8px] text-white/80 uppercase mb-0.5 text-center">VRF TX:</p>
            <a
              href={`https://basescan.org/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="sequel-45 text-[7px] text-[#DDE404] hover:text-[#DDE404]/80 hover:underline font-mono break-all text-center block"
              onClick={(e) => e.stopPropagation()}
            >
              {txHash.slice(0, 10)}...{txHash.slice(-8)}
            </a>
          </div>
        )}
      </div>
    </div>
  );
};