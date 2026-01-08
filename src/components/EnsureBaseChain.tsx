import { useEffect, useRef } from 'react';
import { useAuthUser } from '../contexts/AuthContext';

/**
 * EnsureBaseChain Component
 *
 * This component ensures that all connected wallets are switched to Base network
 * after a user logs in. It runs as a background effect and handles failures gracefully.
 *
 * - Switches all connected wallets to Base (chainId 8453) or Base Sepolia (84532)
 * - Handles errors gracefully without disrupting the user experience
 * - Only attempts the switch once per wallet to avoid excessive prompts
 *
 * Usage: Mount this component anywhere in your app tree (preferably near the root)
 * <EnsureBaseChain />
 */

// Base mainnet chainId: 8453, Base Sepolia: 84532
const getTargetChainId = () => {
  return import.meta.env.VITE_BASE_MAINNET === 'true' ? 8453 : 84532;
};

export function EnsureBaseChain(): null {
  const { linkedWallets, authenticated, ready } = useAuthUser();
  const attemptedWallets = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Only run when auth is ready and user is authenticated
    if (!ready || !authenticated) {
      return;
    }

    // No wallets to switch
    if (!linkedWallets || linkedWallets.length === 0) {
      return;
    }

    const targetChainId = getTargetChainId();

    // Attempt to switch each wallet to Base
    linkedWallets.forEach(async (wallet: any) => {
      // Skip if we've already attempted this wallet or if no address
      if (!wallet.address || attemptedWallets.current.has(wallet.address)) {
        return;
      }

      // Mark as attempted to avoid repeated prompts
      attemptedWallets.current.add(wallet.address);

      try {
        // Check if wallet is already on the target chain
        const currentChainId = wallet.chainId;
        if (currentChainId === `eip155:${targetChainId}` || currentChainId === String(targetChainId)) {
          return; // Already on Base
        }

        // Only attempt to switch if the wallet has a switchChain method
        if (wallet.switchChain && typeof wallet.switchChain === 'function') {
          await wallet.switchChain(targetChainId);
          console.log(`Switched wallet ${wallet.address} to Base (chainId: ${targetChainId})`);
        }
      } catch (error) {
        // Gracefully handle failures - user may reject or wallet may not support chain switching
        console.warn(
          `Could not switch wallet ${wallet.address} to Base:`,
          error instanceof Error ? error.message : 'Unknown error'
        );
        // Don't throw - allow the app to continue working
      }
    });
  }, [linkedWallets, authenticated, ready]);

  // Reset attempted wallets when user logs out
  useEffect(() => {
    if (!authenticated) {
      attemptedWallets.current.clear();
    }
  }, [authenticated]);

  // This component doesn't render anything
  return null;
}

export default EnsureBaseChain;
