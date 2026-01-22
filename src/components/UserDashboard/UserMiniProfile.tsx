import { CopyIcon, CheckIcon, Edit } from 'lucide-react'
import { useState, useMemo } from 'react'
import { useAuthUser } from '../../contexts/AuthContext'
import { userDataService } from '../../services/userDataService'
import AvatarSelectionModal from './AvatarSelectionModal'

const UserMiniProfile = () => {
  const { profile, isLoading } = useAuthUser();
  const [copiedWallet, setCopiedWallet] = useState(false);
  const [copiedPid, setCopiedPid] = useState(false);
  const [showAvatarModal, setShowAvatarModal] = useState(false);

  const avatarUrl = useMemo(() => {
    // Always use the avatar_url from profile if available
    // Profile should already have avatar_url set from database on user creation
    if (profile?.avatar_url) {
      // Cache the avatar URL when we have it from the profile
      userDataService.cacheAvatarUrl(profile.avatar_url);
      return profile.avatar_url;
    }
    // Use cached avatar as fallback to prevent visual swapping during navigation
    // This prevents the jarring experience of seeing the default avatar briefly
    // while the profile is reloading after page transitions
    const cachedAvatar = userDataService.getCachedAvatarUrl();
    if (cachedAvatar) return cachedAvatar;
    // Final fallback: use a consistent default avatar (this should rarely be needed)
    return userDataService.getDefaultAvatar();
  }, [profile?.avatar_url]);

  const copyToClipboard = async (text: string, type: 'wallet' | 'pid') => {
    const setCopied = type === 'wallet' ? setCopiedWallet : setCopiedPid;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Fallback for Safari/older browsers where clipboard API may fail
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (fallbackErr) {
        console.error('Copy failed:', fallbackErr);
      }
    }
  };

  const handleCopyWallet = () => {
    if (profile?.wallet_address) {
      copyToClipboard(profile.wallet_address, 'wallet');
    }
  };

  const handleCopyPid = () => {
    if (profile?.canonical_user_id) {
      copyToClipboard(profile.canonical_user_id, 'pid');
    }
  };

  if (isLoading) {
    return (
      <div className='flex items-center gap-4 sm:gap-5 animate-pulse'>
        <div className='w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 rounded-lg bg-[#3A3A3A] flex-shrink-0' />
        <div className='flex-1 min-w-0'>
          <div className='h-5 bg-[#3A3A3A] rounded w-28 sm:w-36 mb-2' />
          <div className='h-4 bg-[#3A3A3A] rounded w-36 sm:w-52' />
        </div>
      </div>
    );
  }

  if (!profile) return null;

  // Priority: 1) Username, 2) Email, 3) Anonymous User
  const displayName = profile.username || profile.email || 'Anonymous User';
  const walletAddress = profile.wallet_address || '';
  const canonicalUserId = profile.canonical_user_id || '';

  // Format PID for display - show truncated version
  const formatPid = (pid: string) => {
    if (!pid) return '';
    // prize:pid:0x... format - show prefix + truncated ID
    if (pid.startsWith('prize:pid:')) {
      const idPart = pid.substring('prize:pid:'.length);
      if (idPart.length > 12) {
        return `prize:pid:${idPart.slice(0, 6)}...${idPart.slice(-4)}`;
      }
      return pid;
    }
    return pid;
  };

  return (
    <>
      <div className='flex items-center gap-4 sm:gap-5'>
          <div className='relative group flex-shrink-0'>
            <img
              src={avatarUrl}
              alt="user-avatar"
              className='w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 rounded-lg cursor-pointer transition-all hover:ring-2 hover:ring-[#DDE404] object-cover'
              crossOrigin="anonymous"
              referrerPolicy="no-referrer"
              onClick={() => setShowAvatarModal(true)}
            />
            <div className='absolute inset-0 bg-black/50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer' onClick={() => setShowAvatarModal(true)}>
              <Edit size={20} className='text-[#DDE404] sm:w-6 sm:h-6' />
            </div>
          </div>
          <div className='flex-1 min-w-0'>
              <p className='text-white sequel-75 text-base sm:text-lg md:text-xl truncate mb-1'>
                {displayName}
              </p>
              {/* Prize ID (canonical user identifier) - Always show for all users */}
              {canonicalUserId && (
                <div className='flex items-center gap-2 sequel-45 text-[#DDE404] py-1'>
                    <div className='min-w-0 flex-1'>
                      <span className='text-[10px] sm:text-xs text-white/60'>Prize ID</span>
                      <p className='text-[10px] sm:text-xs truncate'>
                        {formatPid(canonicalUserId)}
                      </p>
                    </div>
                    <button onClick={handleCopyPid} className='flex-shrink-0 p-0.5' title='Copy Prize ID'>
                      {copiedPid ? (
                        <CheckIcon size={14} className='cursor-pointer text-[#DDE404]' />
                      ) : (
                        <CopyIcon size={14} className='cursor-pointer' />
                      )}
                    </button>
                </div>
              )}
              {/* Wallet Address */}
              {walletAddress && (
                <div className='flex items-center gap-2 sequel-45 text-white/70 py-1'>
                    <div className='min-w-0 flex-1'>
                      <span className='text-[10px] sm:text-xs text-white/60'>Wallet</span>
                      <p className='text-[10px] sm:text-xs truncate'>
                        {walletAddress.slice(0, 8)}...{walletAddress.slice(-4)}
                      </p>
                    </div>
                    <button onClick={handleCopyWallet} className='flex-shrink-0 p-0.5' title='Copy Wallet Address'>
                      {copiedWallet ? (
                        <CheckIcon size={14} className='cursor-pointer text-[#DDE404]' />
                      ) : (
                        <CopyIcon size={14} className='cursor-pointer text-white/60' />
                      )}
                    </button>
                </div>
              )}
          </div>
      </div>

      <AvatarSelectionModal
        isOpen={showAvatarModal}
        onClose={() => setShowAvatarModal(false)}
        currentAvatar={avatarUrl}
      />
    </>
  )
}

export default UserMiniProfile