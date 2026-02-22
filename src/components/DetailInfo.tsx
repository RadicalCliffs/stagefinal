import { ChevronLeft } from "lucide-react";
import { Link } from "react-router";

interface Field {
  label: string;
  value: string | number;
}

interface DetailInfoProps {
  title: string;
  subtitle?: string;
  fields: Field[];
  backTo?: string;
}

const DetailInfo = ({ title, subtitle, fields, backTo }: DetailInfoProps) => {
  return (
    <div>
      <div className="border-[2px] border-[#DDE404] rounded-md mx-auto overflow-hidden">
        {/* Header */}
        <div className="flex md:flex-row flex-col items-center justify-between px-6 md:px-10 py-6 border-b-[2px] border-[#DDE404] gap-4">
          <div className="text-white  md:text-left">
            <p className="sequel-75 uppercase sm:text-xl mb-1 md:mb-2">{title}</p>
            {subtitle && <p className="sequel-45 italic text-xs sm:text-base">{subtitle}</p>}
          </div>

          {backTo && (
            <Link
              to={backTo}
              className="border border-[#DDE404] rounded-md py-3 px-3 cursor-pointer hover:scale-105 transition-all md:flex hidden items-center justify-center w-full md:w-fit"
            >
              <ChevronLeft color="#DDE404" size={18} />
              <span className="sequel-45 text-white text-sm uppercase ml-1 sm:pb-[3.5px] sm:pt-0 pt-1">
                Back
              </span>
            </Link>
          )}
        </div>

        {/* Desktop layout */}
        <div className="hidden md:flex text-white/60 sequel-45 uppercase lg:text-lg relative">
          {/* Left column (labels + border) */}
          <div className="w-5/12 relative">
            <div className="absolute right-0 top-0 bottom-0 border-r-2 border-[#DDE404]" />
            <div className="px-10 py-10 space-y-5">
              {fields.map((field, i) => (
                <p key={i}>{field.label}</p>
              ))}
            </div>
          </div>

          {/* Right column (values) */}
          <div className="w-7/12 px-10 py-10 space-y-5">
            {fields.map((field, i) => (
              <p key={i}>{field.value}</p>
            ))}
          </div>
        </div>

        {/* Mobile layout */}
        <div className="flex flex-col md:hidden sm:px-6 px-4 py-6 sm:text-sm text-xs space-y-4 sequel-45">
          {fields.map((field, i) => (
            <div
              key={i}
              className="flex justify-between items-center gap-4"
            >
              <p className="text-white/60 uppercase shrink-0">{field.label}</p>
              <p className="text-white truncate text-right min-w-0">{field.value}</p>
            </div>
          ))}
        </div>

      </div>
      {backTo && (
        <Link
          to={backTo}
          className="border border-[#DDE404] rounded-md py-3 mt-8 px-3 cursor-pointer hover:scale-105 transition-all md:hidden flex items-center justify-center w-fit mx-auto"
        >
          <ChevronLeft color="#DDE404" size={18} />
          <span className="sequel-45 text-white text-sm uppercase ml-1 sm:pb-[3.5px] sm:pt-0 pt-1">
            Back
          </span>
        </Link>
      )}
    </div>

  );
};

export default DetailInfo;
