import { ChevronDown } from "lucide-react";
import type { TableRow } from "../models/models";
import { useState } from "react";
import { avatar as defaultAvatar } from "../assets/images";

// Avatar component with fallback handling
const AvatarImg = ({ src, alt, className }: { src: string; alt: string; className: string }) => {
  const [imgError, setImgError] = useState(false);
  return (
    <img
      src={imgError ? defaultAvatar : (src || defaultAvatar)}
      alt={alt}
      className={className}
      onError={() => setImgError(true)}
    />
  );
};

export default function ActivityTable({ data }: { data: TableRow[] }) {
  const [displayCount, setDisplayCount] = useState(5);

  const visibleData = data.slice(0, displayCount);
  const hasMore = data.length > displayCount;

  const handleLoadMore = () => {
    setDisplayCount(prev => Math.min(prev + 10, data.length));
  };

  return (
    <div
      id="activity-table"
      className="w-full max-w-7xl mx-auto md:mt-6 mt-5 bg-[#131313] p-4 rounded-md relative z-10"
    >
      {/* ✅ Desktop / Tablet Table */}
      <div className="overflow-x-auto custom-scrollbar rounded-md shadow-lg bg-[#262626] hidden md:block relative z-10">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#DDE404] text-[#280508] text-left md:text-base text-sm sequel-45 uppercase">
              <th className="py-4 md:px-8 px-4 rounded-tl-md">Competition</th>
              <th className="py-4 md:px-8 px-4">User</th>
              <th className="py-4 md:px-8 px-4">Action</th>
              <th className="py-4 md:px-8 px-4">Amount</th>
              <th className="py-4 md:px-8 px-4 rounded-tr-md md:text-left text-end">
                Time
              </th>
            </tr>
          </thead>
          <tbody className="bg-[#262626]">
            {visibleData.map((row, idx) => (
              <tr
                key={idx}
                className={`bg-[#262626] ${visibleData.length == 1 ? '' : 'border-b'}  border-[#DDE404] text-white sequel-45 md:text-sm text-xs`}
              >
                <td className="py-4 md:px-8 px-4 uppercase">
                  {row.competition}
                </td>
                <td className="py-4 md:px-8 px-4 flex items-center gap-3">
                  <AvatarImg
                    src={row.user.avatar}
                    alt={row.user.name}
                    className="w-8 h-8 rounded-md object-contain"
                  />
                  <span>{row.user.name}</span>
                </td>
                <td
                  className={`py-4 md:px-8 md:text-left text-end px-4 uppercase ${
                    row.action === "Win" ? "text-[#79C500]" : ""
                  }`}
                >
                  {row.action}
                </td>
                <td className="py-4 md:px-8 px-4 md:text-left text-end">
                  {row.amount}
                </td>
                <td className="py-4 md:px-8 px-4 md:text-left text-end whitespace-nowrap">
                  {row.time}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {hasMore && (
          <div onClick={handleLoadMore} className="py-4 text-center cursor-pointer hover:bg-[#2a2a2a] transition-colors">
            <span className="text-[#DDE404] mr-1 sequel-45 text-sm ">
              View More ({data.length - displayCount} remaining)
            </span>
            <ChevronDown size={20} color="#DDE404" className="inline" />
          </div>
        )}
      </div>

      {/* ✅ Mobile Layout (Custom Cards) */}
      <div className="md:hidden space-y-3">
        {visibleData.map((row, idx) => (
          <div
            key={idx}
            className="bg-[#272727] rounded-md p-3 text-white sequel-45 text-xs"
          >
            {/* Top row: username, amount, action */}
            <div className="flex justify-between items-center gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <AvatarImg
                  src={row.user.avatar}
                  alt={row.user.name}
                  className="w-6 h-6 rounded-md object-contain flex-shrink-0"
                />
                <span className="sequel-75 truncate">{row.user.name}</span>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="sequel-75 whitespace-nowrap">{row.amount}</span>
                <span
                  className={`uppercase sequel-75 whitespace-nowrap ${
                    row.action === "Win" ? "text-[#79C500]" : "text-white"
                  }`}
                >
                  {row.action}
                </span>
              </div>
            </div>

            {/* Divider */}
            <div className="border-b border-[#DDE404] my-2"></div>

            {/* Bottom row: competition & time */}
            <div className="flex justify-between items-center gap-2 text-[11px] text-[#bdbdbd]">
              <span className="uppercase truncate flex-1">{row.competition}</span>
              <span className="flex-shrink-0 whitespace-nowrap">{row.time}</span>
            </div>
          </div>
        ))}

        {/* View More Button */}
        {hasMore && (
          <div onClick={handleLoadMore} className="text-center cursor-pointer py-2">
            <span className="text-[#DDE404] mr-1 sequel-45 text-sm">
              View More ({data.length - displayCount} remaining)
            </span>
            <ChevronDown size={20} color="#DDE404" className="inline" />
          </div>
         )}
      </div>
    </div>
  );
}
