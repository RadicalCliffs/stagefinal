import React, { useState, useEffect } from "react";
import { CircleX, Check } from "lucide-react";
import { footerLogo, bitcoinV2, monkeyNftV2, watch, trophy, crown, sportsCar } from "../assets/images";

interface CaptchaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const CaptchaModal: React.FC<CaptchaModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [selectedImage, setSelectedImage] = useState<number | null>(null);
  const [isCorrect, setIsCorrect] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const images = [
    { id: 0, src: monkeyNftV2, label: "NFT Monkey" },
    { id: 1, src: bitcoinV2, label: "Bitcoin", isCorrect: true },
    { id: 2, src: watch, label: "Watch" },
    { id: 3, src: trophy, label: "Trophy" },
    { id: 4, src: sportsCar, label: "Sports Car" },
    { id: 5, src: crown, label: "Crown" },
  ];

  useEffect(() => {
    if (!isOpen) {
      setSelectedImage(null);
      setIsCorrect(false);
      setShowSuccess(false);
    }
  }, [isOpen]);

  const handleImageClick = (imageId: number) => {
    const clickedImage = images.find(img => img.id === imageId);
    
    if (clickedImage?.isCorrect) {
      setSelectedImage(imageId);
      setIsCorrect(true);
      setShowSuccess(true);
      
      setTimeout(() => {
        onSuccess();
      }, 1200);
    } else {
      setSelectedImage(imageId);
      setIsCorrect(false);
      
      setTimeout(() => {
        setSelectedImage(null);
      }, 800);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex justify-center items-center z-50">
      <div className="bg-[#1A1A1A] fixed sm:w-full w-11/12 max-w-2xl top-1/2 left-1/2 z-10 pb-8 -translate-x-1/2 -translate-y-1/2 border-2 border-white rounded-xl">
        <img src={footerLogo} alt="prize-io" className="mx-auto relative -top-14" />
        
        <div 
          onClick={onClose} 
          className="absolute -right-4 cursor-pointer -top-5 bg-white rounded-full p-1"
        >
          <CircleX color="black" size={30} />
        </div>
        
        <h1 className="sequel-95 uppercase text-white sm:text-2xl text-xl mb-2 text-center -mt-6">
          Answer this question correctly
        </h1>
        
        <p className="sequel-45 text-white/70 text-sm text-center mb-4 px-6">
          Select the image that shows a <span className="text-[#DDE404] sequel-75">Bitcoin</span>
        </p>
        
        <p className="h-[3px] w-10/12 mx-auto bg-white mb-6"></p>

        <div className="px-6 sm:px-8">
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            {images.map((image) => (
              <div
                key={image.id}
                onClick={() => !showSuccess && handleImageClick(image.id)}
                className={`
                  relative aspect-square rounded-lg overflow-hidden cursor-pointer
                  transition-all duration-300
                  ${selectedImage === image.id && isCorrect 
                    ? 'border-4 border-[#DDE404] scale-105' 
                    : selectedImage === image.id && !isCorrect
                    ? 'border-4 border-red-500 scale-95 opacity-50'
                    : 'border-2 border-white/20 hover:border-[#DDE404] hover:scale-105'
                  }
                  ${showSuccess ? 'pointer-events-none' : ''}
                `}
              >
                <img
                  src={image.src}
                  alt={image.label}
                  className="w-full h-full object-cover"
                />
                
                {selectedImage === image.id && isCorrect && (
                  <div className="absolute inset-0 bg-[#DDE404]/20 flex items-center justify-center animate-pulse">
                    <div className="bg-[#DDE404] rounded-full p-2">
                      <Check size={32} color="#000000" />
                    </div>
                  </div>
                )}
                
                {selectedImage === image.id && !isCorrect && (
                  <div className="absolute inset-0 bg-red-500/20 flex items-center justify-center">
                    <CircleX size={32} color="#EF4444" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CaptchaModal;
