/**
 * Visual Editor for Modals
 * 
 * Admin-only visual editor for modifying aesthetic properties of:
 * - NewAuthModal.tsx
 * - BaseWalletAuthModal.tsx
 * - PaymentModal.tsx
 * - TopUpWalletModal.tsx
 * 
 * Features:
 * - Color pickers for all color properties
 * - Font controls (family, size, weight, style)
 * - Image/icon upload and replacement
 * - Text content editing
 * - Button linking with dependency warnings
 * - Live preview
 * - File download for developers (not GitHub write)
 */

import React, { useState, useEffect } from 'react';
import { 
  Eye, 
  EyeOff, 
  RotateCcw, 
  Palette,
  Type,
  Image as ImageIcon,
  Lock,
  AlertCircle,
  CheckCircle,
  ArrowRight,
  Download,
  Link as LinkIcon,
  ExternalLink
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
  type?: 'logo' | 'icon' | 'wallet_icon' | 'payment_icon' | 'background' | 'other'; // New: Icon type categorization
  format?: 'svg' | 'png' | 'webp' | 'jpg' | 'any'; // New: Preferred format
  dimensions?: { width: number; height: number }; // New: Recommended dimensions
  acceptFormats?: string; // New: Accept attribute for file input
}

interface FlowStep {
  id: string;
  name: string;
  label: string;
  required: boolean;
  description: string;
  locked?: boolean;
  order: number;
}

interface ButtonProperty {
  name: string;
  label: string;
  linkType: 'none' | 'url' | 'route' | 'action';
  linkValue: string;
  description?: string;
  hasDependencies?: boolean;
  dependencies?: string[];
  locked?: boolean;
  hidden?: boolean; // New: Controls visibility of button in the modal
  icon?: string; // New: Icon/image URL for the button
}

type ModalType = 'NewAuthModal' | 'BaseWalletAuthModal' | 'PaymentModal' | 'TopUpWalletModal';

