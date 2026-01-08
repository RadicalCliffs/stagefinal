import { useState } from "react";
import { CopyIcon, CopyCheckIcon } from "lucide-react";
import { handleCopy } from "../../utils/util";

const WinnerResultsTable = () => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const data = [
    { txHash: "0x12a4b7d89c1f3456789abcd1234567890abcdef1", min: 100, max: 999, winningNumber: 234, result: 234 },
    { txHash: "0x98b2c7d1a5e934561234abcd9876543210fedcba", min: 50, max: 950, winningNumber: 657, result: 657 },
    { txHash: "0x23f9a4b8123d67e98b1c34a56789deffabc12345", min: 10, max: 500, winningNumber: 325, result: 325 },
    { txHash: "0x24f9a4b8123d67e98b1c34a56789de22abc12345", min: 33, max: 300, winningNumber: 235, result: 235 },
    { txHash: "0x25f9a4b8123d67e98b1c34a56789deffabc12345", min: 44, max: 600, winningNumber: 573, result: 573 },
    { txHash: "0x26f9a4b8123d67e98b1c34a56789deffabc12345", min: 115, max: 200, winningNumber: 125, result: 125 },
  ];



  return (
    <div className="lg:max-w-6xl max-w-7xl bg-[#191919] rounded-2xl mx-auto lg:px-14 px-8 py-8 relative z-10">
      {/* Desktop Header */}
      <div className="hidden md:grid grid-cols-5 text-white sequel-75 text-base mb-6 whitespace-nowrap">
        <p>TX Hash</p>
        <p className="text-center">Min</p>
        <p className="text-center">Max</p>
        <p className="text-center">Winning Number</p>
        <p className="text-end">Result</p>
      </div>

      {/* Divider line for desktop */}
      <div className="hidden md:block h-[2px] w-full bg-[#DDE404] mb-6"></div>

      {/* Rows */}
      <div className="space-y-4">
        {data.map((item, index) => (
          <div key={index}>
            {/* Desktop Layout */}
            <div className="hidden md:grid grid-cols-5 text-white sequel-45 items-center">
              {/* TX Hash + Copy */}
              <div className="flex items-center space-x-2">
                <p className="truncate max-w-[200px]">{item.txHash}</p>
                <div
                  className="cursor-pointer hover:scale-110 transition-transform"
                  onClick={() => handleCopy(index, item.txHash,setCopiedIndex)}
                >
                  {copiedIndex === index ? (
                    <CopyCheckIcon size={18} className="text-[#DDE404]" />
                  ) : (
                    <CopyIcon size={18} />
                  )}
                </div>
              </div>

              <p className="text-center">{item.min}</p>
              <p className="text-center">{item.max}</p>
              <p className="text-center">{item.winningNumber}</p>
              <p className="text-end">{item.result}</p>
            </div>

            {/* Mobile Layout */}
            <div className="block md:hidden text-white sequel-45 space-y-2 border-b border-[#DDE404] pb-4 ">
              <div className="flex justify-between items-center">
                <span className="text-white/60">TX Hash</span>
                <div className="flex items-center space-x-2">
                  <p className="truncate max-w-[130px]">{item.txHash}</p>
                  <div
                    className="cursor-pointer hover:scale-110 transition-transform"
                    onClick={() => handleCopy(index, item.txHash, setCopiedIndex)}
                  >
                    {copiedIndex === index ? (
                      <CopyCheckIcon size={16} className="text-[#DDE404]" />
                    ) : (
                      <CopyIcon size={16} />
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-between">
                <span className="text-white/60">Min</span>
                <span>{item.min}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-white/60">Max</span>
                <span>{item.max}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-white/60">Winning Number</span>
                <span>{item.winningNumber}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-white/60">Result</span>
                <span>{item.result}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default WinnerResultsTable;
