
import { useState, useEffect, useMemo } from 'react';
import { X, Check } from 'lucide-react';
import { userDataService } from '../../../services/userDataService';
import { useAvatar } from '../../../hooks/useAvatar';

interface AvatarSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentAvatar?: string;
}

const AvatarSelectionModal = ({ isOpen, onClose, currentAvatar }: AvatarSelectionModalProps) => {
  const { avatarUrl, loading, error, updateAvatar, isReady } = useAvatar();
  const [selectedAvatar, setSelectedAvatar] = useState<string>('');

  // Get all avatars - shuffle only once on first render, not on every modal open
  // This prevents the confusing behavior of avatars moving around each time the modal opens
  const avatars = useMemo(() => {
    const all = userDataService.getAllAvatars();
    // Shuffle for randomization only once when component mounts
    return [...all].sort(() => Math.random() - 0.5);
  }, []); // Empty dependency array - shuffle only once per component lifecycle

  // Initialize selected avatar when modal opens
  useEffect(() => {
    if (isOpen) {
      // Prefer the current avatar from the hook, fallback to prop
      const initialAvatar = avatarUrl || currentAvatar;
      if (initialAvatar) {
        setSelectedAvatar(initialAvatar);
      }
    }
  }, [isOpen, avatarUrl, currentAvatar]);

  const handleSelectAvatar = async (avatarUrl: string) => {
    setSelectedAvatar(avatarUrl);
  };

  const handleSaveAvatar = async () => {
    if (!isReady || !selectedAvatar) {
      console.warn('Cannot save avatar: user not ready or no avatar selected');
      return;
    }

    try {
      // CRITICAL FIX: Wait for avatar update to complete and check result
      const success = await updateAvatar(selectedAvatar);
      
      // Only close modal if update actually succeeded
      if (success) {
        onClose();
      } else {
        // Show error if update failed without throwing
        alert('Failed to update avatar. Please try again.');
      }
    } catch (error) {
      console.error('Error updating avatar:', error);
      alert(error instanceof Error ? error.message : 'Failed to update avatar. Please try again.');
      // Keep modal open so user can retry
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative bg-[#1A1A1A] rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden border-2 border-[#DDE404]">
        <div className="sticky top-0 bg-[#1A1A1A] z-10 px-6 py-4 border-b-2 border-[#DDE404] flex items-center justify-between">
          <h2 className="sequel-95 text-white text-xl uppercase">Choose Your Avatar</h2>
          <button
            onClick={onClose}
            className="text-white hover:text-[#DDE404] transition-colors"
          >
            <X size={28} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          {error && (
            <div className="mb-4 p-4 bg-red-500/10 border border-red-500 rounded-lg text-red-500">
              {error}
            </div>
          )}

          {/* All Avatars */}
          <div>
            <h3 className="sequel-75 text-white text-lg mb-4 uppercase">Select Your Avatar</h3>
            <div className="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-3">
              {avatars.map((avatar) => (
                <button
                  key={avatar.name}
                  onClick={() => handleSelectAvatar(avatar.url)}
                  className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all hover:scale-105 ${
                    selectedAvatar === avatar.url
                      ? 'border-[#DDE404] ring-2 ring-[#DDE404]'
                      : 'border-[#3A3A3A] hover:border-[#DDE404]/50'
                  }`}
                >
                  <img
                    src={avatar.url}
                    alt={avatar.name}
                    className="w-full h-full object-cover"
                    crossOrigin="anonymous"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                  {selectedAvatar === avatar.url && (
                    <div className="absolute inset-0 bg-[#DDE404]/20 flex items-center justify-center">
                      <div className="bg-[#DDE404] rounded-full p-1">
                        <Check size={20} className="text-black" />
                      </div>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-[#1A1A1A] px-6 py-4 border-t-2 border-[#DDE404] flex gap-4 justify-end">
          <button
            onClick={onClose}
            disabled={loading}
            className="sequel-75 px-6 py-3 bg-[#3A3A3A] text-white rounded-lg hover:bg-[#4A4A4A] transition-colors uppercase disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveAvatar}
            disabled={!selectedAvatar || loading || !isReady}
            className="sequel-75 px-6 py-3 bg-[#DDE404] text-black rounded-lg hover:bg-[#DDE404]/90 transition-colors uppercase disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Saving...' : 'Save Avatar'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AvatarSelectionModal;