interface EditorState {
  selectedModal: ModalType;
  colors: ColorProperty[];
  fonts: FontProperty[];
  texts: TextProperty[];
  images: ImageProperty[];
  flowSteps: FlowStep[];
  buttons: ButtonProperty[];
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
    flowSteps: [],
    buttons: [],
    showPreview: true,
    previewOpen: false,
    hasChanges: false,
  });

  const [activeTab, setActiveTab] = useState<'flow' | 'colors' | 'fonts' | 'text' | 'images' | 'buttons'>('flow');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const [showAddButton, setShowAddButton] = useState(false);
  const [newButton, setNewButton] = useState<Partial<ButtonProperty>>({
    name: '',
    label: '',
    linkType: 'none',
    linkValue: '',
    description: '',
    hasDependencies: false,
    dependencies: [],
    locked: false,
    hidden: false,
    icon: '',
  });

  // Load initial properties based on selected modal
  useEffect(() => {
    loadModalProperties(state.selectedModal);
  }, [state.selectedModal]);

  const loadModalProperties = (modalType: ModalType) => {
    if (modalType === 'NewAuthModal') {
      setState(prev => ({
        ...prev,
        flowSteps: [
          { id: 'username', name: 'username', label: 'Username Entry', required: true, description: 'Enter or create username', order: 1, locked: false },
          { id: 'profile', name: 'profile', label: 'Profile Completion', required: true, description: 'Complete profile (email, name, country)', order: 2, locked: false },
          { id: 'email-otp', name: 'email-otp', label: 'Email OTP Verification', required: true, description: 'Email verification with OTP code', order: 3, locked: true },
          { id: 'wallet', name: 'wallet', label: 'Wallet Connection', required: true, description: 'Connect Base wallet', order: 4, locked: false },
          { id: 'success', name: 'success', label: 'Success Confirmation', required: true, description: 'Success message and redirect', order: 5, locked: true },
        ],
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
          { name: 'modalLogo', label: 'Modal Logo', value: '/logo.png', alt: 'The Prize Logo', type: 'logo', format: 'png', acceptFormats: 'image/png,image/svg+xml,image/webp' },
        ],
        buttons: [],
      }));
    } else if (modalType === 'BaseWalletAuthModal') {
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
        flowSteps: [
          { id: 'cdp-signin', name: 'cdp-signin', label: 'Email Sign-In', required: true, description: 'Email authentication with CDP', order: 1, locked: false },
          { id: 'profile-completion', name: 'profile-completion', label: 'Profile Completion', required: false, description: 'Complete profile information', order: 2, locked: false },
          { id: 'wallet-choice', name: 'wallet-choice', label: 'Wallet Selection', required: true, description: 'Choose wallet connection method', order: 3, locked: false },
          { id: 'logged-in-success', name: 'logged-in-success', label: 'Success Screen', required: true, description: 'Success confirmation', order: 4, locked: true },
        ],
        texts: [
          { name: 'loginTitle', label: 'Login Title', value: 'Log in or create an account' },
          { name: 'loginSubtitle', label: 'Login Subtitle', value: 'Enter your email address to continue.' },
          { name: 'successTitle', label: 'Success Title', value: "You're live." },
          { name: 'successSubtitle', label: 'Success Subtitle', value: 'The Platform Players Trust.' },
        ],
        images: [],
        buttons: [],
      }));
    } else if (modalType === 'PaymentModal') {
      // PaymentModal properties
      setState(prev => ({
        ...prev,
        colors: [
          { name: 'modalBg', label: 'Modal Background', value: '#0A0A0F', description: 'Main modal background' },
          { name: 'primaryButton', label: 'Primary Button', value: '#0052FF', description: 'Main action button color' },
          { name: 'primaryButtonHover', label: 'Primary Button Hover', value: '#0041CC', description: 'Button hover state' },
          { name: 'secondaryButton', label: 'Secondary Button', value: '#DDE404', description: 'Secondary action button' },
          { name: 'balanceButton', label: 'Balance Button', value: '#10B981', description: 'Pay with balance button' },
          { name: 'textPrimary', label: 'Primary Text', value: '#ffffff', description: 'Main text color' },
          { name: 'textSecondary', label: 'Secondary Text', value: 'rgba(255, 255, 255, 0.7)', description: 'Secondary text color' },
          { name: 'successBg', label: 'Success Background', value: 'rgba(34, 197, 94, 0.1)', description: 'Success message background' },
          { name: 'successText', label: 'Success Text', value: '#22c55e', description: 'Success message text' },
          { name: 'errorBg', label: 'Error Background', value: 'rgba(239, 68, 68, 0.1)', description: 'Error message background' },
          { name: 'errorText', label: 'Error Text', value: '#ef4444', description: 'Error message text' },
        ],
        fonts: [
          { name: 'heading', label: 'Heading Font', family: 'inherit', size: '1.5rem', weight: '700' },
          { name: 'subheading', label: 'Subheading Font', family: 'inherit', size: '1rem', weight: '600' },
          { name: 'body', label: 'Body Font', family: 'inherit', size: '0.875rem', weight: '400' },
          { name: 'price', label: 'Price Font', family: 'inherit', size: '2rem', weight: '700' },
        ],
        texts: [
          { name: 'modalTitle', label: 'Modal Title', value: 'Complete Your Purchase' },
          { name: 'modalSubtitle', label: 'Modal Subtitle', value: 'Choose your payment method' },
          { name: 'balanceLabel', label: 'Balance Label', value: 'Your Balance' },
          { name: 'totalLabel', label: 'Total Label', value: 'Total' },
          { name: 'confirmButtonText', label: 'Confirm Button Text', value: 'Confirm Payment' },
          { name: 'successMessage', label: 'Success Message', value: 'Payment successful! Your tickets are confirmed.' },
        ],
        images: [],
        flowSteps: [],
        buttons: [
          { name: 'payWithBalance', label: 'Pay with Balance Button', linkType: 'action', linkValue: 'balancePayment', description: 'Triggers balance payment', hasDependencies: true, dependencies: ['Balance check', 'Transaction API'], locked: false, hidden: false },
          { name: 'payWithCard', label: 'Pay with Card Button', linkType: 'action', linkValue: 'cardPayment', description: 'Triggers card payment flow', hasDependencies: true, dependencies: ['Coinbase Commerce API'], locked: false, hidden: false },
          { name: 'payWithCrypto', label: 'Pay with Crypto Button', linkType: 'action', linkValue: 'cryptoPayment', description: 'Triggers crypto payment flow', hasDependencies: true, dependencies: ['OnchainKit', 'Wallet connection'], locked: false, hidden: false },
          { name: 'topUpBalance', label: 'Top Up Balance Link', linkType: 'action', linkValue: 'openTopUpModal', description: 'Opens top-up modal', hasDependencies: true, dependencies: ['TopUpWalletModal component'], locked: false, hidden: false },
        ],
      }));
    } else if (modalType === 'TopUpWalletModal') {
      // TopUpWalletModal properties
      setState(prev => ({
        ...prev,
        colors: [
          { name: 'modalBg', label: 'Modal Background', value: '#0A0A0F', description: 'Main modal background' },
          { name: 'primaryButton', label: 'Primary Button', value: '#0052FF', description: 'Main action button color' },
          { name: 'primaryButtonHover', label: 'Primary Button Hover', value: '#0041CC', description: 'Button hover state' },
          { name: 'secondaryButton', label: 'Secondary Button', value: 'rgba(255, 255, 255, 0.1)', description: 'Secondary action button' },
          { name: 'accentGreen', label: 'Accent Green', value: '#10B981', description: 'Instant top-up accent' },
          { name: 'accentBlue', label: 'Accent Blue', value: '#3B82F6', description: 'Crypto accent' },
          { name: 'textPrimary', label: 'Primary Text', value: '#ffffff', description: 'Main text color' },
          { name: 'textSecondary', label: 'Secondary Text', value: 'rgba(255, 255, 255, 0.7)', description: 'Secondary text color' },
          { name: 'successBg', label: 'Success Background', value: 'rgba(34, 197, 94, 0.1)', description: 'Success message background' },
          { name: 'successText', label: 'Success Text', value: '#22c55e', description: 'Success message text' },
        ],
        fonts: [
          { name: 'heading', label: 'Heading Font', family: 'inherit', size: '1.5rem', weight: '700' },
          { name: 'subheading', label: 'Subheading Font', family: 'inherit', size: '1rem', weight: '600' },
          { name: 'body', label: 'Body Font', family: 'inherit', size: '0.875rem', weight: '400' },
          { name: 'amount', label: 'Amount Font', family: 'inherit', size: '2rem', weight: '700' },
        ],
        texts: [
          { name: 'modalTitle', label: 'Modal Title', value: 'Top Up Your Balance' },
          { name: 'modalSubtitle', label: 'Modal Subtitle', value: 'Add funds to your account' },
          { name: 'methodSelectionTitle', label: 'Method Selection Title', value: 'Choose payment method' },
          { name: 'instantTopUpLabel', label: 'Instant Top Up Label', value: 'Instant Top-Up' },
          { name: 'instantTopUpDesc', label: 'Instant Top Up Description', value: 'Transfer USDC directly from your wallet' },
          { name: 'cryptoTopUpLabel', label: 'Crypto Top Up Label', value: 'Pay with Crypto' },
          { name: 'cryptoTopUpDesc', label: 'Crypto Top Up Description', value: 'Pay with Bitcoin, Ethereum, and 60+ cryptocurrencies' },
          { name: 'successMessage', label: 'Success Message', value: 'Top-up successful! Your balance has been updated.' },
        ],
        images: [],
        flowSteps: [],
        buttons: [
          { name: 'instantTopUp', label: 'Instant Top-Up Button', linkType: 'action', linkValue: 'instantTopUp', description: 'Direct USDC transfer', hasDependencies: true, dependencies: ['Wallet connection', 'USDC balance', 'Treasury address'], locked: false, hidden: false },
          { name: 'cryptoTopUp', label: 'Crypto Top-Up Button', linkType: 'action', linkValue: 'cryptoCheckout', description: 'Opens OnchainKit checkout', hasDependencies: true, dependencies: ['OnchainKit', 'Coinbase Commerce'], locked: false, hidden: false },
          { name: 'cardTopUp', label: 'Card Top-Up Button', linkType: 'action', linkValue: 'cardCheckout', description: 'Opens card payment flow', hasDependencies: true, dependencies: ['Coinbase Commerce API'], locked: false, hidden: false },
        ],
      }));
    }
  };

  const handleFlowStepReorder = (fromIndex: number, toIndex: number) => {
    setState(prev => {
      const newSteps = [...prev.flowSteps];
      const [movedStep] = newSteps.splice(fromIndex, 1);
      newSteps.splice(toIndex, 0, movedStep);
      
      // Update order numbers
      const reorderedSteps = newSteps.map((step, index) => ({
        ...step,
        order: index + 1,
      }));
      
      return {
        ...prev,
        flowSteps: reorderedSteps,
        hasChanges: true,
      };
    });
  };

  const handleFlowStepToggle = (stepId: string, enabled: boolean) => {
    setState(prev => ({
      ...prev,
      flowSteps: prev.flowSteps.map(step =>
        step.id === stepId ? { ...step, required: enabled } : step
      ),
      hasChanges: true,
    }));
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

  const handleImageUpload = async (name: string, file: File, imageProperty: ImageProperty) => {
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

    // Validate file type if format is specified
    if (imageProperty.format && imageProperty.format !== 'any') {
      const fileExt = file.name.split('.').pop()?.toLowerCase();
      if (imageProperty.format !== fileExt) {
        setSaveStatus('error');
        setSaveMessage(`Preferred format is ${imageProperty.format.toUpperCase()}. Consider converting your image.`);
        // Allow upload but warn user
        setTimeout(() => {
          setSaveStatus('idle');
          setSaveMessage('');
        }, 5000);
      }
    }

    // Validate dimensions for specific icon types
    if (imageProperty.dimensions) {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        const { width, height } = imageProperty.dimensions!;
        if (img.width !== width || img.height !== height) {
          setSaveStatus('error');
          setSaveMessage(`Recommended dimensions: ${width}x${height}px. Your image: ${img.width}x${img.height}px.`);
          setTimeout(() => {
            setSaveStatus('idle');
            setSaveMessage('');
          }, 5000);
        }
        URL.revokeObjectURL(objectUrl);
      };
      img.src = objectUrl;
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
      setSaveStatus('success');
      setSaveMessage('Image uploaded successfully!');
      setTimeout(() => {
        setSaveStatus('idle');
        setSaveMessage('');
      }, 3000);
    };
    reader.readAsDataURL(file);
  };

  const handleButtonLinkChange = (name: string, property: 'linkType' | 'linkValue', value: string) => {
    setState(prev => ({
      ...prev,
      buttons: prev.buttons.map(b => 
        b.name === name ? { ...b, [property]: value } : b
      ),
      hasChanges: true,
    }));
  };

  const handleButtonVisibilityToggle = (name: string, hidden: boolean) => {
    setState(prev => ({
      ...prev,
      buttons: prev.buttons.map(b => 
        b.name === name ? { ...b, hidden } : b
      ),
      hasChanges: true,
    }));
  };

  const handleButtonIconChange = (name: string, icon: string) => {
    setState(prev => ({
      ...prev,
      buttons: prev.buttons.map(b => 
        b.name === name ? { ...b, icon } : b
      ),
      hasChanges: true,
    }));
  };

  const handleAddNewButton = (button: ButtonProperty) => {
    // Validate unique name
    const exists = state.buttons.some(b => b.name === button.name);
    if (exists) {
      setSaveStatus('error');
      setSaveMessage('Button name already exists. Please use a unique name.');
      setTimeout(() => {
        setSaveStatus('idle');
        setSaveMessage('');
      }, 5000);
      return;
    }

    setState(prev => ({
      ...prev,
      buttons: [...prev.buttons, button],
      hasChanges: true,
    }));
    
    setSaveStatus('success');
    setSaveMessage('New button added successfully!');
    setTimeout(() => {
      setSaveStatus('idle');
      setSaveMessage('');
    }, 3000);
  };

  // Commented out for now - can be used in future to allow button removal
  // const handleRemoveButton = (name: string) => {
  //   setState(prev => ({
  //     ...prev,
  //     buttons: prev.buttons.filter(b => b.name !== name),
  //     hasChanges: true,
  //   }));
  // };

  /**
   * Generate a downloadable TypeScript file with all changes applied
   * This creates a complete .tsx file for developers to review and apply
   */
  const generateDownloadableFile = (): string => {
    const { selectedModal, colors, fonts, texts, images, buttons, flowSteps } = state;
    
    // Generate a comment block with all the changes
    const fileContent = `/**
 * ${selectedModal} - Modified by Visual Editor
 * 
 * This file contains the customizations made in the Visual Editor.
 * 
 * INSTRUCTIONS FOR DEVELOPERS:
 * 1. Review all changes below
 * 2. Manually apply changes to the actual ${selectedModal}.tsx file
 * 3. Test thoroughly before committing
 * 4. Ensure all dependencies are still functional
 * 
 * Generated: ${new Date().toISOString()}
 */

// ============================================================================
// COLOR CUSTOMIZATIONS
// ============================================================================

const customColors = {
${colors.filter(c => !c.locked).map(c => `  ${c.name}: '${c.value}', // ${c.description || ''}`).join('\n')}
};

