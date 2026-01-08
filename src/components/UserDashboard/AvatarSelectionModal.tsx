import { useState, useEffect, useMemo } from 'react';
import { X, Check } from 'lucide-react';
import { userDataService } from '../../services/userDataService';
import { useAvatar } from '../../hooks/useAvatar';

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
      await updateAvatar(selectedAvatar);
      onClose();
    } catch (error) {
      console.error('Error updating avatar:', error);
      alert(error instanceof Error ? error.message : 'Failed to update avatar. Please try again.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative bg-[#1A1A1A] rounded-xl max-w-2xl w-full max-h-[85vh] overflow-hidden border-2 border-[#DDE404] shadow-2xl">
        <div className="sticky top-0 bg-[#1A1A1A] z-10 px-5 py-3 border-b border-[#DDE404]/30 flex items-center justify-between">
          <h2 className="sequel-75 text-white text-lg uppercase">Choose Avatar</h2>
          <button
            onClick={onClose}
            className="text-white hover:text-[#DDE404] transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto max-h-[calc(85vh-130px)]">
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500 rounded-lg text-red-500 text-sm">
              {error}
            </div>
          )}

          {/* All Avatars */}
          <div>
            <h3 className="sequel-75 text-white/80 text-sm mb-3 uppercase">Select Your Avatar</h3>
            <div className="grid grid-cols-5 sm:grid-cols-6 gap-3">
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
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                  {selectedAvatar === avatar.url && (
                    <div className="absolute inset-0 bg-[#DDE404]/20 flex items-center justify-center">
                      <div className="bg-[#DDE404] rounded-full p-1">
                        <Check size={16} className="text-black" />
                      </div>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-[#1A1A1A] px-5 py-3 border-t border-[#DDE404]/30 flex gap-3 justify-end">
          <button
            onClick={onClose}
            disabled={loading}
            className="sequel-75 px-5 py-2 bg-[#3A3A3A] text-white rounded-lg hover:bg-[#4A4A4A] transition-colors text-sm uppercase disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveAvatar}
            disabled={!selectedAvatar || loading || !isReady}
            className="sequel-75 px-5 py-2 bg-[#DDE404] text-black rounded-lg hover:bg-[#DDE404]/90 transition-colors text-sm uppercase disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Saving...' : 'Save Avatar'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AvatarSelectionModal;
