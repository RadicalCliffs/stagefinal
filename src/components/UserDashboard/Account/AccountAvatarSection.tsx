import { useState, useMemo } from 'react'
import { useAuthUser } from '../../../contexts/AuthContext'
import { userDataService } from '../../../services/userDataService'
import AvatarSelectionModal from '../AvatarSelectionModal'
import { Edit, Sparkles } from 'lucide-react'

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
          <div className="relative group">
            <img
              src={avatarUrl}
              alt="user-avatar"
              className="lg:w-38 sm:min-w-24 min-w-20 cursor-pointer hover:opacity-80 transition-all rounded-lg border-2 border-[#DDE404]/20 group-hover:border-[#DDE404] group-hover:shadow-lg group-hover:shadow-[#DDE404]/30"
              crossOrigin="anonymous"
              referrerPolicy="no-referrer"
              onClick={() => setIsModalOpen(true)}
            />
            {/* Edit overlay on hover */}
            <div 
              className="absolute inset-0 bg-black/60 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer" 
              onClick={() => setIsModalOpen(true)}
              role="button"
              tabIndex={0}
              aria-label="Edit avatar"
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setIsModalOpen(true);
                }
              }}
            >
              <div className="flex flex-col items-center gap-1">
                <Edit className="text-[#DDE404]" size={28} />
                <span className="text-[#DDE404] sequel-75 text-xs uppercase">Edit</span>
              </div>
            </div>
          </div>
          <div>
              <h1 className="sequel-95 lg:text-4xl md:text-3xl sm:text-2xl text-lg pr-2 text-white uppercase mb-2 flex items-center gap-2">
                Choose <br className="md:hidden block"/> Your Avatar
                <Sparkles className="text-[#DDE404] hidden md:inline" size={28} />
              </h1>
              <p className="sequel-45 sm:text-lg text-sm text-white/80 mb-3">Select your avatar by clicking on the image</p>
              <button
                onClick={() => setIsModalOpen(true)}
                className="bg-[#DDE404] hover:bg-[#DDE404]/90 text-black sequel-75 uppercase px-4 py-2 rounded-lg transition-all hover:scale-105 active:scale-95 text-sm flex items-center gap-2 shadow-lg shadow-[#DDE404]/30"
              >
                <Edit size={16} />
                Edit Avatar
              </button>
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