// ============================================================================
// FONT CUSTOMIZATIONS
// ============================================================================

const customFonts = {
${fonts.filter(f => !f.locked).map(f => `  ${f.name}: {
    fontFamily: '${f.family}',
    fontSize: '${f.size}',
    fontWeight: '${f.weight}',
    fontStyle: '${f.style || 'normal'}',
  },`).join('\n')}
};

// ============================================================================
// TEXT CONTENT CUSTOMIZATIONS
// ============================================================================

const customTexts = {
${texts.filter(t => !t.locked).map(t => `  ${t.name}: '${t.value}',`).join('\n')}
};

${images.length > 0 ? `
// ============================================================================
// IMAGE CUSTOMIZATIONS
// ============================================================================

const customImages = {
${images.filter(i => !i.locked).map(i => `  ${i.name}: '${i.value}', // ${i.alt || ''}`).join('\n')}
};
` : ''}

${buttons.length > 0 ? `
// ============================================================================
// BUTTON CUSTOMIZATIONS
// ============================================================================
${buttons.map(b => `
// ${b.label}
// Link Type: ${b.linkType}
// Link Value: ${b.linkValue}
// Hidden: ${b.hidden ? 'Yes (Button will not be shown)' : 'No (Button will be visible)'}
${b.icon ? `// Icon: ${b.icon}` : ''}
// Description: ${b.description || 'No description'}
${b.hasDependencies ? `// ⚠️  DEPENDENCIES: ${b.dependencies?.join(', ')}
// WARNING: Changing this button may break functionality that depends on:
${b.dependencies?.map(d => `//   - ${d}`).join('\n')}` : ''}
const ${b.name}Config = {
  linkType: '${b.linkType}',
  linkValue: '${b.linkValue}',
  hidden: ${b.hidden || false},${b.icon ? `\n  icon: '${b.icon}',` : ''}
};
`).join('\n')}

// NOTE: Buttons marked as hidden should be conditionally rendered
// Example: {!${buttons[0]?.name}Config.hidden && <button>...</button>}
` : ''}

${flowSteps.length > 0 ? `
// ============================================================================
// FLOW STEPS CONFIGURATION
// ============================================================================

const flowStepsOrder = [
${flowSteps.sort((a, b) => a.order - b.order).map(s => `  {
    id: '${s.id}',
    name: '${s.name}',
    label: '${s.label}',
    order: ${s.order},
    enabled: ${s.required},${s.locked ? '\n    locked: true, // Cannot be reordered or disabled' : ''}
  },`).join('\n')}
];

// NOTE: Apply these flow steps to your modal's step navigation logic
` : ''}

// ============================================================================
// INTEGRATION NOTES
// ============================================================================

/*
MANUAL INTEGRATION REQUIRED:

1. **Colors**: Apply customColors to your styled components or className props
   - Example: style={{ backgroundColor: customColors.modalBg }}
   
2. **Fonts**: Apply customFonts to text elements
   - Example: style={{ ...customFonts.heading }}
   
3. **Text Content**: Replace hardcoded strings with customTexts values
   - Example: <h1>{customTexts.modalTitle}</h1>
   
4. **Images**: Update image src attributes
   - Example: <img src={customImages.modalLogo} alt="Logo" />

${buttons.length > 0 ? `
5. **Button Links**: Review and apply button link configurations
   - Check dependencies before applying
   - Test all button functionality after changes
   - Ensure error handling is preserved
` : ''}

${flowSteps.length > 0 ? `
6. **Flow Steps**: Update your authentication flow logic
   - Respect the enabled/disabled states
   - Maintain the specified order
   - Keep locked steps in their required positions
` : ''}

TESTING CHECKLIST:
- [ ] Visual appearance matches preview
- [ ] All buttons work correctly
- [ ] Navigation flow is correct
- [ ] Error handling still works
- [ ] Dependencies are not broken
- [ ] Responsive design is maintained
*/
`;

    return fileContent;
  };

  /**
   * Download the generated file to the user's computer
   * This saves a .tsx file that can be sent to developers
   */
  const handleDownloadFile = () => {
    const fileContent = generateDownloadableFile();
    const filename = `${state.selectedModal}-customizations-${Date.now()}.tsx`;
    
    // Create a blob and download
    const blob = new Blob([fileContent], { type: 'text/typescript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setSaveStatus('success');
    setSaveMessage(`File downloaded as ${filename}. Send this to your developer to apply changes.`);
    
    setTimeout(() => {
      setSaveStatus('idle');
      setSaveMessage('');
    }, 8000);
  };

  const handleSave = async () => {
    // Instead of writing to GitHub, download the file
    handleDownloadFile();
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
              {image.type && (
                <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">
                  {image.type.replace('_', ' ')}
                </span>
              )}
            </div>
            
            {/* Image metadata info */}
            {(image.format || image.dimensions) && (
              <div className="mb-3 p-2 bg-blue-500/10 border border-blue-500/30 rounded text-xs text-blue-400">
                {image.format && image.format !== 'any' && (
                  <div>Preferred format: <strong>{image.format.toUpperCase()}</strong></div>
                )}
                {image.dimensions && (
                  <div>Recommended dimensions: <strong>{image.dimensions.width}×{image.dimensions.height}px</strong></div>
                )}
              </div>
            )}

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
                  accept={image.acceptFormats || "image/*"}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file && !image.locked) {
                      handleImageUpload(image.name, file, image);
                    }
                  }}
                  disabled={image.locked}
                  className="w-full text-white/70 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <p className="text-white/40 text-xs mt-2">
                  {image.acceptFormats ? 
                    `Accepts: ${image.acceptFormats.split(',').map(f => f.split('/')[1].toUpperCase()).join(', ')}` :
                    'Upload a new image to replace the current one'
                  }
                </p>
                <p className="text-white/40 text-xs mt-1">
                  Maximum file size: 2MB
                </p>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );

  const renderButtonEditor = () => {
    const buttonTemplates = [
      {
        name: 'payment_method',
        label: 'Payment Method Button',
        linkType: 'action' as const,
        linkValue: 'processPayment',
        description: 'New payment method option',
        hasDependencies: true,
        dependencies: ['Payment API'],
      },
      {
        name: 'wallet_connect',
        label: 'Wallet Connection Button',
        linkType: 'action' as const,
        linkValue: 'connectWallet',
        description: 'Connect a specific wallet',
        hasDependencies: true,
        dependencies: ['Wallet SDK', 'OnchainKit'],
      },
      {
        name: 'external_link',
        label: 'External Link Button',
        linkType: 'url' as const,
        linkValue: 'https://example.com',
        description: 'Link to external resource',
        hasDependencies: false,
      },
      {
        name: 'internal_nav',
        label: 'Internal Navigation Button',
        linkType: 'route' as const,
        linkValue: '/dashboard',
        description: 'Navigate to internal route',
        hasDependencies: false,
      },
    ];

    const applyTemplate = (template: typeof buttonTemplates[0]) => {
      setNewButton({
        ...newButton,
        ...template,
        name: `${template.name}_${Date.now()}`,
      });
    };

    const addButton = () => {
      if (!newButton.name || !newButton.label) {
        setSaveStatus('error');
        setSaveMessage('Button name and label are required.');
        setTimeout(() => {
          setSaveStatus('idle');
          setSaveMessage('');
        }, 3000);
        return;
      }

      handleAddNewButton(newButton as ButtonProperty);
      setShowAddButton(false);
      setNewButton({
        name: '',
        label: '',
        linkType: 'none',
        linkValue: '',
        description: '',
        hasDependencies: false,
        dependencies: [],
        locked: false,
        hidden: false,
        icon: '',
      });
    };

    return (
      <div className="space-y-4">
        {state.buttons.length === 0 ? (
          <div className="p-8 text-center text-white/50">
            No button properties available for this modal
          </div>
        ) : (
          <>
            <div className="p-4 bg-[#0052FF]/10 border border-[#0052FF]/30 rounded-lg mb-6">
              <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
                <LinkIcon size={18} className="text-[#0052FF]" />
                Button Configuration
              </h3>
              <p className="text-white/70 text-sm mb-2">
                Configure button visibility, links, and icons. Add new buttons using templates below.
              </p>
              <p className="text-white/60 text-xs">
                <strong>Tip:</strong> Hide buttons to remove them from the modal without deleting configuration.
              </p>
            </div>

            {/* Add New Button Section */}
            {state.selectedModal === 'PaymentModal' || state.selectedModal === 'TopUpWalletModal' ? (
              <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                <button
                  onClick={() => setShowAddButton(!showAddButton)}
                  className="w-full flex items-center justify-between text-white font-medium"
                >
                  <span className="flex items-center gap-2">
                    <CheckCircle size={16} className="text-green-400" />
                    Add New Button
                  </span>
                  <span className="text-green-400">{showAddButton ? '−' : '+'}</span>
                </button>
                
                {showAddButton && (
                  <div className="mt-4 space-y-3">
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      {buttonTemplates.map((template) => (
                        <button
                          key={template.name}
                          onClick={() => applyTemplate(template)}
                          className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded text-xs text-white text-left transition-colors"
                        >
                          {template.label}
                        </button>
                      ))}
                    </div>

                    <div>
                      <label className="text-white/70 text-xs mb-1 block">Button Name (unique ID)</label>
                      <input
                        type="text"
                        value={newButton.name}
                        onChange={(e) => setNewButton({ ...newButton, name: e.target.value })}
                        placeholder="e.g., myNewButton"
                        className="w-full px-2 py-1 bg-white/10 border border-white/20 rounded text-white text-sm"
                      />
                    </div>

                    <div>
                      <label className="text-white/70 text-xs mb-1 block">Button Label</label>
                      <input
                        type="text"
                        value={newButton.label}
                        onChange={(e) => setNewButton({ ...newButton, label: e.target.value })}
                        placeholder="e.g., Pay with Apple Pay"
                        className="w-full px-2 py-1 bg-white/10 border border-white/20 rounded text-white text-sm"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-white/70 text-xs mb-1 block">Link Type</label>
                        <select
                          value={newButton.linkType}
                          onChange={(e) => setNewButton({ ...newButton, linkType: e.target.value as any })}
                          className="w-full px-2 py-1 bg-white/10 border border-white/20 rounded text-white text-sm"
                        >
                          <option value="none">None</option>
                          <option value="url">External URL</option>
                          <option value="route">Internal Route</option>
                          <option value="action">Action/Function</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-white/70 text-xs mb-1 block">Link Value</label>
                        <input
                          type="text"
                          value={newButton.linkValue}
                          onChange={(e) => setNewButton({ ...newButton, linkValue: e.target.value })}
                          placeholder="URL, route, or function"
                          className="w-full px-2 py-1 bg-white/10 border border-white/20 rounded text-white text-sm"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-white/70 text-xs mb-1 block">Icon URL (optional)</label>
                      <input
                        type="text"
                        value={newButton.icon}
                        onChange={(e) => setNewButton({ ...newButton, icon: e.target.value })}
                        placeholder="https://example.com/icon.svg"
                        className="w-full px-2 py-1 bg-white/10 border border-white/20 rounded text-white text-sm"
                      />
                    </div>

                    <div>
                      <label className="text-white/70 text-xs mb-1 block">Description</label>
                      <input
                        type="text"
                        value={newButton.description}
                        onChange={(e) => setNewButton({ ...newButton, description: e.target.value })}
                        placeholder="Brief description"
                        className="w-full px-2 py-1 bg-white/10 border border-white/20 rounded text-white text-sm"
                      />
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={addButton}
                        className="flex-1 px-4 py-2 bg-green-500 hover:bg-green-600 rounded text-white font-medium transition-colors"
                      >
                        Add Button
                      </button>
                      <button
                        onClick={() => setShowAddButton(false)}
                        className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded text-white transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {/* Existing Buttons */}
            {state.buttons.map(button => (
              <div key={button.name} className={`p-4 border rounded-lg ${
                button.hidden 
                  ? 'bg-white/[0.02] border-white/5 opacity-60' 
                  : 'bg-white/5 border-white/10'
              }`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <label className="text-white font-medium">{button.label}</label>
                    {button.locked && (
                      <Lock size={14} className="text-yellow-400" title="Functional - locked from editing" />
                    )}
                    {button.hasDependencies && (
                      <AlertCircle size={14} className="text-orange-400" title="Has dependencies" />
                    )}
                    {button.hidden && (
                      <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400">
                        Hidden
                      </span>
                    )}
                  </div>
                  
                  {/* Visibility Toggle */}
                  {!button.locked && (
                    <button
                      onClick={() => handleButtonVisibilityToggle(button.name, !button.hidden)}
                      className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                        button.hidden
                          ? 'bg-green-500/20 hover:bg-green-500/30 text-green-400'
                          : 'bg-red-500/20 hover:bg-red-500/30 text-red-400'
                      }`}
                    >
                      {button.hidden ? 'Show' : 'Hide'}
                    </button>
                  )}
                </div>

                {button.description && (
                  <p className="text-white/60 text-sm mb-3">{button.description}</p>
                )}

                {button.hasDependencies && button.dependencies && (
                  <div className="mb-3 p-3 bg-orange-500/10 border border-orange-500/30 rounded">
                    <div className="flex items-start gap-2">
                      <AlertCircle size={16} className="text-orange-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-orange-400 text-xs font-medium mb-1">⚠️ Dependencies</p>
                        <ul className="text-orange-400/80 text-xs space-y-0.5 list-disc list-inside">
                          {button.dependencies.map((dep, idx) => (
                            <li key={idx}>{dep}</li>
                          ))}
                        </ul>
                        <p className="text-orange-400/70 text-xs mt-1">
                          Changing this button's link may break these dependencies.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-white/70 text-xs mb-1 block">Link Type</label>
                    <select
                      value={button.linkType}
                      onChange={(e) => !button.locked && handleButtonLinkChange(button.name, 'linkType', e.target.value)}
                      disabled={button.locked}
                      className="w-full px-2 py-1 bg-white/10 border border-white/20 rounded text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <option value="none">No Link (Default Action)</option>
                      <option value="url">External URL</option>
                      <option value="route">Internal Route</option>
                      <option value="action">Action/Function</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-white/70 text-xs mb-1 block">Link Value</label>
                    <input
                      type="text"
                      value={button.linkValue}
                      onChange={(e) => !button.locked && handleButtonLinkChange(button.name, 'linkValue', e.target.value)}
                      disabled={button.locked || button.linkType === 'none'}
                      placeholder={
                        button.linkType === 'url' ? 'https://example.com' :
                        button.linkType === 'route' ? '/dashboard' :
                        button.linkType === 'action' ? 'functionName' : 'N/A'
                      }
                      className="w-full px-2 py-1 bg-white/10 border border-white/20 rounded text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>

                {/* Icon Input */}
                <div>
                  <label className="text-white/70 text-xs mb-1 block">Icon URL (optional)</label>
                  <input
                    type="text"
                    value={button.icon || ''}
                    onChange={(e) => !button.locked && handleButtonIconChange(button.name, e.target.value)}
                    disabled={button.locked}
                    placeholder="https://example.com/icon.svg or /icons/wallet.png"
                    className="w-full px-2 py-1 bg-white/10 border border-white/20 rounded text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  {button.icon && (
                    <div className="mt-2 flex items-center gap-2">
                      <img src={button.icon} alt="Icon preview" className="w-6 h-6 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      <span className="text-white/50 text-xs">Icon preview</span>
                    </div>
                  )}
                </div>

                {button.linkType === 'url' && button.linkValue && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-white/50">
                    <ExternalLink size={12} />
                    <span>Will open: {button.linkValue}</span>
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    );
  };

  const renderFlowEditor = () => (
    <div className="space-y-4">
      <div className="p-4 bg-[#0052FF]/10 border border-[#0052FF]/30 rounded-lg mb-6">
        <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
          <AlertCircle size={18} className="text-[#0052FF]" />
          Authentication Flow Order
        </h3>
        <p className="text-white/70 text-sm mb-2">
          Drag and drop steps to reorder the authentication flow. Toggle steps on/off to include or skip them.
        </p>
        <p className="text-white/60 text-xs">
          <strong>Requirements:</strong> The flow must collect username, email, country, wallet, and OTP verification 
          (though the order can be changed).
        </p>
      </div>

      {state.flowSteps
        .sort((a, b) => a.order - b.order)
        .map((step, index) => (
        <div 
          key={step.id} 
          className={`p-4 border rounded-lg ${
            step.required 
              ? 'bg-white/5 border-white/10' 
              : 'bg-white/[0.02] border-white/5 opacity-60'
          }`}
          draggable={!step.locked}
          onDragStart={(e) => {
            if (!step.locked) {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', index.toString());
            }
          }}
          onDragOver={(e) => {
            if (!step.locked) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }
          }}
          onDrop={(e) => {
            if (!step.locked) {
              e.preventDefault();
              const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
              if (fromIndex !== index) {
                handleFlowStepReorder(fromIndex, index);
              }
            }
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 flex-1">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0 ${
                step.required ? 'bg-[#0052FF]/20 text-[#0052FF]' : 'bg-white/5 text-white/40'
              }`}>
                <span className="font-bold text-sm">{step.order}</span>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="text-white font-semibold">{step.label}</h4>
                  {step.locked && (
                    <Lock size={14} className="text-yellow-400" title="Core step - cannot be reordered" />
                  )}
                  {!step.locked && (
                    <span className="text-white/40 text-xs cursor-move">⋮⋮ Drag to reorder</span>
                  )}
                </div>
                <p className="text-white/60 text-sm">{step.description}</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded ${
                    step.required 
                      ? 'bg-green-500/20 text-green-400' 
                      : 'bg-white/10 text-white/50'
                  }`}>
                    {step.required ? 'Enabled' : 'Disabled'}
                  </span>
                  {step.locked && (
                    <span className="text-xs px-2 py-1 rounded bg-yellow-500/20 text-yellow-400">
                      Required
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!step.locked && (
                <button
                  onClick={() => handleFlowStepToggle(step.id, !step.required)}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                    step.required
                      ? 'bg-white/10 hover:bg-white/20 text-white'
                      : 'bg-[#0052FF] hover:bg-[#0041CC] text-white'
                  }`}
                >
                  {step.required ? 'Disable' : 'Enable'}
                </button>
              )}
            </div>
          </div>
        </div>
      ))}

      <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
        <div className="flex items-start gap-2">
          <AlertCircle size={16} className="text-yellow-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-yellow-400 text-sm font-medium mb-1">Important Notes</p>
            <ul className="text-yellow-400/80 text-xs space-y-1 list-disc list-inside">
              <li>Steps marked as "Required" cannot be disabled (they're essential for authentication)</li>
              <li>Locked steps cannot be reordered (e.g., OTP must come after email, Success must be last)</li>
              <li>You can change the order of enabled steps to customize the user experience</li>
              <li>Disabled steps will be skipped entirely in the authentication flow</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white">
      {/* Header */}
      <header className="border-b border-white/10 bg-[#0A0A0F]/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Modal Visual Editor</h1>
              <p className="text-white/50 text-sm">Admin-only editor with download functionality</p>
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
                disabled={!state.hasChanges}
                className="px-4 py-2 bg-[#0052FF] hover:bg-[#0041CC] disabled:bg-white/10 disabled:text-white/40 rounded-lg flex items-center gap-2 transition-colors"
              >
                <Download size={18} />
                <span>Download File</span>
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
                <option value="PaymentModal">Payment Modal (PaymentModal.tsx)</option>
                <option value="TopUpWalletModal">Top Up Wallet Modal (TopUpWalletModal.tsx)</option>
              </select>
            </div>

            {/* Tab Navigation */}
            <div className="flex gap-2 mb-6 border-b border-white/10 overflow-x-auto">
              {state.flowSteps.length > 0 && (
                <button
                  onClick={() => setActiveTab('flow')}
                  className={`px-4 py-2 flex items-center gap-2 border-b-2 transition-colors flex-shrink-0 ${
                    activeTab === 'flow' 
                      ? 'border-[#0052FF] text-white' 
                      : 'border-transparent text-white/50 hover:text-white/70'
                  }`}
                >
                  <ArrowRight size={18} />
                  <span>Flow Order</span>
                </button>
              )}
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
                className={`px-4 py-2 flex items-center gap-2 border-b-2 transition-colors flex-shrink-0 ${
                  activeTab === 'images' 
                    ? 'border-[#0052FF] text-white' 
                    : 'border-transparent text-white/50 hover:text-white/70'
                }`}
              >
                <ImageIcon size={18} />
                <span>Images</span>
              </button>
              {state.buttons.length > 0 && (
                <button
                  onClick={() => setActiveTab('buttons')}
                  className={`px-4 py-2 flex items-center gap-2 border-b-2 transition-colors flex-shrink-0 ${
                    activeTab === 'buttons' 
                      ? 'border-[#0052FF] text-white' 
                      : 'border-transparent text-white/50 hover:text-white/70'
                  }`}
                >
                  <LinkIcon size={18} />
                  <span>Buttons</span>
                </button>
              )}
            </div>

            {/* Editor Content */}
            <div className="space-y-6">
              {activeTab === 'flow' && renderFlowEditor()}
              {activeTab === 'colors' && renderColorEditor()}
              {activeTab === 'fonts' && renderFontEditor()}
              {activeTab === 'text' && renderTextEditor()}
              {activeTab === 'images' && renderImageEditor()}
              {activeTab === 'buttons' && renderButtonEditor()}
            </div>

            {/* Info Box */}
            <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <div className="flex items-start gap-2">
                <Download size={16} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-yellow-400 text-sm font-medium mb-1">File Download</p>
                  <p className="text-yellow-400/80 text-xs">
                    Clicking "Download File" will save a .tsx file to your computer with all customizations. 
                    Send this file to your developer to manually apply the changes. 
                    This does NOT update files on GitHub directly.
                  </p>
                </div>
              </div>
            </div>

            {state.buttons.length > 0 && (
              <div className="mt-4 p-4 bg-orange-500/10 border border-orange-500/30 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle size={16} className="text-orange-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-orange-400 text-sm font-medium mb-1">Button Dependencies</p>
                    <p className="text-orange-400/80 text-xs">
                      Buttons marked with ⚠️ have functional dependencies. Changing their links may break 
                      important functionality. Review dependency warnings carefully before modifying.
                    </p>
                  </div>
                </div>
              </div>
            )}
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
                    ) : state.selectedModal === 'BaseWalletAuthModal' ? (
                      <BaseWalletAuthModal 
                        isOpen={true} 
                        onClose={() => setState(prev => ({ ...prev, previewOpen: false }))} 
                      />
                    ) : (
                      <p className="text-white/50 text-center px-4">
                        Preview not available for {state.selectedModal}.<br/>
                        <span className="text-xs">Payment modals require additional context and cannot be previewed in isolation.</span>
                      </p>
                    )
                  ) : (
                    <p className="text-white/50">Click "Open Modal" to preview changes</p>
                  )}
                </div>
                <p className="text-white/40 text-xs mt-3 text-center">
                  Download file to save customizations for your developer.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
