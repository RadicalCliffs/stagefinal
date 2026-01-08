import React from "react";
import { Link } from "react-router";

interface BulletPoint {
  id: number | string;
  text: string;
}

interface ImageTextSectionProps {
  imageSrc: string;
  imageAlt?: string;
  title?: string;
  bullets: BulletPoint[];
  imagePosition?: "left" | "right"; // default: left
  className?: string;
  buttonText?: string;
  showButton?: boolean;
  buttonLink?: string;
  textContainerClass?: string;
  imageClass?: string;
}

const ImageTextSection: React.FC<ImageTextSectionProps> = ({
  imageSrc,
  imageAlt = "section image",
  title,
  bullets,
  imagePosition = "left",
  className = "",
  buttonLink = "",
  showButton = true,
  buttonText = "Buy Entries",
  imageClass = "",
  textContainerClass = "",
}) => {
  const isImageLeft = imagePosition === "left";

  return (
    <div className={`flex flex-col lg:flex-row items-stretch ${className}`}>
      {/* Text content */}
      <div
        className={`w-full bg-[#161616] lg:w-1/2 text-white sm:px-16 px-8 sm:py-10 py-8 order-1 ${
          isImageLeft ? "lg:order-2" : "lg:order-1"
        } ${textContainerClass}`}
      >
        {title && (
          <h2 className="sm:text-2xl text-xl md:text-3xl sequel-95 mb-6 sm:whitespace-pre-line">
            {title}
          </h2>
        )}

        <ul className="space-y-4 list-disc text-xs sequel-45 text-white">
          {bullets.map((item) => (
            <li key={item.id} className="leading-loose">
              {item.text}
            </li>
          ))}
        </ul>

        {showButton && (
          <Link
            to={buttonLink}
            className="bg-[#dde404] hover:bg-[#dde404]/90 inline-block sm:mt-10 mt-5 text-[#373635] sequel-95 uppercase border sm:text-base text-sm sm:w-fit w-full text-center border-white rounded-xl py-3 px-5"
          >
            {buttonText}
          </Link>
        )}
      </div>

      {/* Image */}
      <div
        className={`w-full lg:w-1/2 order-2 ${
          isImageLeft ? "lg:order-1" : "lg:order-2"
        }`}
      >
        <img
          src={imageSrc}
          alt={imageAlt}
          className={`w-full h-full object-cover ${imageClass}`}
        />
      </div>
    </div>
  );
};

export default ImageTextSection;
