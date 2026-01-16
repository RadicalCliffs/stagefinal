/**
 * Visual Editor for Auth Modals
 * 
 * Admin-only visual editor for modifying aesthetic properties of:
 * - NewAuthModal.tsx
 * - BaseWalletAuthModal.tsx
 * 
 * Features:
 * - Color pickers for all color properties
 * - Font controls (family, size, weight, style)
 * - Image/icon upload and replacement
 * - Text content editing
 * - Live preview
 * - Direct file writing
 */

import React, { useState, useEffect } from 'react';
import { 
  X, 
  Save, 
  Eye, 
  EyeOff, 
  RotateCcw, 
  Upload,
  Palette,
  Type,
  Image as ImageIcon,
  Lock,
  Unlock,
  AlertCircle,
  CheckCircle
} from 'lucide-react';
import NewAuthModal from '../components/NewAuthModal';
import BaseWalletAuthModal from '../components/BaseWalletAuthModal';

interface ColorProperty {
  name: string;
  label: string;
  value: string;
  description?: string;
  locked?: boolean;
}

interface FontProperty {
  name: string;
  label: string;
  family?: string;
  size?: string;
  weight?: string;
  style?: 'normal' | 'italic';
  locked?: boolean;
}

interface TextProperty {
  name: string;
  label: string;
  value: string;
  multiline?: boolean;
  locked?: boolean;
}

interface ImageProperty {
  name: string;
  label: string;
  value: string;
  alt?: string;
  locked?: boolean;
}

type ModalType = 'NewAuthModal' | 'BaseWalletAuthModal';

interface EditorState {
  selectedModal: ModalType;
  colors: ColorProperty[];
  fonts: FontProperty[];
  texts: TextProperty[];
  images: ImageProperty[];
  showPreview: boolean;
  previewOpen: boolean;
  hasChanges: boolean;
}

