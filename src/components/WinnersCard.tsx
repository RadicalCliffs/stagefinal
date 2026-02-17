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
    <div className="w-full bg-[#181818] text-white md:p-2 md:pb-4 p-3 pb-5 md:rounded-xl rounded-lg shadow-lg  overflow-hidden h-full flex flex-col">
      <div className="flex justify-center relative mb-3">
        <img
          src={imgError ? avatar : (avatarUrl || avatar)}
          alt="Winner"
          className="w-full rounded-t-lg"
          onError={() => setImgError(true)}
        />
        {showInstantWin && (
          <img
            src={instantWinBannerNew}
            alt="instant-win-banner"
            className="absolute bottom-0 w-10/12 rounded-t-lg"
          />
        )}
      </div>

      <div className="md:px-4 px-2 overflow-hidden flex-1 flex flex-col">
        <div>
          <h5 className="sequel-75 uppercase md:text-lg text-base mb-2 break-words">{username}</h5>
          <div className="mt-1.5 w-full h-[2px] bg-[#DDE404]"></div>
        </div>

        <div className="flex justify-between items-center md:mt-2 md:mb-1.5 my-3 gap-2">
          <div className="min-w-0 flex-shrink">
            <h6 className="sequel-75 uppercase text-white md:text-sm text-xs">Prize:</h6>
            <span className="sequel-45 text-[#727272] md:text-xs text-[10px] truncate block">
              {prize}
            </span>
          </div>

          <div className="flex items-center md:space-x-1.5 space-x-1.5 flex-shrink-0">
            <a href="https://www.instagram.com/theprize.io/">
              <img src={instagramV2} className="md:w-6 w-5" alt="instagram" />
            </a>
            <a href="https://t.me/theprizeannouncements">
              <img src={telegramV2} className="md:w-6 w-5" alt="telegram" />
            </a>
            <a href="https://x.com/the_prize_io">
              <img src={twitterV2} className="md:w-6 w-5" alt="X / Twitter" />
            </a>
            <a href="https://discord.com/invite/theprize">
              <img src={discordV2} className="md:w-6 w-5" alt="discord" />
            </a>
          </div>
        </div>
        <div>
          <h6 className="sequel-75 uppercase text-white md:text-sm text-xs">Country:</h6>
          <p className="sequel-45 text-[#727272] md:text-xs text-[10px] break-words">{country}</p>
        </div>

        <div className="md:mt-2 mt-3">
          <h6 className="sequel-75 uppercase text-white md:text-sm text-xs">Winner Wallet:</h6>
          <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-2 text-[#DDE404] md:text-xs text-[10px] mt-1">
            <p className="sequel-45 truncate">{wallet}</p>
            {txHash && (
              <a
                href={`https://basescan.org/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline sequel-45 whitespace-nowrap hover:text-[#DDE404]/80"
              >
                [View on Explorer]
              </a>
            )}
          </div>
        </div>

        <div className="text-center mt-4 ">
          <Link
            to="/competitions/live-competition"
            className="bg-[#DDE404] block cursor-pointer hover:bg-[#DDE404]/90 text-[#151517] sequel-95 border border-white md:pt-2.5 md:pb-2 py-3 w-full rounded-md uppercase md:text-base text-sm"
          >
            View Competition
          </Link>
          <p className="sequel-75 md:text-sm text-xs bg-[#383838] text-white md:py-2.5 py-3.5 rounded-b-md break-words">
            Draw Date:{" "}
            <span className="text-white sequel-45">{date || '12.12.2025'}</span>
          </p>
        </div>
      </div>
    </div>
  );
};