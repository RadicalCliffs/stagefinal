import { useState, useMemo } from 'react'
import { useAuthUser } from '../../../contexts/AuthContext'
import { userDataService } from '../../../services/userDataService'
import AvatarSelectionModal from '../AvatarSelectionModal'

const AccountAvatarSection = () => {
  const { profile } = useAuthUser();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const avatarUrl = useMemo(() => {
    // Use the avatar_url from profile (which should always be set from DB)
    if (profile?.avatar_url) return profile.avatar_url;
    // Fallback if somehow no avatar is set
    return userDataService.getDefaultAvatar();
  }, [profile?.avatar_url]);

  return (
    <>
      <div className="flex items-center lg:gap-10 gap-6">
          <img
            src={avatarUrl}
            alt="user-avatar"
            className="lg:w-38 sm:min-w-24 min-w-20 cursor-pointer hover:opacity-80 transition-opacity rounded-lg"
            crossOrigin="anonymous"
            referrerPolicy="no-referrer"
            onClick={() => setIsModalOpen(true)}
          />
          <div>
              <h1 className="sequel-95 lg:text-4xl md:text-3xl sm:text-2xl text-lg pr-2 text-white uppercase mb-2">Choose <br className="md:hidden block"/> Your Avatar</h1>
              <p className="sequel-45 sm:text-lg text-sm text-white">Select your avatar by clicking on the image</p>
          </div>
      </div>
      <AvatarSelectionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        currentAvatar={avatarUrl}
      />
    </>
  )
}

export default AccountAvatarSection