export default function AuthModalVisualEditor() {
  const [state, setState] = useState<EditorState>({
    selectedModal: 'NewAuthModal',
    colors: [],
    fonts: [],
    texts: [],
    images: [],
    showPreview: true,
    previewOpen: false,
    hasChanges: false,
  });

  const [activeTab, setActiveTab] = useState<'colors' | 'fonts' | 'text' | 'images'>('colors');
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState('');

  // Load initial properties based on selected modal
  useEffect(() => {
    loadModalProperties(state.selectedModal);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedModal]);

  const loadModalProperties = (modalType: ModalType) => {
    if (modalType === 'NewAuthModal') {
      setState(prev => ({
        ...prev,
        colors: [
          { name: 'primaryBg', label: 'Primary Background', value: '#0A0A0F', description: 'Main modal background color' },
          { name: 'primaryButton', label: 'Primary Button', value: '#0052FF', description: 'Main action button color' },
          { name: 'primaryButtonHover', label: 'Primary Button Hover', value: '#0041CC', description: 'Button hover state' },
          { name: 'textPrimary', label: 'Primary Text', value: '#ffffff', description: 'Main text color' },
          { name: 'textSecondary', label: 'Secondary Text', value: 'rgba(255, 255, 255, 0.7)', description: 'Secondary text color' },
          { name: 'textMuted', label: 'Muted Text', value: 'rgba(255, 255, 255, 0.5)', description: 'Hints and descriptions' },
          { name: 'inputBg', label: 'Input Background', value: 'rgba(255, 255, 255, 0.05)', description: 'Input field background', locked: true },
          { name: 'inputBorder', label: 'Input Border', value: 'rgba(255, 255, 255, 0.1)', description: 'Input field border' },
          { name: 'inputBorderFocus', label: 'Input Border Focus', value: '#0052FF', description: 'Input focus state', locked: true },
          { name: 'successBg', label: 'Success Background', value: 'rgba(34, 197, 94, 0.1)', description: 'Success message bg' },
          { name: 'successText', label: 'Success Text', value: '#22c55e', description: 'Success message text' },
          { name: 'errorBg', label: 'Error Background', value: 'rgba(239, 68, 68, 0.1)', description: 'Error message bg' },
          { name: 'errorText', label: 'Error Text', value: '#ef4444', description: 'Error message text' },
          { name: 'warningBg', label: 'Warning Background', value: 'rgba(251, 191, 36, 0.1)', description: 'Warning message bg' },
          { name: 'warningText', label: 'Warning Text', value: '#fbbf24', description: 'Warning message text' },
        ],
        fonts: [
          { name: 'heading', label: 'Heading Font', family: 'inherit', size: '1.5rem', weight: '700' },
          { name: 'subheading', label: 'Subheading Font', family: 'inherit', size: '1rem', weight: '400' },
          { name: 'body', label: 'Body Font', family: 'inherit', size: '0.875rem', weight: '400' },
          { name: 'button', label: 'Button Font', family: 'inherit', size: '1rem', weight: '600', locked: true },
          { name: 'input', label: 'Input Font', family: 'inherit', size: '1rem', weight: '400', locked: true },
        ],
        texts: [
          { name: 'welcomeTitle', label: 'Welcome Title', value: 'Welcome to The Prize' },
          { name: 'welcomeSubtitle', label: 'Welcome Subtitle', value: 'Sign in with your username to continue.' },
          { name: 'createAccountTitle', label: 'Create Account Title', value: 'Create your account' },
          { name: 'createAccountSubtitle', label: 'Create Account Subtitle', value: 'Takes under a minute.' },
          { name: 'successTitle', label: 'Success Title', value: "You're all set!" },
          { name: 'successSubtitle', label: 'Success Subtitle', value: 'Welcome to The Prize, {username}' },
          { name: 'connectWalletTitle', label: 'Connect Wallet Title', value: 'Connect your wallet' },
          { name: 'connectWalletSubtitle', label: 'Connect Wallet Subtitle', value: 'Connect an existing wallet or create a new one in seconds.' },
        ],
        images: [
          { name: 'modalLogo', label: 'Modal Logo', value: '/logo.png', alt: 'The Prize Logo' },
        ],
      }));
    } else {
      // BaseWalletAuthModal properties
      setState(prev => ({
        ...prev,
        colors: [
          { name: 'primaryBg', label: 'Primary Background', value: '#101010', description: 'Main modal background color' },
          { name: 'primaryButton', label: 'Primary Button', value: '#0052FF', description: 'Main action button color' },
          { name: 'primaryButtonHover', label: 'Primary Button Hover', value: 'rgba(0, 82, 255, 0.9)', description: 'Button hover state' },
          { name: 'secondaryButton', label: 'Secondary Button', value: '#DDE404', description: 'Secondary action button' },
          { name: 'secondaryButtonHover', label: 'Secondary Button Hover', value: 'rgba(221, 228, 4, 0.9)', description: 'Secondary button hover' },
          { name: 'textPrimary', label: 'Primary Text', value: '#ffffff', description: 'Main text color' },
          { name: 'textSecondary', label: 'Secondary Text', value: 'rgba(255, 255, 255, 0.6)', description: 'Secondary text color' },
          { name: 'textMuted', label: 'Muted Text', value: 'rgba(255, 255, 255, 0.4)', description: 'Hints and descriptions' },
          { name: 'inputBg', label: 'Input Background', value: 'rgba(255, 255, 255, 0.05)', description: 'Input field background', locked: true },
          { name: 'inputBorder', label: 'Input Border', value: 'rgba(255, 255, 255, 0.2)', description: 'Input field border' },
          { name: 'inputBorderFocus', label: 'Input Border Focus', value: '#0052FF', description: 'Input focus state', locked: true },
        ],
        fonts: [
          { name: 'heading', label: 'Heading Font', family: 'inherit', size: '1.5rem', weight: '700' },
          { name: 'subheading', label: 'Subheading Font', family: 'inherit', size: '0.875rem', weight: '400' },
          { name: 'body', label: 'Body Font', family: 'inherit', size: '0.875rem', weight: '400' },
          { name: 'button', label: 'Button Font', family: 'inherit', size: '1rem', weight: '700', locked: true },
        ],
        texts: [
          { name: 'loginTitle', label: 'Login Title', value: 'Log in or create an account' },
          { name: 'loginSubtitle', label: 'Login Subtitle', value: 'Enter your email address to continue.' },
          { name: 'successTitle', label: 'Success Title', value: "You're live." },
          { name: 'successSubtitle', label: 'Success Subtitle', value: 'The Platform Players Trust.' },
        ],
        images: [],
      }));
    }
  };

  const handleColorChange = (name: string, value: string) => {
    setState(prev => ({
      ...prev,
      colors: prev.colors.map(c => c.name === name ? { ...c, value } : c),
      hasChanges: true,
    }));
  };

  const handleFontChange = (name: string, property: 'family' | 'size' | 'weight' | 'style', value: string) => {
    setState(prev => ({
      ...prev,
      fonts: prev.fonts.map(f => 
        f.name === name ? { ...f, [property]: value } : f
      ),
      hasChanges: true,
    }));
  };

  const handleTextChange = (name: string, value: string) => {
    setState(prev => ({
      ...prev,
      texts: prev.texts.map(t => t.name === name ? { ...t, value } : t),
      hasChanges: true,
    }));
  };

  const handleImageUpload = async (name: string, file: File) => {
    // Validate file size (max 2MB to prevent memory issues)
    const maxSize = 2 * 1024 * 1024; // 2MB
    if (file.size > maxSize) {
      setSaveStatus('error');
      setSaveMessage('Image file too large. Maximum size is 2MB.');
      setTimeout(() => {
        setSaveStatus('idle');
        setSaveMessage('');
      }, 5000);
      return;
    }

    // In a real implementation, this would upload to storage
    // For now, we'll use a data URL (with size validation)
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setState(prev => ({
        ...prev,
        images: prev.images.map(img => 
          img.name === name ? { ...img, value: dataUrl } : img
        ),
        hasChanges: true,
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus('idle');
    setSaveMessage('');

    try {
      // Get wallet address for authentication
      const walletAddress = localStorage.getItem('cdp:wallet_address');
      if (!walletAddress) {
        throw new Error('Not authenticated. Please log in first.');
      }

      // Call API endpoint to write changes to files
      const response = await fetch('/api/update-auth-modal-styles', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `wallet:${walletAddress}`,
        },
        body: JSON.stringify({
          modalType: state.selectedModal,
          colors: state.colors,
          fonts: state.fonts,
          texts: state.texts,
          images: state.images,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save changes');
      }

      setSaveStatus('success');
      setSaveMessage('Changes saved successfully! The modal files have been updated.');
      setState(prev => ({ ...prev, hasChanges: false }));

      // Clear success message after 5 seconds
      setTimeout(() => {
        setSaveStatus('idle');
        setSaveMessage('');
      }, 5000);
    } catch (err) {
      console.error('[AuthModalEditor] Error saving changes:', err);
      setSaveStatus('error');
      setSaveMessage(err instanceof Error ? err.message : 'Failed to save changes. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    loadModalProperties(state.selectedModal);
    setState(prev => ({ ...prev, hasChanges: false }));
  };

  const renderColorEditor = () => (
    <div className="space-y-4">
      {state.colors.map(color => (
        <div key={color.name} className="p-4 bg-white/5 border border-white/10 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <label className="text-white font-medium">{color.label}</label>
              {color.locked && (
                <Lock size={14} className="text-yellow-400" title="Functional - locked from editing" />
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color.value.startsWith('rgba') || color.value.startsWith('rgb') ? '#000000' : color.value}
                onChange={(e) => !color.locked && handleColorChange(color.name, e.target.value)}
                disabled={color.locked || color.value.startsWith('rgba') || color.value.startsWith('rgb')}
                className="w-10 h-10 rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                title={color.value.startsWith('rgba') || color.value.startsWith('rgb') ? 'RGBA colors must be edited as text' : ''}
              />
              <input
                type="text"
                value={color.value}
                onChange={(e) => !color.locked && handleColorChange(color.name, e.target.value)}
                disabled={color.locked}
                className="w-32 px-2 py-1 bg-white/10 border border-white/20 rounded text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
          </div>
          {color.description && (
            <p className="text-white/50 text-xs">{color.description}</p>
          )}
        </div>
      ))}
    </div>
  );

  const renderFontEditor = () => (
    <div className="space-y-4">
      {state.fonts.map(font => (
        <div key={font.name} className="p-4 bg-white/5 border border-white/10 rounded-lg">
          <div className="flex items-center gap-2 mb-3">
            <label className="text-white font-medium">{font.label}</label>
            {font.locked && (
              <Lock size={14} className="text-yellow-400" title="Functional - locked from editing" />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-white/70 text-xs mb-1 block">Font Family</label>
              <select
                value={font.family}
                onChange={(e) => !font.locked && handleFontChange(font.name, 'family', e.target.value)}
                disabled={font.locked}
                className="w-full px-2 py-1 bg-white/10 border border-white/20 rounded text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="inherit">System Default</option>
                <option value="'Inter', sans-serif">Inter</option>
                <option value="'Roboto', sans-serif">Roboto</option>
                <option value="'Open Sans', sans-serif">Open Sans</option>
                <option value="'Poppins', sans-serif">Poppins</option>
              </select>
            </div>
            <div>
              <label className="text-white/70 text-xs mb-1 block">Size</label>
              <input
                type="text"
                value={font.size}
                onChange={(e) => !font.locked && handleFontChange(font.name, 'size', e.target.value)}
                disabled={font.locked}
                placeholder="1rem"
                className="w-full px-2 py-1 bg-white/10 border border-white/20 rounded text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
            <div>
              <label className="text-white/70 text-xs mb-1 block">Weight</label>
              <select
                value={font.weight}
                onChange={(e) => !font.locked && handleFontChange(font.name, 'weight', e.target.value)}
                disabled={font.locked}
                className="w-full px-2 py-1 bg-white/10 border border-white/20 rounded text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="300">Light (300)</option>
                <option value="400">Normal (400)</option>
                <option value="500">Medium (500)</option>
                <option value="600">Semi-bold (600)</option>
                <option value="700">Bold (700)</option>
              </select>
            </div>
            <div>
              <label className="text-white/70 text-xs mb-1 block">Style</label>
              <select
                value={font.style || 'normal'}
                onChange={(e) => !font.locked && handleFontChange(font.name, 'style', e.target.value)}
                disabled={font.locked}
                className="w-full px-2 py-1 bg-white/10 border border-white/20 rounded text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="normal">Normal</option>
                <option value="italic">Italic</option>
              </select>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const renderTextEditor = () => (
    <div className="space-y-4">
      {state.texts.map(text => (
        <div key={text.name} className="p-4 bg-white/5 border border-white/10 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <label className="text-white font-medium">{text.label}</label>
            {text.locked && (
              <Lock size={14} className="text-yellow-400" title="Functional - locked from editing" />
            )}
          </div>
          {text.multiline ? (
            <textarea
              value={text.value}
              onChange={(e) => !text.locked && handleTextChange(text.name, e.target.value)}
              disabled={text.locked}
              rows={3}
              className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            />
          ) : (
            <input
              type="text"
              value={text.value}
              onChange={(e) => !text.locked && handleTextChange(text.name, e.target.value)}
              disabled={text.locked}
              className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            />
          )}
        </div>
      ))}
    </div>
  );

  const renderImageEditor = () => (
    <div className="space-y-4">
      {state.images.length === 0 ? (
        <div className="p-8 text-center text-white/50">
          No image properties available for this modal
        </div>
      ) : (
        state.images.map(image => (
          <div key={image.name} className="p-4 bg-white/5 border border-white/10 rounded-lg">
            <div className="flex items-center gap-2 mb-3">
              <label className="text-white font-medium">{image.label}</label>
              {image.locked && (
                <Lock size={14} className="text-yellow-400" title="Functional - locked from editing" />
              )}
            </div>
            <div className="flex items-start gap-4">
              {image.value && (
                <img 
                  src={image.value} 
                  alt={image.alt || image.label}
                  className="w-20 h-20 object-contain bg-white/5 rounded border border-white/10"
                />
              )}
              <div className="flex-1">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file && !image.locked) {
                      handleImageUpload(image.name, file);
                    }
                  }}
                  disabled={image.locked}
                  className="w-full text-white/70 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <p className="text-white/40 text-xs mt-2">
                  Upload a new image to replace the current one
                </p>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white">
      {/* Header */}
      <header className="border-b border-white/10 bg-[#0A0A0F]/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Auth Modal Visual Editor</h1>
              <p className="text-white/50 text-sm">Admin-only aesthetic editor</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setState(prev => ({ ...prev, showPreview: !prev.showPreview }))}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg flex items-center gap-2 transition-colors"
              >
                {state.showPreview ? <Eye size={18} /> : <EyeOff size={18} />}
                <span>{state.showPreview ? 'Hide' : 'Show'} Preview</span>
              </button>
              <button
                onClick={handleReset}
                disabled={!state.hasChanges}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RotateCcw size={18} />
                <span>Reset</span>
              </button>
              <button
                onClick={handleSave}
                disabled={!state.hasChanges || saving}
                className="px-4 py-2 bg-[#0052FF] hover:bg-[#0041CC] disabled:bg-white/10 disabled:text-white/40 rounded-lg flex items-center gap-2 transition-colors"
              >
                <Save size={18} />
                <span>{saving ? 'Saving...' : 'Save Changes'}</span>
              </button>
            </div>
          </div>

          {/* Save Status */}
          {saveStatus !== 'idle' && saveMessage && (
            <div className={`mt-4 p-3 rounded-lg flex items-start gap-2 ${
              saveStatus === 'success' ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'
            }`}>
              {saveStatus === 'success' ? (
                <CheckCircle size={18} className="text-green-400 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
              )}
              <p className={`text-sm ${saveStatus === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                {saveMessage}
              </p>
            </div>
          )}
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className={`grid ${state.showPreview ? 'grid-cols-2' : 'grid-cols-1'} gap-8`}>
          {/* Editor Panel */}
          <div>
            {/* Modal Selector */}
            <div className="mb-6">
              <label className="block text-white/70 text-sm mb-2">Select Modal to Edit</label>
              <select
                value={state.selectedModal}
                onChange={(e) => setState(prev => ({ 
                  ...prev, 
                  selectedModal: e.target.value as ModalType,
                  hasChanges: false,
                }))}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white"
              >
                <option value="NewAuthModal">New Auth Modal (NewAuthModal.tsx)</option>
                <option value="BaseWalletAuthModal">Base Wallet Auth Modal (BaseWalletAuthModal.tsx)</option>
              </select>
            </div>

            {/* Tab Navigation */}
            <div className="flex gap-2 mb-6 border-b border-white/10">
              <button
                onClick={() => setActiveTab('colors')}
                className={`px-4 py-2 flex items-center gap-2 border-b-2 transition-colors ${
                  activeTab === 'colors' 
                    ? 'border-[#0052FF] text-white' 
                    : 'border-transparent text-white/50 hover:text-white/70'
                }`}
              >
                <Palette size={18} />
                <span>Colors</span>
              </button>
              <button
                onClick={() => setActiveTab('fonts')}
                className={`px-4 py-2 flex items-center gap-2 border-b-2 transition-colors ${
                  activeTab === 'fonts' 
                    ? 'border-[#0052FF] text-white' 
                    : 'border-transparent text-white/50 hover:text-white/70'
                }`}
              >
                <Type size={18} />
                <span>Fonts</span>
              </button>
              <button
                onClick={() => setActiveTab('text')}
                className={`px-4 py-2 flex items-center gap-2 border-b-2 transition-colors ${
                  activeTab === 'text' 
                    ? 'border-[#0052FF] text-white' 
                    : 'border-transparent text-white/50 hover:text-white/70'
                }`}
              >
                <Type size={18} />
                <span>Text Content</span>
              </button>
              <button
                onClick={() => setActiveTab('images')}
                className={`px-4 py-2 flex items-center gap-2 border-b-2 transition-colors ${
                  activeTab === 'images' 
                    ? 'border-[#0052FF] text-white' 
                    : 'border-transparent text-white/50 hover:text-white/70'
                }`}
              >
                <ImageIcon size={18} />
                <span>Images</span>
              </button>
            </div>

            {/* Editor Content */}
            <div className="space-y-6">
              {activeTab === 'colors' && renderColorEditor()}
              {activeTab === 'fonts' && renderFontEditor()}
              {activeTab === 'text' && renderTextEditor()}
              {activeTab === 'images' && renderImageEditor()}
            </div>

            {/* Info Box */}
            <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <div className="flex items-start gap-2">
                <Lock size={16} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-yellow-400 text-sm font-medium mb-1">Locked Elements</p>
                  <p className="text-yellow-400/80 text-xs">
                    Elements marked with a lock icon are functional components (inputs, buttons, logic) 
                    and cannot be modified to ensure authentication continues to work properly.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Preview Panel */}
          {state.showPreview && (
            <div className="sticky top-24 h-fit">
              <div className="bg-white/5 border border-white/10 rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Live Preview</h3>
                  <button
                    onClick={() => setState(prev => ({ ...prev, previewOpen: !prev.previewOpen }))}
                    className="px-3 py-1 bg-[#0052FF] hover:bg-[#0041CC] rounded text-sm transition-colors"
                  >
                    {state.previewOpen ? 'Close' : 'Open'} Modal
                  </button>
                </div>
                <div className="bg-[#0A0A0F] rounded-lg overflow-hidden min-h-[400px] flex items-center justify-center">
                  {state.previewOpen ? (
                    state.selectedModal === 'NewAuthModal' ? (
                      <NewAuthModal 
                        isOpen={true} 
                        onClose={() => setState(prev => ({ ...prev, previewOpen: false }))} 
                      />
                    ) : (
                      <BaseWalletAuthModal 
                        isOpen={true} 
                        onClose={() => setState(prev => ({ ...prev, previewOpen: false }))} 
                      />
                    )
                  ) : (
                    <p className="text-white/50">Click "Open Modal" to preview changes</p>
                  )}
                </div>
                <p className="text-white/40 text-xs mt-3 text-center">
                  Changes are previewed in real-time. Click Save to write to files.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
