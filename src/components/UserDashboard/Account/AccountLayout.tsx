import { useState, useEffect, useRef } from 'react';
import Heading from '../../Heading';
import AccountAvatarSection from './AccountAvatarSection';
import ProfileForm from './UserAccountForm';
import type { ProfileFormData } from '../../../models/models';
import { userDataService } from '../../../services/userDataService';
import { useAuthUser } from '../../../contexts/AuthContext';
import Loader from '../../Loader';

export default function Account() {
    const { profile: userProfile, isLoading: authLoading, refreshUserData, baseUser } = useAuthUser();
    const [isEditMode, setisEditMode] = useState<boolean>(false);
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
                alert('Profile updated successfully!');
            } else {
                alert('Failed to update profile. Please try again.');
            }
        } catch (error) {
            console.error('Failed to update profile:', error);
            alert('An error occurred. Please try again.');
        }
    };

    // Only show loader on INITIAL load when profile has never been loaded
    // If profile was previously loaded but is temporarily null (e.g., during navigation/refresh),
    // use the last known profile state to avoid flickering
    const showLoader = authLoading && !profileEverLoadedRef.current;
    const hasValidProfileState = userProfile || (profileEverLoadedRef.current && profile.username !== "");

    if (showLoader || (!hasValidProfileState && !profileEverLoadedRef.current)) {
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
                <ProfileForm isEditMode={isEditMode} setIsEditMode={setisEditMode} profile={profile} setProfile={handleProfileUpdate} />
                {
                    !isEditMode && <button type="button" onClick={() => setisEditMode(true)} className="bg-white uppercase sm:text-lg text-black  sequel-95 sm:w-auto w-full hover:bg-white/90 px-8 py-3 cursor-pointer rounded-lg">Edit user details</button>
                }

            </div>
        </div>
    );
}
