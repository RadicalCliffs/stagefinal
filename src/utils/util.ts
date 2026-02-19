import { supabase } from "../lib/supabase";
import { toPrizePid, normalizeWalletAddress } from "./userId";

export const handleCopy = async (
  index: number,
  value: string,
  setCopiedIndex: (index: null | number) => void
) => {
  try {
    await navigator.clipboard.writeText(value);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 3000); // revert after 3s
  } catch (error) {
    console.error("Copy failed:", error);
  }
};

export const scrollToSection = (id: string) => {
  const section = document.getElementById(id);
  if (section) {
    const yOffset = 0; // adjust based on your header height
    const y = section.getBoundingClientRect().top + window.scrollY + yOffset;
    window.scrollTo({ top: y, behavior: "smooth" });
  }
};

export const truncateString = (
  id: string | undefined,
  showChar: number = 4
) => {
  if (!id) return "";
  return id.length > 10
    ? `${id.slice(0, showChar)}...${id.slice(-showChar)}`
    : id;
};

/**
 * Truncate a wallet address for display
 * Shows first 6 characters and last 4 characters
 * Example: 0x1234...5678
 */
export const truncateWalletAddress = (address: string | undefined): string => {
  if (!address) return "";
  return address.length > 10
    ? `${address.substring(0, 6)}...${address.substring(address.length - 4)}`
    : address;
};

// Debounce utility function
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      func(...args);
    }, wait);
  };
}

export async function createNewUser(walletAddress: string, privyUserId?: string) {
  // Convert to canonical format
  const inputId = privyUserId || walletAddress;
  const canonicalUserId = toPrizePid(inputId);
  const normalizedWallet = normalizeWalletAddress(walletAddress);
  
  const { data, error } = await supabase
    .from("canonical_users")
    .insert([{ 
      canonical_user_id: canonicalUserId, // NEW: Canonical format
      wallet_address: normalizedWallet,
      privy_user_id: privyUserId || null, // Keep for backward compatibility
      uid: privyUserId || walletAddress,
      created_at: new Date().toISOString()
    }] as any)
    .select()
    .single() as any;

  if (error) {
    console.error("Error creating user:", error);
    return null;
  }

  return data;
}

// VRF Verification Constants and Utilities
// VRFWinnerSelector contract with 2 gwei + native ETH support
export const VRF_CONTRACT_ADDRESS = "0xc5Dfc3f6a227B30161f53F0BC167495158854854";
export const BASE_EXPLORER_URL = "https://basescan.org";

/**
 * Get blockchain verification links for VRF transparency
 */
export const getVerificationLinks = (vrfSeed?: string) => ({
  contract: `${BASE_EXPLORER_URL}/address/${VRF_CONTRACT_ADDRESS}`,
  vrfDocs: 'https://docs.chain.link/vrf',
  vrfTx: vrfSeed ? `${BASE_EXPLORER_URL}/tx/${vrfSeed}` : null,
});

/**
 * Calculate winning ticket from VRF seed
 * Formula: (VRF_SEED % tickets_sold) + 1 = winning_ticket
 */
export const calculateWinningTicketFromSeed = (vrfSeed: string, ticketCount: number): number => {
  try {
    // Handle both hex and decimal seed formats
    const seedValue = vrfSeed.startsWith('0x')
      ? BigInt(vrfSeed)
      : BigInt(vrfSeed);
    return Number(seedValue % BigInt(ticketCount)) + 1;
  } catch {
    return 0;
  }
};

