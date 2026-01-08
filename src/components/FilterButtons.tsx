import type { FilterTabsProps, Options } from "../models/models";

export default function FilterTabs({
  options,
  active,
  onChange,
  containerClasses,
  buttonClasses,
}: FilterTabsProps<Options>) {
  return (
    <div className={containerClasses}>
      {options.map((option) => (
        <button
          key={option.key}
          onClick={() => onChange(option)}
          className={`py-3 px-4 sm:px-6 lg:text-sm md:text-xs text-xs uppercase rounded-lg cursor-pointer transition-all duration-200
            ${
              active?.key === option.key
                ? "bg-[#DDE404] sequel-75 text-[#1A1A1A] border-2 border-[#DDE404] shadow-lg shadow-[#DDE404]/20"
                : "bg-[#2A2A2A] text-white sequel-45 border-2 border-transparent hover:bg-[#3A3A3A] hover:border-[#DDE404]/30"
            } ${buttonClasses}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
