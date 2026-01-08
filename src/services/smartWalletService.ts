import { supabase } from '../lib/supabase';
import { normalizeWalletAddress, toPrizePid } from '../utils/userId';

/**
 * Smart Wallet Service
 * 
 * Handles the mapping between smart contract wallets and their parent wallets.
 * When CDP creates a smart contract wallet for transactions, we need to link it
 * back to the user's parent wallet to ensure all entries/transactions are
 * attributed correctly.
 */

/**
 * Links a smart contract wallet address to its parent wallet address
 * 
 * @param parentWalletAddress - The parent/owner wallet address (from CDP evmAddress)
 * @param smartContractAddress - The smart contract wallet address used for transactions
 * @returns Promise<boolean> - True if successfully linked, false otherwise
 */
export async function linkSmartWalletToParent(
  parentWalletAddress: string,
  smartContractAddress: string
): Promise<boolean> {
  try {
    const normalizedParent = normalizeWalletAddress(parentWalletAddress);
    const normalizedSmart = normalizeWalletAddress(smartContractAddress);
    
    if (!normalizedParent || !normalizedSmart) {
      console.error('[SmartWallet] Invalid wallet addresses provided');
      return false;
    }
    
    // Don't link if addresses are the same (not a smart contract scenario)
    if (normalizedParent === normalizedSmart) {
      console.log('[SmartWallet] Parent and smart wallet are same, no linking needed');
      return true;
    }
    
    console.log('[SmartWallet] Linking smart wallet to parent:', {
      parent: normalizedParent,
      smart: normalizedSmart,
    });
    
    // Find the user by parent wallet address
    const canonicalId = toPrizePid(normalizedParent);
    const { data: user, error: findError } = await supabase
      .from('canonical_users')
      .select('id, wallet_address, smart_wallet_address')
      .eq('canonical_user_id', canonicalId)
      .maybeSingle();
    
    if (findError) {
      console.error('[SmartWallet] Error finding user:', findError);
      return false;
    }
    
    if (!user) {
      console.warn('[SmartWallet] User not found for parent wallet:', normalizedParent);
      return false;
    }
    
    // Update the smart_wallet_address if not already set or different
    if (user.smart_wallet_address !== normalizedSmart) {
      const { error: updateError } = await supabase
        .from('canonical_users')
        .update({ smart_wallet_address: normalizedSmart })
        .eq('id', user.id);
      
      if (updateError) {
        console.error('[SmartWallet] Error updating smart wallet address:', updateError);
        return false;
      }
      
      console.log('[SmartWallet] Successfully linked smart wallet to parent');
    } else {
      console.log('[SmartWallet] Smart wallet already linked');
    }
    
    return true;
  } catch (error) {
    console.error('[SmartWallet] Error linking smart wallet to parent:', error);
    return false;
  }
}

/**
 * Resolves a smart contract wallet address to its parent wallet address
 * 
 * @param walletAddress - Either a parent wallet or smart contract wallet address
 * @returns Promise<string> - The parent wallet address, or the original if not a smart contract
 */
export async function resolveToParentWallet(walletAddress: string): Promise<string> {
  try {
    const normalized = normalizeWalletAddress(walletAddress);
    if (!normalized) {
      console.error('[SmartWallet] Invalid wallet address provided for resolution');
      return walletAddress;
    }
    
    // Check if this address is registered as a smart contract wallet
    const { data: user, error } = await supabase
      .from('canonical_users')
      .select('wallet_address, canonical_user_id')
      .eq('smart_wallet_address', normalized)
      .maybeSingle();
    
    if (error) {
      console.error('[SmartWallet] Error resolving smart wallet:', error);
      return walletAddress;
    }
    
    if (user && user.wallet_address) {
      console.log('[SmartWallet] Resolved smart wallet to parent:', {
        smart: normalized,
        parent: user.wallet_address,
      });
      return user.wallet_address;
    }
    
    // Not a registered smart wallet, return original
    return walletAddress;
  } catch (error) {
    console.error('[SmartWallet] Error resolving to parent wallet:', error);
    return walletAddress;
  }
}

/**
 * Check if a wallet address is a smart contract wallet (has a parent wallet)
 * 
 * @param walletAddress - The wallet address to check
 * @returns Promise<boolean> - True if it's a smart contract wallet, false otherwise
 */
export async function isSmartContractWallet(walletAddress: string): Promise<boolean> {
  try {
    const normalized = normalizeWalletAddress(walletAddress);
    if (!normalized) {
      return false;
    }
    
    const { data, error } = await supabase
      .from('canonical_users')
      .select('id')
      .eq('smart_wallet_address', normalized)
      .maybeSingle();
    
    if (error) {
      console.error('[SmartWallet] Error checking if smart contract:', error);
      return false;
    }
    
    return !!data;
  } catch (error) {
    console.error('[SmartWallet] Error checking smart contract wallet:', error);
    return false;
  }
}
