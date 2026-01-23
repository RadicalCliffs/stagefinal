import { useState, useRef } from 'react';
import { Download, Check, AlertCircle, Shield } from 'lucide-react';
import { useEvmKeyExportIframe, useEvmAddress } from '@coinbase/cdp-hooks';

interface ExportWalletKeyProps {
  onClose?: () => void;
}

/**
 * ExportWalletKey Component
 * 
 * Allows users to securely export their embedded wallet's private key.
 * Uses the secure iframe method recommended by CDP to avoid exposing
 * the private key to the application's JavaScript context.
 */
export const ExportWalletKey: React.FC<ExportWalletKeyProps> = ({ onClose }) => {
  const { evmAddress } = useEvmAddress();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isActive, setIsActive] = useState(false);
  const [showWarning, setShowWarning] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);

  const { status, cleanup } = useEvmKeyExportIframe({
    address: isActive && evmAddress ? evmAddress : '',
    containerRef: isActive ? containerRef : { current: null },
    label: 'Copy Private Key to Clipboard',
    copiedLabel: 'Private Key Copied!',
  });

  const handleProceed = () => {
    if (!acknowledged) return;
    setShowWarning(false);
    setIsActive(true);
  };

  const handleClose = () => {
    cleanup();
    setIsActive(false);
    if (onClose) onClose();
  };

  if (!evmAddress) {
    return (
      <div className="bg-[#1E1E1E] rounded-xl p-6 border border-red-500/30">
        <div className="flex items-start gap-3">
          <AlertCircle size={24} className="text-red-400 flex-shrink-0 mt-1" />
          <div>
            <h3 className="text-white sequel-75 text-lg mb-2">Wallet Not Found</h3>
            <p className="text-white/60 sequel-45 text-sm">
              No embedded wallet address found. Please ensure you're signed in with a Base account.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#1E1E1E] rounded-xl p-6 border border-white/10">
      {showWarning ? (
        <>
          <div className="flex items-start gap-3 mb-6">
            <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center flex-shrink-0">
              <Shield size={24} className="text-red-400" />
            </div>
            <div>
              <h3 className="text-white sequel-75 text-lg mb-2">Export Private Key</h3>
              <p className="text-white/60 sequel-45 text-sm">
                Your private key grants full control over your wallet and funds.
              </p>
            </div>
          </div>

          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-2 mb-3">
              <AlertCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-400 sequel-75 text-sm">Security Warning</p>
            </div>
            <ul className="space-y-2 text-red-300/80 sequel-45 text-xs ml-6">
              <li className="list-disc">Anyone with your private key can access your wallet and steal your funds</li>
              <li className="list-disc">Never share your private key with anyone, including support staff</li>
              <li className="list-disc">Store it securely offline in a safe location</li>
              <li className="list-disc">We recommend using a hardware wallet for long-term storage</li>
              <li className="list-disc">Make sure no one is watching your screen</li>
            </ul>
          </div>

          <div className="bg-[#2A2A2A] rounded-lg p-4 mb-6">
            <p className="text-white/70 sequel-45 text-sm mb-3">
              <strong className="text-white">Why export?</strong> You may want to:
            </p>
            <ul className="space-y-2 text-white/60 sequel-45 text-xs ml-4">
              <li className="list-disc">Import your wallet into MetaMask or another wallet app</li>
              <li className="list-disc">Create a backup in case you lose access to your account</li>
              <li className="list-disc">Use your wallet with other dApps or services</li>
            </ul>
          </div>

          <div className="flex items-start gap-3 mb-6">
            <input
              type="checkbox"
              id="acknowledge"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-1 w-4 h-4 rounded border-white/20 bg-[#1A1A1A] focus:ring-2 focus:ring-[#DDE404]"
            />
            <label htmlFor="acknowledge" className="text-white/80 sequel-45 text-sm cursor-pointer">
              I understand the risks and will keep my private key secure. I acknowledge that if I lose my private key or if it's stolen, I may permanently lose access to my funds.
            </label>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleProceed}
              disabled={!acknowledged}
              className="flex-1 bg-red-500 hover:bg-red-600 disabled:bg-red-500/50 disabled:cursor-not-allowed text-white sequel-75 py-3 rounded-lg transition-colors"
            >
              I Understand, Proceed
            </button>
            <button
              onClick={handleClose}
              className="flex-1 bg-[#404040] hover:bg-[#505050] text-white sequel-75 py-3 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-start gap-3 mb-6">
            <div className="w-12 h-12 bg-[#DDE404]/20 rounded-full flex items-center justify-center flex-shrink-0">
              <Download size={24} className="text-[#DDE404]" />
            </div>
            <div>
              <h3 className="text-white sequel-75 text-lg mb-2">Export Your Private Key</h3>
              <p className="text-white/60 sequel-45 text-sm">
                Click the button below to securely copy your private key to your clipboard.
              </p>
            </div>
          </div>

          <div className="bg-[#2A2A2A] rounded-lg p-4 mb-6">
            <p className="text-white/40 sequel-45 text-xs mb-2">Wallet Address:</p>
            <p className="text-white sequel-45 text-sm font-mono break-all">{evmAddress}</p>
          </div>

          {/* Secure iframe container - the CDP SDK will inject the export button here */}
          <div 
            ref={containerRef} 
            className="mb-6 [&>div]:w-full [&>button]:w-full [&>button]:bg-[#DDE404] [&>button]:hover:bg-[#DDE404]/90 [&>button]:text-black [&>button]:sequel-75 [&>button]:py-3 [&>button]:rounded-lg [&>button]:transition-colors"
          />

          {status && String(status) === 'copied' && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 mb-4 flex items-start gap-2">
              <Check size={18} className="text-green-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-green-400 sequel-75 text-sm mb-1">Private Key Copied!</p>
                <p className="text-green-300/70 sequel-45 text-xs">
                  Your private key has been securely copied to your clipboard. Paste it into your wallet application or store it safely offline.
                </p>
              </div>
            </div>
          )}

          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-2">
              <AlertCircle size={16} className="text-yellow-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-yellow-400 sequel-75 text-xs mb-1">Security Reminder</p>
                <p className="text-yellow-300/70 sequel-45 text-xs">
                  Make sure to clear your clipboard after pasting your private key. Never paste it in unsecured locations or share it with anyone.
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={handleClose}
            className="w-full bg-[#404040] hover:bg-[#505050] text-white sequel-75 py-3 rounded-lg transition-colors"
          >
            Close
          </button>
        </>
      )}
    </div>
  );
};

export default ExportWalletKey;
