import { ArrowLeftCircleIcon, CopyCheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { tokenLogo } from "../../assets/images";
import { useState } from "react";
import type { WinnerHashCardProps } from "../../models/models";
import { handleCopy } from "../../utils/util";


const WinnerHashCard: React.FC<WinnerHashCardProps> = ({
    fields,
    onBack,
    showBackgroundImage = true,
    outerContainerClasses
}) => {

    const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

    return (
        <div className={`bg-[#191919] max-w-7xl mx-auto rounded-2xl lg:px-20 px-6 lg:py-14 py-8 relative overflow-hidden ${outerContainerClasses}`}>
            {showBackgroundImage && (
                <img
                    src={tokenLogo}
                    alt="token-logo"
                    className="absolute right-0 bottom-0 w-6/12  pointer-events-none lg:block hidden"
                />
            )}

            <div className="space-y-6">
                {fields.map((field, index) => (
                    <div
                        key={index}
                        className="flex items-end justify-between "
                    >
                        <div>
                            <p className="sequel-75 text-[#DDE404] md:text-2xl sm:text-xl text-lg">{field.label}</p>
                            {field.link ? (
                                <a
                                    href={field.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="sequel-95 text-white md:text-xl sm:text-lg mt-1 uppercase hover:text-[#DDE404] transition-colors flex items-center gap-2"
                                >
                                    {field.value}
                                    <ExternalLinkIcon className="w-5 h-5 shrink-0" />
                                </a>
                            ) : (
                                <p className="sequel-95 text-white md:text-xl sm:text-lg mt-1 uppercase">{field.value}</p>
                            )}
                        </div>
                        {field.copyable && (
                            <div
                                className="text-white cursor-pointer hover:scale-110 transition-transform"
                                onClick={() => handleCopy(index, field.value, setCopiedIndex)}
                            >
                                {copiedIndex === index ? (
                                    <CopyCheckIcon className="text-[#DDE404]" />
                                ) : (
                                    <CopyIcon />
                                )}
                            </div>
                        )}
                    </div>
                ))}

                {onBack && (
                    <button
                        onClick={onBack}
                        className="border border-[#DDE404] rounded-3xl py-3 px-6 mt-8 cursor-pointer hover:scale-105 transition-all flex items-center"
                    >
                        <ArrowLeftCircleIcon color="#DDE404" size={24} />
                        <span className="sequel-45 text-white uppercase ml-3 sm:pb-0.5 sm:pt-0 pt-1">Back</span>
                    </button>
                )}
            </div>
        </div>
    );
};

export default WinnerHashCard;
