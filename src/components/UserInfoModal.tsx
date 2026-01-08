import React, { useState, useEffect, useRef, useMemo } from "react";
import { CircleX } from "lucide-react";
import { footerLogo } from "../assets/images";
import { useAuthUser } from "../contexts/AuthContext";

interface UserInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPayWithCrypto: (userInfo: UserInfo) => void;
  onPayWithCard?: (userInfo: UserInfo) => void;
  ticketCount: number;
  totalAmount: number;
  savedInfo?: UserInfo;
}

export interface UserInfo {
  firstName: string;
  lastName: string;
  address: string; // This is email address
  country: string;
  phoneNumber: string;
}

const STORAGE_KEY = "prize-io:user-info";

// Helper function to get cached data from localStorage
const getCachedUserInfo = (): UserInfo | null => {
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      return JSON.parse(cached) as UserInfo;
    }
  } catch {
    // Ignore parse errors
  }
  return null;
};

const UserInfoModal: React.FC<UserInfoModalProps> = ({
  isOpen,
  onClose,
  onPayWithCrypto,
  onPayWithCard,
  ticketCount,
  totalAmount,
  savedInfo,
}) => {
  const { profile } = useAuthUser();
  const [formData, setFormData] = useState<UserInfo>({
    firstName: "",
    lastName: "",
    address: "",
    country: "",
    phoneNumber: "",
  });
  const [errors, setErrors] = useState<Partial<UserInfo>>({});
  const autoProceededRef = useRef(false);
  const hasCalledAutoProceed = useRef(false);

  // Calculate merged user info and auto-proceed eligibility synchronously
  // This prevents the modal from flashing before auto-proceeding
  const { mergedInfo, shouldAutoProceed } = useMemo(() => {
    if (!isOpen) {
      return { mergedInfo: null, shouldAutoProceed: false };
    }

    const cachedData = getCachedUserInfo();

    // Merge data sources with priority: Profile (DB) > localStorage > savedInfo
    const merged: UserInfo = {
      firstName: profile?.first_name || cachedData?.firstName || savedInfo?.firstName || "",
      lastName: profile?.last_name || cachedData?.lastName || savedInfo?.lastName || "",
      address: profile?.email || cachedData?.address || savedInfo?.address || "",
      country: profile?.country || cachedData?.country || savedInfo?.country || "",
      phoneNumber: profile?.telephone_number || cachedData?.phoneNumber || savedInfo?.phoneNumber || "",
    };

    // Check if all required fields are filled
    const hasAllRequiredFields = !!(
      merged.firstName.trim() &&
      merged.lastName.trim() &&
      merged.address.trim() &&
      merged.country.trim()
    );

    return { mergedInfo: merged, shouldAutoProceed: hasAllRequiredFields };
  }, [isOpen, profile, savedInfo]);

  useEffect(() => {
    if (isOpen) {
      // Reset flags when modal opens fresh
      autoProceededRef.current = false;
      hasCalledAutoProceed.current = false;

      if (mergedInfo) {
        setFormData(mergedInfo);
      }
    } else {
      setErrors({});
    }
  }, [isOpen, mergedInfo]);

  // Handle auto-proceed in a separate effect to avoid calling onPayWithCrypto during render
  useEffect(() => {
    if (isOpen && shouldAutoProceed && mergedInfo && !hasCalledAutoProceed.current) {
      hasCalledAutoProceed.current = true;
      autoProceededRef.current = true;
      // Use setTimeout to ensure we're not calling during render cycle
      setTimeout(() => {
        onPayWithCrypto(mergedInfo);
      }, 0);
    }
  }, [isOpen, shouldAutoProceed, mergedInfo, onPayWithCrypto]);

  const persistUserInfo = (info: UserInfo) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(info));
    } catch (error) {
      console.warn("Unable to persist user info", error);
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Partial<UserInfo> = {};

    if (!formData.firstName.trim()) newErrors.firstName = "First name is required";
    if (!formData.lastName.trim()) newErrors.lastName = "Last name is required";
    if (!formData.address.trim()) newErrors.address = "Email address is required";
    if (!formData.country.trim()) newErrors.country = "Country is required";
    // Phone number is now optional
    if (formData.phoneNumber && !/^\+?[\d\s\-()]+$/.test(formData.phoneNumber)) {
      newErrors.phoneNumber = "Please enter a valid phone number";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    if (errors[name as keyof UserInfo]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const handlePayWithCrypto = () => {
    if (validateForm()) {
      persistUserInfo(formData);
      onPayWithCrypto(formData);
    }
  };

  const handlePayWithCard = () => {
    if (validateForm() && onPayWithCard) {
      persistUserInfo(formData);
      onPayWithCard(formData);
    }
  };

  // Don't render if modal is closed OR if we should auto-proceed
  // The shouldAutoProceed check is synchronous (from useMemo) which prevents the flash
  if (!isOpen || shouldAutoProceed) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex justify-center items-center z-50 p-4">
      <div className="bg-[#1A1A1A] relative w-full max-w-2xl border-2 border-white rounded-xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-[#1A1A1A] pt-4 z-10">
          <img src={footerLogo} alt="ThePrize.io" className="mx-auto w-32 sm:w-auto" />
        </div>

        <div
          onClick={onClose}
          className="absolute right-2 top-2 sm:right-4 sm:top-4 cursor-pointer bg-white rounded-full p-1 z-20"
        >
          <CircleX color="black" size={24} className="sm:w-[30px] sm:h-[30px]" />
        </div>

        <div className="px-4 sm:px-6 pb-6">
          <h1 className="sequel-95 uppercase text-white text-xl sm:text-2xl mb-2 text-center">
            Enter Your Details
          </h1>

          <p className="sequel-45 text-white/70 text-sm text-center mb-4">
            {ticketCount} {ticketCount > 1 ? 'entries' : 'entry'} for ${totalAmount?.toFixed(2) ?? '0.00'}
          </p>

          <div className="h-[2px] w-full bg-white mb-6"></div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="sequel-75 text-white text-sm block mb-2">
                First Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="firstName"
                value={formData.firstName}
                onChange={handleChange}
                className={`w-full bg-[#141414] border ${
                  errors.firstName ? 'border-red-500' : 'border-white/20'
                } rounded-lg px-3 py-2 sm:px-4 sm:py-3 text-white text-sm sequel-45 focus:outline-none focus:border-[#DDE404] transition-colors`}
                placeholder="John"
              />
              {errors.firstName && (
                <p className="text-red-500 text-xs sequel-45 mt-1">{errors.firstName}</p>
              )}
            </div>

            <div>
              <label className="sequel-75 text-white text-sm block mb-2">
                Last Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="lastName"
                value={formData.lastName}
                onChange={handleChange}
                className={`w-full bg-[#141414] border ${
                  errors.lastName ? 'border-red-500' : 'border-white/20'
                } rounded-lg px-3 py-2 sm:px-4 sm:py-3 text-white text-sm sequel-45 focus:outline-none focus:border-[#DDE404] transition-colors`}
                placeholder="Doe"
              />
              {errors.lastName && (
                <p className="text-red-500 text-xs sequel-45 mt-1">{errors.lastName}</p>
              )}
            </div>
          </div>

          <div>
            <label className="sequel-75 text-white text-sm block mb-2">
              Email Address <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              name="address"
              value={formData.address}
              onChange={handleChange}
              className={`w-full bg-[#141414] border ${
                errors.address ? 'border-red-500' : 'border-white/20'
              } rounded-lg px-3 py-2 sm:px-4 sm:py-3 text-white text-sm sequel-45 focus:outline-none focus:border-[#DDE404] transition-colors`}
              placeholder="your@email.com"
            />
            {errors.address && (
              <p className="text-red-500 text-xs sequel-45 mt-1">{errors.address}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="sequel-75 text-white text-sm block mb-2">
                Country <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="country"
                value={formData.country}
                onChange={handleChange}
                className={`w-full bg-[#141414] border ${
                  errors.country ? 'border-red-500' : 'border-white/20'
                } rounded-lg px-3 py-2 sm:px-4 sm:py-3 text-white text-sm sequel-45 focus:outline-none focus:border-[#DDE404] transition-colors`}
                placeholder="United States"
              />
              {errors.country && (
                <p className="text-red-500 text-xs sequel-45 mt-1">{errors.country}</p>
              )}
            </div>

            <div>
              <label className="sequel-75 text-white text-sm block mb-2">
                Phone Number <span className="text-white/50">(optional)</span>
              </label>
              <input
                type="tel"
                name="phoneNumber"
                value={formData.phoneNumber}
                onChange={handleChange}
                className={`w-full bg-[#141414] border ${
                  errors.phoneNumber ? 'border-red-500' : 'border-white/20'
                } rounded-lg px-3 py-2 sm:px-4 sm:py-3 text-white text-sm sequel-45 focus:outline-none focus:border-[#DDE404] transition-colors`}
                placeholder="+1 234 567 8900"
              />
              {errors.phoneNumber && (
                <p className="text-red-500 text-xs sequel-45 mt-1">{errors.phoneNumber}</p>
              )}
            </div>
          </div>

          <div className="pt-4 space-y-3">
            <button
              onClick={handlePayWithCrypto}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white sequel-95 uppercase py-3 sm:py-4 text-sm sm:text-base rounded-lg transition-all border-2 border-blue-500 hover:border-blue-400"
            >
              Continue to Payment
            </button>
            <p className="text-center text-blue-300/70 sequel-45 text-xs">
              Pay with Base USDC or other cryptocurrencies
            </p>

            {onPayWithCard && (
              <>
                <div className="flex items-center gap-4 my-2">
                  <div className="flex-1 h-[1px] bg-white/20"></div>
                  <span className="text-white/50 sequel-45 text-xs">OR</span>
                  <div className="flex-1 h-[1px] bg-white/20"></div>
                </div>
                <button
                  onClick={handlePayWithCard}
                  className="w-full bg-[#3c3d3c] hover:bg-[#4a4b4a] text-white sequel-95 uppercase py-3 sm:py-4 text-sm sm:text-base rounded-lg transition-all border-2 border-white/20 hover:border-white/40"
                >
                  Pay With Card
                </button>
                <p className="text-center text-white/50 sequel-45 text-xs">
                  Credit/Debit Cards Accepted
                </p>
              </>
            )}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
};

export default UserInfoModal;
