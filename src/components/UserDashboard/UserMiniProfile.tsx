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
      <div className='flex items-center gap-3 animate-pulse'>
        <div className='sm:w-20 sm:h-20 w-16 h-16 rounded-full bg-[#3A3A3A]' />
        <div className='w-full'>
          <div className='h-4 bg-[#3A3A3A] rounded w-32 mb-2' />
          <div className='h-3 bg-[#3A3A3A] rounded w-48' />
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
      if (idPart.length > 16) {
        return `prize:pid:${idPart.slice(0, 8)}...${idPart.slice(-4)}`;
      }
      return pid;
    }
    return pid;
  };

  return (
    <>
      <div className='flex items-center gap-3'>
          <div className='relative group'>
            <img
              src={avatarUrl}
              alt="user-avatar"
              className='sm:min-w-20 min-w-16 sm:w-20 sm:h-20 w-16 h-16 max-[420px]:w-12 max-[420px]:h-12 max-[420px]:min-w-12 rounded-full cursor-pointer transition-all hover:ring-2 hover:ring-[#DDE404]'
              onClick={() => setShowAvatarModal(true)}
            />
            <div className='absolute inset-0 bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer' onClick={() => setShowAvatarModal(true)}>
              <Edit size={24} className='text-[#DDE404]' />
            </div>
          </div>
          <div className='w-full sm:mt-0 mt-2'>
              <p className='text-white sequel-75 sm:text-base text-sm'>
                {displayName}
              </p>
              {/* Prize ID (canonical user identifier) - Always show for all users */}
              {canonicalUserId && (
                <div className='flex justify-between sequel-45 text-[#DDE404] items-end border-t-[3px] my-2 border-[#DDE404]'>
                    <div className='mt-2'>
                      <span className='text-xs text-white/60 block'>Prize ID</span>
                      <p className='sm:text-sm text-xs truncate pr-2 max-[400px]:pr-0'>
                        {formatPid(canonicalUserId)}
                      </p>
                    </div>
                    <button onClick={handleCopyPid} className='flex-shrink-0' title='Copy Prize ID'>
                      {copiedPid ? (
                        <CheckIcon size={18} className='cursor-pointer xl:ml-0 ml-3 mt-2 text-[#DDE404]' />
                      ) : (
                        <CopyIcon size={18} className='cursor-pointer xl:ml-0 ml-3 mt-2' />
                      )}
                    </button>
                </div>
              )}
              {/* Wallet Address */}
              {walletAddress && (
                <div className='flex justify-between sequel-45 text-white items-end border-t-[3px] my-1 border-white/30'>
                    <div className='mt-2'>
                      <span className='text-xs text-white/60 block'>Wallet</span>
                      <p className='sm:text-sm text-xs truncate pr-2 max-[400px]:pr-0'>
                        {walletAddress.slice(0, 10)}...{walletAddress.slice(-4)}
                      </p>
                    </div>
                    <button onClick={handleCopyWallet} className='flex-shrink-0' title='Copy Wallet Address'>
                      {copiedWallet ? (
                        <CheckIcon size={18} className='cursor-pointer xl:ml-0 ml-3 mt-2 text-[#DDE404]' />
                      ) : (
                        <CopyIcon size={18} className='cursor-pointer xl:ml-0 ml-3 mt-2 text-white/60' />
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