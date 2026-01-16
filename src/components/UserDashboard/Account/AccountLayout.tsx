import { useState, useEffect, useRef } from 'react';
import Heading from '../../Heading';
import AccountAvatarSection from './AccountAvatarSection';
import ProfileForm from './UserAccountForm';
import type { ProfileFormData } from '../../../models/models';
import { userDataService } from '../../../services/userDataService';
import { useAuthUser } from '../../../contexts/AuthContext';
import Loader from '../../Loader';
import { Copy, Check } from 'lucide-react';
import ProfileUpdateSuccessModal from '../../ProfileUpdateSuccessModal';

export default function Account() {
    const { profile: userProfile, isLoading: authLoading, refreshUserData, baseUser } = useAuthUser();
    const [isEditMode, setisEditMode] = useState<boolean>(false);
    const [copied, setCopied] = useState(false);
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [profile, setProfile] = useState<ProfileFormData>({
        username: "",
        email_address: "",
        telegram_handle: "",
        country: "",
        telephone_number: "",
    });

    // Track if profile was ever loaded to prevent showing loader on subsequent re-renders
    // This fixes the race condition where profile temporarily becomes null during page navigation
    const profileEverLoadedRef = useRef(false);
    const lastProfileIdRef = useRef<string | null>(null);

    // Update the ref when we have a profile
    useEffect(() => {
        if (userProfile?.id) {
            profileEverLoadedRef.current = true;
            lastProfileIdRef.current = userProfile.id;
        }
    }, [userProfile?.id]);

    useEffect(() => {
        if (userProfile) {
            setProfile({
                username: userProfile.username || "",
                email_address: userProfile.email || "",
                telegram_handle: userProfile.telegram_handle || "",
                country: userProfile.country || "",
                telephone_number: userProfile.telephone_number || "",
            });
        }
    }, [userProfile]);

    const handleProfileUpdate = async (updatedProfile: ProfileFormData) => {
        // Use Base wallet address as the primary identifier for updates
        const userId = baseUser?.id || userProfile?.id;
        if (!userId) return;

        try {
            const success = await userDataService.updateUserProfile(userId, {
                username: updatedProfile.username,
                email: updatedProfile.email_address,
                telegram_handle: updatedProfile.telegram_handle,
                country: updatedProfile.country,
                telephone_number: updatedProfile.telephone_number,
            });

            if (success) {
                setProfile(updatedProfile);
                await refreshUserData();
                // Show success modal with competitions carousel
                setShowSuccessModal(true);
            } else {
                alert('Failed to update profile. Please try again.');
            }
        } catch (error) {
            console.error('Failed to update profile:', error);
            alert('An error occurred. Please try again.');
        }
    };

    // Get the authorized wallet address
    const walletAddress = baseUser?.id || userProfile?.wallet_address || userProfile?.base_wallet_address || '';

    const handleCopyWallet = async () => {
        if (!walletAddress) return;
        try {
            await navigator.clipboard.writeText(walletAddress);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    // Format wallet for display
    const formatWallet = (address: string) => {
        if (!address) return '—';
        if (address.length > 20) {
            return `${address.slice(0, 10)}...${address.slice(-8)}`;
        }
        return address;
    };

    // Only show loader during ACTIVE loading when profile has never been loaded
    // If profile was previously loaded but is temporarily null (e.g., during navigation/refresh),
    // use the last known profile state to avoid flickering
    //
    // IMPORTANT: We only show the loader when authLoading is TRUE.
    // If authLoading is false but profile is still null, it means the auth check
    // completed but the user profile couldn't be loaded - show the form anyway
    // so the user can see/edit their account info (even if empty).
    const showLoader = authLoading && !profileEverLoadedRef.current;

    if (showLoader) {
        return (
            <div className="py-20">
                <Loader />
            </div>
        );
    }

    return (
        <div>
            <Heading text='My Account' classes='text-white sequel-95' />
            <div className='bg-[#151515]  lg:py-14 lg:px-18 px-4 py-8 rounded-lg my-8 w-full'>
                <AccountAvatarSection />
                <div className='bg-[#DDE404] h-[2px] w-full sm:mt-14 mt-8'></div>

                {/* Authorized Wallet - Read Only */}
                <div className="mt-10 mb-4">
                    <label className="text-xl mb-2 sequel-75 text-[#E5EE00] block">
                        Authorized Wallet
                        <span className="text-white/50 text-sm ml-2">(read-only)</span>
                    </label>
                    <div className="flex items-center gap-3">
                        <div className="bg-[#fff]/10 text-white/70 sequel-45 rounded-sm px-3 py-3 flex-1 flex items-center justify-between border border-white/10">
                            <span className="font-mono">{formatWallet(walletAddress)}</span>
                            {walletAddress && (
                                <button
                                    onClick={handleCopyWallet}
                                    className="text-white/50 hover:text-white transition-colors p-1"
                                    title="Copy wallet address"
                                >
                                    {copied ? <Check size={18} className="text-green-400" /> : <Copy size={18} />}
                                </button>
                            )}
                        </div>
                    </div>
                    <p className="text-white/40 text-xs sequel-45 mt-1">
                        This wallet is linked to your account and cannot be changed
                    </p>
                </div>

                <ProfileForm isEditMode={isEditMode} setIsEditMode={setisEditMode} profile={profile} setProfile={handleProfileUpdate} />
                {
                    !isEditMode && <button type="button" onClick={() => setisEditMode(true)} className="bg-white uppercase sm:text-lg text-black  sequel-95 sm:w-auto w-full hover:bg-white/90 px-8 py-3 cursor-pointer rounded-lg">Edit user details</button>
                }

            </div>

            {/* Profile Update Success Modal with live competitions carousel */}
            <ProfileUpdateSuccessModal
                isOpen={showSuccessModal}
                onClose={() => setShowSuccessModal(false)}
                username={profile.username}
            />
        </div>
    );
}
